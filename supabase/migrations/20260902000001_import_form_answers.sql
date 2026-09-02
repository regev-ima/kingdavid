-- ============================================================================
-- Import: the lead form's two answers land on the lead, tasks stay out of notes
-- ============================================================================
-- The Kaveret preset used to map the export's "משימות פתוחות" column into
-- leads.notes. That cell is the titles of the lead's open tasks — "3450 כולל
-- הובלה" — not a remark about the lead, and it carries none of what a task is
-- (dates, status, rep, the ones already done). Reps read הערות expecting the
-- customer's own words and found a task headline instead. The preset no
-- longer maps it (src/lib/kaveretPreset.js); task history is a separate
-- import from Kaveret's task export.
--
-- What DOES belong beside the notes are the two answers the customer gave on
-- the lead form — which mattress size they want and where they want to try
-- it. Kaveret keeps them as custom fields; the preset now maps them to
-- facebook_requested_size / facebook_try_at_home, the columns the API webhook
-- already fills for form leads. This migration lets the import write them:
-- process_lead_import filters its column list against a whitelist, and until
-- now those two were not on it, so a mapped answer was uploaded to staging and
-- silently dropped on the way into leads (the same trap the attribution
-- fields fell into in 20260803000003).
--
-- Everything else is byte-identical to 20260803000006.
--
-- Leads imported earlier still carry task titles in notes. Clearing those is a
-- separate step for after the task history has been imported, so nothing is
-- lost in between.
-- ============================================================================

BEGIN;

-- The lead card and the API webhook already read and write these two, but no
-- migration in this repo ever created them; on a database where they are
-- missing the import's runtime column check would just skip them.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS facebook_requested_size text,
  ADD COLUMN IF NOT EXISTS facebook_try_at_home    text;


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
  v_rowdate   timestamptz;
  v_had       boolean;
  v_set       text;
  v_names     text;
  v_vals      text;
  v_adopt     uuid;
  v_adopted   integer := 0;
  v_order     text;
  v_order_row text;
  v_created   integer := 0;
  v_updated   integer := 0;
  v_failed    integer := 0;
  v_newc      integer := 0;
  v_oldc      integer := 0;
  v_done      integer := 0;
  v_remaining integer;
BEGIN
  PERFORM public.assert_admin_or_service();

  SELECT * INTO v_batch FROM public.lead_import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch % not found', p_batch_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.lead_import_batches SET status = 'processing' WHERE id = p_batch_id;

  -- Which of the fields we might write actually exist on this database.
  -- Filtered at runtime rather than assumed, so a column this list names but
  -- the database lacks is skipped instead of aborting the run — which is also
  -- what makes adding the three attribution fields below safe to deploy
  -- without first confirming the production schema.
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
      'landing_page','click_id',
      -- Marketing attribution. Mapped in the import UI since day one; missing
      -- from this list until now, which meant mapping them did nothing.
      'facebook_ad_name','facebook_campaign_name','source_form',
      -- The lead form's two questions (mattress size, where to try it).
      'facebook_requested_size','facebook_try_at_home'
    ]);

  -- Fallback ordering for legacy-lead adoption, built from columns this
  -- database actually has. Used verbatim when the imported row carries no
  -- date, and as the tiebreak behind date proximity when it does. leads has no
  -- last_activity_date (that lives on customers), so "most recently touched"
  -- remains the best available proxy for "the row the sales floor is working".
  v_order := 'id';
  IF 'created_date' = ANY(v_cols) THEN v_order := 'created_date DESC NULLS LAST, ' || v_order; END IF;
  IF 'updated_date' = ANY(v_cols) THEN v_order := 'updated_date DESC NULLS LAST, ' || v_order; END IF;

  FOR r IN
    SELECT * FROM public.lead_import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY id
    LIMIT p_chunk
  LOOP
    BEGIN
      v_adopt   := NULL;
      v_payload := r.data;
      v_phone   := NULLIF(btrim(coalesce(v_payload ->> 'phone', '')), '');
      v_norm    := public.normalize_il_phone(v_phone);
      v_extid   := NULLIF(btrim(coalesce(v_payload ->> 'external_id', '')), '');
      v_rowdate := NULLIF(v_payload ->> 'created_date', '')::timestamptz;

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
        v_rowdate
      );
      IF v_had THEN v_oldc := v_oldc + 1; ELSE v_newc := v_newc + 1; END IF;

      -- leads.full_name is NOT NULL, and an empty name cell is dropped from
      -- the payload like every other blank — so the INSERT aborted the row
      -- rather than landing it (4 rows in the last run). The phone is what
      -- resolve_or_create_contact already falls back to for the contact's
      -- name; reuse it here instead of losing the lead over a blank cell.
      IF NULLIF(btrim(coalesce(v_payload ->> 'full_name', '')), '') IS NULL THEN
        v_payload := v_payload || jsonb_build_object('full_name', coalesce(v_phone, v_norm));
      END IF;

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
      -- Always set, never conditionally. The BEFORE INSERT trigger that used
      -- to cover a missing value (leads_effective_sort_date_default) is
      -- suppressed by the bulk runner, and a NULL here makes the lead
      -- invisible to every date-range filter in ניהול לידים — the exact bug
      -- 20260707000001 was written to fix. now() matches what that trigger
      -- would have chosen for a row with no date of its own.
      IF NULLIF(v_payload ->> 'effective_sort_date', '') IS NULL THEN
        v_payload := v_payload || jsonb_build_object(
          'effective_sort_date',
          COALESCE(NULLIF(v_payload ->> 'created_date', ''), now()::text));
      END IF;

      -- Existing lead for this external id?
      v_existing := NULL;
      IF v_extid IS NOT NULL THEN
        SELECT id INTO v_existing
        FROM public.leads
        WHERE external_source = v_batch.external_source AND external_id = v_extid
        LIMIT 1;

        -- Nothing carries the id in external_id yet — but it may already be
        -- sitting in unique_id. Leads that arrived through the API were stored
        -- with the Kaveret id there, and leads.unique_id is UNIQUE.
        --
        -- Without this lookup the row fell through to phone adoption, picked
        -- whichever lead was closest by date, and tried to stamp a unique_id
        -- that another row already owns:
        --   duplicate key value violates unique constraint "leads_unique_id_uidx"
        -- 1,424 rows of the 125,280-row import died that way, all of them in
        -- the stretch of the file where nearly every lead already existed here.
        --
        -- Matching on the id itself is also simply better than guessing by
        -- phone: it is the same source record, not merely the same person.
        -- Restricted to rows not already claimed by a DIFFERENT Kaveret id, so
        -- this can never steal one import row's lead for another's.
        IF v_existing IS NULL AND 'unique_id' = ANY(v_cols) THEN
          SELECT id INTO v_existing
          FROM public.leads
          WHERE unique_id = v_extid
            AND (external_id IS NULL OR external_id = v_extid)
          LIMIT 1;
        END IF;
      END IF;

      -- No lead carries this Kaveret id yet. Before creating a second row for
      -- somebody the CRM already knows, look for a LEGACY lead on the same
      -- normalized phone and adopt it — stamping the Kaveret id onto the row
      -- that already exists, so its orders and quotes stay attached.
      --
      -- Which legacy lead, when there are several, is the question this
      -- migration changes: the closest by creation date rather than the most
      -- recently touched. See the header.
      IF v_existing IS NULL THEN
        IF v_rowdate IS NOT NULL AND 'created_date' = ANY(v_cols) THEN
          -- `created_date IS NULL` first: false sorts before true, so leads
          -- with a date are preferred over undated ones, which have no
          -- distance to compare and would otherwise sort as if perfectly
          -- matched.
          v_order_row := format(
            'created_date IS NULL, abs(extract(epoch FROM (created_date - %L::timestamptz))), %s',
            v_rowdate, v_order);
        ELSE
          v_order_row := v_order;
        END IF;

        EXECUTE format(
          'SELECT id FROM public.leads
            WHERE phone_normalized = %L
              AND external_id IS NULL
              AND (import_batch_id IS NULL OR import_batch_id <> %L)
            ORDER BY %s
            LIMIT 1
            FOR UPDATE SKIP LOCKED',
          v_norm, p_batch_id, v_order_row)
        INTO v_adopt;

        IF v_adopt IS NOT NULL THEN
          v_existing := v_adopt;
        END IF;
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
        SET status = CASE WHEN v_adopt = v_existing THEN 'adopted' ELSE 'updated' END,
            lead_id = v_lead, contact_id = v_contact, error = NULL
        WHERE id = r.id;
        -- Counted here, not at the point the candidate was found. v_adopted
        -- used to be incremented before this UPDATE ran, and a PL/pgSQL
        -- variable is not rolled back by the exception handler — so a row that
        -- adopted and then threw was reported as BOTH adopted and failed. One
        -- chunk logged "adopted 491, created 5, failed 196" out of 500.
        IF v_adopt IS NOT DISTINCT FROM v_existing THEN
          v_adopted := v_adopted + 1;
        ELSE
          v_updated := v_updated + 1;
        END IF;
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
    adopted_leads    = adopted_leads    + v_adopted,
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
    'adopted_leads',    v_adopted,
    'failed_rows',      v_failed,
    'created_contacts', v_newc,
    'matched_contacts', v_oldc,
    'done',             v_remaining = 0
  );
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
