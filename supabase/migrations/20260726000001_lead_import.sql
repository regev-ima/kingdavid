-- ============================================================================
-- Lead import infrastructure + contact resolution + phone normalization
-- ============================================================================
-- Delivers, in one idempotent file:
--
--   1. public.normalize_il_phone(text)  — ONE canonical phone format
--      (972XXXXXXXXX) replacing the six disagreeing client-side helpers.
--   2. customers.phone_normalized / leads.phone_normalized — GENERATED STORED
--      columns. Generated (not trigger-filled) on purpose: no write path can
--      bypass them, so every one of the seven lead-creation paths — including
--      the public website RPC and the external upsertLead webhook — is covered
--      without touching any of them.
--   3. public.resolve_or_create_contact(...) + a BEFORE INSERT trigger on
--      leads, so every incoming lead resolves to an existing contact by
--      normalized phone or creates one. One contact → many leads.
--   4. leads.external_source / leads.external_id (+ UNIQUE) — the Kaveret row
--      id. Re-importing the same id UPDATES the lead instead of creating a
--      duplicate.
--   5. lead_import_batches / lead_import_rows staging tables and
--      public.process_lead_import(batch, chunk) — the CSV → staging → SQL
--      merge path. Chunked and resumable, so tens of thousands of rows do not
--      depend on a browser tab staying open.
--
-- NOT in this file: deleting anything. It is purely additive.
--
-- SCHEMA CAVEAT: leads/customers have no CREATE TABLE anywhere in this repo
-- (base44-era tables). Block 0 therefore verifies the columns this migration
-- depends on and fails with a readable message instead of erroring cryptically
-- half-way through. process_lead_import() additionally filters its INSERT
-- column list against information_schema at runtime, so optional columns that
-- turn out not to exist are skipped rather than aborting the import.
-- ============================================================================

-- Index builds and the leads table rewrite need room (~104k rows).
SET statement_timeout = '600s';

BEGIN;

-- ─── 0. Preflight: fail loudly and readably on an unexpected schema ─────────
DO $preflight$
DECLARE
  missing text[] := '{}';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('leads','id'), ('leads','phone'), ('leads','full_name'), ('leads','status'),
      ('leads','source'), ('leads','created_date'),
      ('customers','id'), ('customers','phone'), ('customers','full_name'),
      ('customers','created_date')
    ) AS v(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
    ) THEN
      missing := array_append(missing, r.tbl || '.' || r.col);
    END IF;
  END LOOP;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION
      'lead_import migration aborted — expected columns are missing: %. Run scripts/inspect-production-schema.sql and reconcile before retrying.',
      array_to_string(missing, ', ');
  END IF;
END
$preflight$;


-- ─── 1. Phone normalization ─────────────────────────────────────────────────
-- Canonical form: 972XXXXXXXXX (bare international, no plus). Chosen because
-- phoneUtils.normalizeIsraeliPhone, the Green API chat_id and the 019 SMS
-- gateway already produce exactly this shape.
--
-- Unparseable / foreign numbers fall through to bare digits rather than NULL,
-- so they still deduplicate against themselves instead of every one of them
-- collapsing into a single "unknown" contact. is_valid_il_phone() flags them
-- for the review screen.
CREATE OR REPLACE FUNCTION public.normalize_il_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;

  -- Strip WhatsApp suffixes (972501234567@c.us) then every non-digit.
  d := regexp_replace(raw, '@[cg]\.us$', '');
  d := regexp_replace(d, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;

  -- 00972… → 972…
  IF left(d, 5) = '00972' THEN d := substring(d from 3); END IF;

  -- Local with leading zero: 0501234567 / 031234567 → 972…
  IF left(d, 1) = '0' AND length(d) BETWEEN 9 AND 10 THEN
    RETURN '972' || substring(d from 2);
  END IF;

  -- Already international.
  IF left(d, 3) = '972' AND length(d) BETWEEN 11 AND 12 THEN
    RETURN d;
  END IF;

  -- Bare local without the leading zero: 501234567 / 721234567.
  IF length(d) = 9 AND left(d, 1) IN ('5', '7') THEN
    RETURN '972' || d;
  END IF;

  -- Foreign or malformed — keep the digits so identical inputs still match.
  RETURN d;
END;
$$;

COMMENT ON FUNCTION public.normalize_il_phone(text) IS
  'Canonical Israeli phone form 972XXXXXXXXX. Single source of truth for dedupe and lookup.';

CREATE OR REPLACE FUNCTION public.is_valid_il_phone(raw text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n text;
  local text;
BEGIN
  n := public.normalize_il_phone(raw);
  IF n IS NULL OR left(n, 3) <> '972' THEN RETURN false; END IF;
  local := substring(n from 4);
  RETURN local ~ '^5\d{8}$'        -- mobile
      OR local ~ '^7[2-9]\d{7}$'   -- VoIP / virtual
      OR local ~ '^[23489]\d{7}$'; -- landline
END;
$$;


-- ─── 2. Generated normalized-phone columns ──────────────────────────────────
-- GENERATED ALWAYS ... STORED, not a trigger: a generated column cannot be
-- written to or bypassed by any client, which is the whole point — the current
-- bug is that every write path formats the phone differently.
DO $gen$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='customers' AND column_name='phone_normalized') THEN
    ALTER TABLE public.customers
      ADD COLUMN phone_normalized text
      GENERATED ALWAYS AS (public.normalize_il_phone(phone)) STORED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='customers' AND column_name='phone_valid') THEN
    ALTER TABLE public.customers
      ADD COLUMN phone_valid boolean
      GENERATED ALWAYS AS (public.is_valid_il_phone(phone)) STORED;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='leads' AND column_name='phone_normalized') THEN
    ALTER TABLE public.leads
      ADD COLUMN phone_normalized text
      GENERATED ALWAYS AS (public.normalize_il_phone(phone)) STORED;
  END IF;
END
$gen$;

CREATE INDEX IF NOT EXISTS customers_phone_normalized_idx ON public.customers (phone_normalized);
CREATE INDEX IF NOT EXISTS leads_phone_normalized_idx     ON public.leads     (phone_normalized);

-- The UNIQUE constraint that structurally prevents duplicate contacts. It can
-- only be created once the existing duplicates are merged, and merging needs
-- the FK inventory we do not have yet — so attempt it, and fall back to a
-- NOTICE naming the blocker rather than failing the whole migration.
-- resolve_or_create_contact() takes an advisory lock and is therefore correct
-- with or without this index.
DO $uniq$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_normalized_uniq
      ON public.customers (phone_normalized)
      WHERE phone_normalized IS NOT NULL;
    RAISE NOTICE 'customers.phone_normalized is now UNIQUE.';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE
      'Could not add UNIQUE(customers.phone_normalized) — duplicate contacts already exist. Merge them, then create the index. Query: SELECT phone_normalized, count(*) FROM public.customers WHERE phone_normalized IS NOT NULL GROUP BY 1 HAVING count(*) > 1;';
  END;
END
$uniq$;


-- ─── 3. Lead → contact link + external (Kaveret) id ─────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS contact_id      uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_id     text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

COMMENT ON COLUMN public.leads.external_id IS
  'Row id in the system of record (e.g. Kaveret). With external_source it is the import idempotency key.';

CREATE INDEX IF NOT EXISTS leads_contact_id_idx ON public.leads (contact_id) WHERE contact_id IS NOT NULL;

-- The idempotency key: re-importing the same source row updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS leads_external_ref_uniq
  ON public.leads (external_source, external_id)
  WHERE external_id IS NOT NULL AND external_source IS NOT NULL;

-- Contact-side aggregates the UI reads without a join (entities.js cannot
-- express one — see docs/leads-contacts-plan.md §2.8).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS alt_names          text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS contact_status     text,
  ADD COLUMN IF NOT EXISTS first_seen_date    timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_date timestamptz;


-- ─── 4. resolve_or_create_contact ───────────────────────────────────────────
-- The heart of "every incoming lead resolves to a contact". Idempotent and
-- race-safe: the advisory lock serializes concurrent callers on the same
-- number, so it is correct even before the UNIQUE index above exists.
CREATE OR REPLACE FUNCTION public.resolve_or_create_contact(
  p_phone        text,
  p_full_name    text        DEFAULT NULL,
  p_email        text        DEFAULT NULL,
  p_city         text        DEFAULT NULL,
  p_address      text        DEFAULT NULL,
  p_source       text        DEFAULT NULL,
  p_created_date timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm  text;
  v_id    uuid;
  v_name  text;
  v_email text;
  v_when  timestamptz;
BEGIN
  v_norm := public.normalize_il_phone(p_phone);
  IF v_norm IS NULL THEN RETURN NULL; END IF;

  v_name  := NULLIF(btrim(coalesce(p_full_name, '')), '');
  v_email := NULLIF(lower(btrim(coalesce(p_email, ''))), '');
  v_when  := coalesce(p_created_date, now());

  PERFORM pg_advisory_xact_lock(hashtextextended(v_norm, 0));

  SELECT id INTO v_id
  FROM public.customers
  WHERE phone_normalized = v_norm
  ORDER BY created_date NULLS LAST, id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Existing contact: enrich, never overwrite. A different name on the same
    -- number (spouse, partner, business) is kept in alt_names rather than
    -- becoming a second contact.
    UPDATE public.customers c SET
      full_name = COALESCE(NULLIF(btrim(c.full_name), ''), v_name),
      alt_names = CASE
        WHEN v_name IS NULL                                    THEN c.alt_names
        WHEN v_name = COALESCE(btrim(c.full_name), '')          THEN c.alt_names
        WHEN v_name = ANY(COALESCE(c.alt_names, '{}'::text[]))  THEN c.alt_names
        ELSE array_append(COALESCE(c.alt_names, '{}'::text[]), v_name)
      END,
      email              = COALESCE(NULLIF(btrim(c.email), ''), v_email),
      first_seen_date    = LEAST(COALESCE(c.first_seen_date, v_when), v_when),
      last_activity_date = GREATEST(COALESCE(c.last_activity_date, v_when), v_when),
      updated_date       = now()
    WHERE c.id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (
    full_name, phone, email, city, address,
    original_source, contact_status,
    first_seen_date, last_activity_date,
    created_date, updated_date
  )
  VALUES (
    COALESCE(v_name, v_norm), p_phone, v_email,
    NULLIF(btrim(coalesce(p_city, '')), ''),
    NULLIF(btrim(coalesce(p_address, '')), ''),
    NULLIF(btrim(coalesce(p_source, '')), ''),
    'new',
    v_when, v_when,
    v_when, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_or_create_contact IS
  'Find a contact by normalized phone or create one. Race-safe via advisory lock.';


-- ─── 5. Auto-attach a contact to every lead ─────────────────────────────────
-- This one trigger covers ALL lead-creation paths — /NewLead, /NewQuote, the
-- public website_create_lead RPC, the upsertLead webhook and every importer —
-- without editing any of them. Callers that already resolved a contact (the
-- bulk import) set contact_id themselves and the trigger is a no-op.
CREATE OR REPLACE FUNCTION public.leads_attach_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NULL AND NEW.phone IS NOT NULL AND btrim(NEW.phone) <> '' THEN
    NEW.contact_id := public.resolve_or_create_contact(
      NEW.phone, NEW.full_name, NEW.email,
      NULLIF(to_jsonb(NEW) ->> 'city', ''),
      NULLIF(to_jsonb(NEW) ->> 'address', ''),
      NEW.source, NEW.created_date
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_attach_contact ON public.leads;
CREATE TRIGGER trg_leads_attach_contact
  BEFORE INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.leads_attach_contact();


-- ─── 6. Import staging ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name        text,
  external_source  text NOT NULL DEFAULT 'kaveret',
  uploaded_by      text,
  status           text NOT NULL DEFAULT 'uploading',
    -- uploading → ready → processing → done | failed
  mapping          jsonb,
  total_rows       integer NOT NULL DEFAULT 0,
  processed_rows   integer NOT NULL DEFAULT 0,
  created_leads    integer NOT NULL DEFAULT 0,
  updated_leads    integer NOT NULL DEFAULT 0,
  created_contacts integer NOT NULL DEFAULT 0,
  matched_contacts integer NOT NULL DEFAULT 0,
  failed_rows      integer NOT NULL DEFAULT 0,
  error            text,
  created_date     timestamptz NOT NULL DEFAULT now(),
  finished_date    timestamptz
);

CREATE TABLE IF NOT EXISTS public.lead_import_rows (
  id         bigserial PRIMARY KEY,
  batch_id   uuid NOT NULL REFERENCES public.lead_import_batches(id) ON DELETE CASCADE,
  row_number integer,
  data       jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending',
    -- pending → created | updated | failed
  error      text,
  lead_id    uuid,
  contact_id uuid
);

CREATE INDEX IF NOT EXISTS lead_import_rows_pending_idx
  ON public.lead_import_rows (batch_id, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS lead_import_rows_batch_status_idx
  ON public.lead_import_rows (batch_id, status);


-- ─── 7. process_lead_import ─────────────────────────────────────────────────
-- Processes up to p_chunk pending rows and returns progress. The caller loops
-- until done — chunking keeps every statement well inside the timeout and
-- makes an interrupted import resumable (state lives in the table, not in a
-- browser tab).
--
-- The INSERT column list is filtered against information_schema at runtime, so
-- an optional column that does not exist on this database is skipped instead
-- of aborting the run. Mirrors the PGRST204 resilience in src/api/entities.js.
CREATE OR REPLACE FUNCTION public.process_lead_import(
  p_batch_id uuid,
  p_chunk    integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch     public.lead_import_batches%ROWTYPE;
  v_cols      text[];
  r           record;
  v_payload   jsonb;
  v_contact   uuid;
  v_existing  uuid;
  v_lead      uuid;
  v_phone     text;
  v_norm      text;
  v_extid     text;
  v_had       boolean;
  v_set       text;
  v_names     text;
  v_vals      text;
  v_created   integer := 0;
  v_updated   integer := 0;
  v_failed    integer := 0;
  v_newc      integer := 0;
  v_oldc      integer := 0;
  v_done      integer := 0;
  v_remaining integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch FROM public.lead_import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch % not found', p_batch_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.lead_import_batches SET status = 'processing' WHERE id = p_batch_id;

  -- Which of the fields we might write actually exist on this database.
  SELECT array_agg(column_name::text) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'leads'
    AND is_generated = 'NEVER'
    AND column_name = ANY (ARRAY[
      'full_name','phone','email','city','address','source','status','notes',
      'rep1','rep2','pending_rep_email','created_date','updated_date',
      'effective_sort_date','unique_id','external_source','external_id',
      'contact_id','import_batch_id','subject','budget','preferred_product',
      'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
      'landing_page','click_id'
    ]);

  FOR r IN
    SELECT * FROM public.lead_import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY id
    LIMIT p_chunk
  LOOP
    BEGIN
      v_payload := r.data;
      v_phone   := NULLIF(btrim(coalesce(v_payload ->> 'phone', '')), '');
      v_norm    := public.normalize_il_phone(v_phone);
      v_extid   := NULLIF(btrim(coalesce(v_payload ->> 'external_id', '')), '');

      IF v_norm IS NULL THEN
        UPDATE public.lead_import_rows
        SET status = 'failed', error = 'טלפון חסר או לא תקין'
        WHERE id = r.id;
        v_failed := v_failed + 1;
        v_done := v_done + 1;
        CONTINUE;
      END IF;

      -- Contact: resolve or create. Track which, for the report.
      SELECT EXISTS (SELECT 1 FROM public.customers WHERE phone_normalized = v_norm) INTO v_had;
      v_contact := public.resolve_or_create_contact(
        v_phone,
        v_payload ->> 'full_name',
        v_payload ->> 'email',
        v_payload ->> 'city',
        v_payload ->> 'address',
        v_payload ->> 'source',
        NULLIF(v_payload ->> 'created_date', '')::timestamptz
      );
      IF v_had THEN v_oldc := v_oldc + 1; ELSE v_newc := v_newc + 1; END IF;

      -- Fields written on both insert and update.
      v_payload := v_payload
        || jsonb_build_object(
             'contact_id',      v_contact,
             'external_source', v_batch.external_source,
             'import_batch_id', p_batch_id,
             'updated_date',    now()
           );
      -- Mirror the external id into unique_id so the existing upsertLead
      -- dedupe path keeps recognising these rows.
      IF v_extid IS NOT NULL AND 'unique_id' = ANY(v_cols) THEN
        v_payload := v_payload || jsonb_build_object('unique_id', v_extid);
      END IF;
      IF (v_payload ->> 'created_date') IS NOT NULL
         AND NULLIF(v_payload ->> 'effective_sort_date', '') IS NULL THEN
        v_payload := v_payload || jsonb_build_object('effective_sort_date', v_payload ->> 'created_date');
      END IF;

      -- Existing lead for this external id?
      v_existing := NULL;
      IF v_extid IS NOT NULL THEN
        SELECT id INTO v_existing
        FROM public.leads
        WHERE external_source = v_batch.external_source AND external_id = v_extid
        LIMIT 1;
      END IF;

      IF v_existing IS NOT NULL THEN
        SELECT string_agg(format('%I = %L', e.key, e.value), ', ')
        INTO v_set
        FROM jsonb_each_text(v_payload) AS e(key, value)
        WHERE e.key = ANY(v_cols) AND e.key <> 'created_date';

        IF v_set IS NOT NULL THEN
          EXECUTE format('UPDATE public.leads SET %s WHERE id = %L', v_set, v_existing);
        END IF;
        v_lead := v_existing;
        UPDATE public.lead_import_rows
        SET status = 'updated', lead_id = v_lead, contact_id = v_contact, error = NULL
        WHERE id = r.id;
        v_updated := v_updated + 1;
      ELSE
        SELECT string_agg(format('%I', e.key), ', '), string_agg(format('%L', e.value), ', ')
        INTO v_names, v_vals
        FROM jsonb_each_text(v_payload) AS e(key, value)
        WHERE e.key = ANY(v_cols);

        EXECUTE format('INSERT INTO public.leads (%s) VALUES (%s) RETURNING id', v_names, v_vals)
        INTO v_lead;

        UPDATE public.lead_import_rows
        SET status = 'created', lead_id = v_lead, contact_id = v_contact, error = NULL
        WHERE id = r.id;
        v_created := v_created + 1;
      END IF;

      v_done := v_done + 1;

    EXCEPTION WHEN others THEN
      UPDATE public.lead_import_rows
      SET status = 'failed', error = left(SQLERRM, 500)
      WHERE id = r.id;
      v_failed := v_failed + 1;
      v_done := v_done + 1;
    END;
  END LOOP;

  UPDATE public.lead_import_batches SET
    processed_rows   = processed_rows   + v_done,
    created_leads    = created_leads    + v_created,
    updated_leads    = updated_leads    + v_updated,
    failed_rows      = failed_rows      + v_failed,
    created_contacts = created_contacts + v_newc,
    matched_contacts = matched_contacts + v_oldc
  WHERE id = p_batch_id;

  SELECT count(*) INTO v_remaining
  FROM public.lead_import_rows WHERE batch_id = p_batch_id AND status = 'pending';

  IF v_remaining = 0 THEN
    UPDATE public.lead_import_batches
    SET status = 'done', finished_date = now()
    WHERE id = p_batch_id;
  END IF;

  RETURN jsonb_build_object(
    'processed_now',    v_done,
    'remaining',        v_remaining,
    'created_leads',    v_created,
    'updated_leads',    v_updated,
    'failed_rows',      v_failed,
    'created_contacts', v_newc,
    'matched_contacts', v_oldc,
    'done',             v_remaining = 0
  );
END;
$$;


-- ─── 8. Backfill contact_id for the leads already in the table ──────────────
-- Chunked by the caller, not run inline: 104k rows × resolve_or_create_contact
-- would exceed the migration timeout. Call repeatedly until it returns 0.
CREATE OR REPLACE FUNCTION public.backfill_lead_contacts(p_chunk integer DEFAULT 2000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT id, phone, full_name, email, source, created_date
    FROM public.leads
    WHERE contact_id IS NULL AND phone IS NOT NULL AND btrim(phone) <> ''
    ORDER BY created_date NULLS LAST
    LIMIT p_chunk
  LOOP
    UPDATE public.leads
    SET contact_id = public.resolve_or_create_contact(
          r.phone, r.full_name, r.email, NULL, NULL, r.source, r.created_date)
    WHERE id = r.id;
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;


-- ─── 9. RLS + grants ────────────────────────────────────────────────────────
ALTER TABLE public.lead_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_import_rows    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_import_batches_admin ON public.lead_import_batches;
CREATE POLICY lead_import_batches_admin ON public.lead_import_batches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'));

DROP POLICY IF EXISTS lead_import_rows_admin ON public.lead_import_rows;
CREATE POLICY lead_import_rows_admin ON public.lead_import_rows
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_import_rows    TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.lead_import_rows_id_seq     TO authenticated;

REVOKE ALL ON FUNCTION public.process_lead_import(uuid, integer)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_lead_contacts(integer)      FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_lead_import(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_lead_contacts(integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_il_phone(text)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_il_phone(text)            TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_contact(text, text, text, text, text, text, timestamptz)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Post-migration checks:
--   SELECT phone, phone_normalized, phone_valid FROM public.customers LIMIT 20;
--   SELECT count(*) FROM public.leads WHERE contact_id IS NULL;   -- then:
--   SELECT public.backfill_lead_contacts(2000);                   -- repeat until 0
--   SELECT phone_normalized, count(*) FROM public.customers
--     WHERE phone_normalized IS NOT NULL GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;
