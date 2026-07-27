-- ============================================================================
-- Import adopts existing leads by phone instead of duplicating them
-- ============================================================================
-- This is what replaces the wipe.
--
-- The plan was: delete the old leads, then import Kaveret clean. Production
-- said otherwise. scripts/status-check.sql reported six foreign keys blocking
-- DELETE FROM leads — sales_tasks, quotes, orders, call_logs,
-- whatsapp_message_logs, communication_logs. Those hold orders, price quotes
-- and call history, so the wipe was either going to be refused or to destroy
-- sales history.
--
-- But the wipe was only ever a way to avoid duplicates. All 115,090 existing
-- leads were stored without a Kaveret external_id, so importing on top of them
-- would create a second lead row per person — which is the actual thing being
-- avoided.
--
-- So: when an imported row finds no lead carrying its Kaveret id, it now looks
-- for a LEGACY lead on the same normalized phone and adopts it — stamping the
-- Kaveret id onto the row that already exists, and updating it in place. The
-- orders and quotes hanging off that lead stay attached, and nothing is
-- deleted.
--
-- Safety of the match, in the order the guards appear:
--   external_id IS NULL  — only ever adopts a legacy row. A lead already
--                          claimed by a DIFFERENT Kaveret id is never stolen.
--   import_batch_id      — once a row adopts a lead, the payload stamps this
--                          batch onto it, so a second import row with the same
--                          phone falls through and creates its own lead rather
--                          than overwriting the first one's work.
--   FOR UPDATE
--   SKIP LOCKED          — two concurrent chunks cannot adopt the same lead.
--   deterministic ORDER  — when one phone has several legacy leads, the most
--                          recently touched wins, and the rest stay as history
--                          all pointing at the same contact.
--
-- adopted_leads is reported separately from updated_leads so the import screen
-- can show how much of the existing pipeline was absorbed rather than added.
-- ============================================================================

BEGIN;

ALTER TABLE public.lead_import_batches
  ADD COLUMN IF NOT EXISTS adopted_leads integer NOT NULL DEFAULT 0;

-- 'adopted' joins 'created' / 'updated' / 'failed' as a per-row outcome.
COMMENT ON COLUMN public.lead_import_batches.adopted_leads IS
  'Legacy leads matched by phone and claimed by this batch, rather than duplicated.';

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
  v_adopt     uuid;
  v_adopted   integer := 0;
  v_order     text;
  v_claimed   uuid;
  v_created   integer := 0;
  v_updated   integer := 0;
  v_failed    integer := 0;
  v_newc      integer := 0;
  v_oldc      integer := 0;
  v_done      integer := 0;
  v_remaining integer;
BEGIN
  -- Was an inline JWT-only check. 20260727000001 introduced
  -- assert_admin_or_service() for exactly this shape and deliberately left
  -- process_lead_import alone rather than duplicate its 150-line body to swap
  -- four lines. This file rebuilds the body anyway, so the swap is free — and
  -- it makes a stalled batch resumable from the SQL editor, which the JWT-only
  -- guard refused.
  PERFORM public.assert_admin_or_service();

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

  -- Ordering for legacy-lead adoption, built from columns this database
  -- actually has. leads carries no last_activity_date (that lives on
  -- customers), so "most recently touched" is the best available proxy for
  -- "the row the sales floor is really working".
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

      -- No lead carries this Kaveret id yet. Before creating a second row for
      -- somebody the CRM already knows, look for a LEGACY lead on the same
      -- normalized phone and adopt it.
      --
      -- This is what replaces the wipe. The 115,090 leads already in
      -- production were stored without an external id, so a straight import
      -- would have produced one duplicate lead per person — and deleting them
      -- first is blocked by six foreign keys holding orders, quotes and call
      -- history. Adoption keeps that history attached and still lands the
      -- Kaveret data.
      --
      -- external_id IS NULL restricts this to legacy rows: a lead already
      -- claimed by a DIFFERENT Kaveret id must never be stolen.
      -- import_batch_id guards the same batch — once a row adopts a lead the
      -- payload stamps this batch id on it, so a second row with the same
      -- phone falls through and creates its own lead instead of overwriting
      -- the first one's work.
      -- SKIP LOCKED keeps two concurrent chunks from adopting the same lead.
      IF v_existing IS NULL THEN
        EXECUTE format(
          'SELECT id FROM public.leads
            WHERE phone_normalized = %L
              AND external_id IS NULL
              AND (import_batch_id IS NULL OR import_batch_id <> %L)
            ORDER BY %s
            LIMIT 1
            FOR UPDATE SKIP LOCKED',
          v_norm, p_batch_id, v_order)
        INTO v_adopt;

        IF v_adopt IS NOT NULL THEN
          v_existing := v_adopt;
          v_adopted  := v_adopted + 1;
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
        IF v_adopt IS DISTINCT FROM v_existing THEN
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
