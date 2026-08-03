-- ============================================================================
-- Import: keep the ad attribution, and adopt the lead from the right date
-- ============================================================================
-- Two fixes to process_lead_import, both surfaced while reading the readiness
-- numbers before the full ~116k Kaveret run.
--
--   1. THREE MAPPED FIELDS WERE NEVER WRITTEN.
--      facebook_ad_name, facebook_campaign_name and source_form are offered in
--      the import screen's field list, and the Kaveret preset auto-maps
--      facebook_ad_name from `שם מודעה` — but none of the three appeared in the
--      whitelist this function filters its column list against, so they were
--      uploaded to staging and silently dropped on the way into leads.
--
--      They are real lead columns: importLeadsFromGoogleSheets writes
--      facebook_ad_name directly, and ContactEnquiriesCard reads all three to
--      answer "this person came back three times — from which ad?". Importing
--      116k historical leads without them empties that card permanently, and
--      there is no second source to backfill from.
--
--   2. ADOPTION PAIRED ENQUIRIES BY RECENCY, NOT BY DATE.
--      When one phone has several legacy leads, adoption ordered them
--      `updated_date DESC, created_date DESC, id` and took the first. Kaveret
--      rows arrive in file order. Nothing correlated the two, so a March
--      enquiry could land on a January lead — and since created_date is
--      excluded from the UPDATE, the result is a lead that keeps its own date
--      while wearing another enquiry's status and notes.
--
--      import-readiness.sql put a number on it: 14,116 contacts hold 32,852
--      enquiries between them — 28% of the table is in the ambiguous case.
--
--      So when both sides carry a created_date, candidates are now ordered by
--      how close they are to the imported row's date. The previous ordering
--      stays as the tiebreak, and is still the whole ordering when the Kaveret
--      row has no date to match on.
--
--      The match is greedy, not globally optimal: the first row processed for a
--      phone takes its closest lead, the next takes the closest of what is
--      left. Optimal assignment would need all of a phone's rows in hand at
--      once, which the chunked design deliberately does not do. Greedy is a
--      strict improvement over file order and keeps the function row-at-a-time.
--
-- Everything else is unchanged — the adoption guards in particular:
--   external_id IS NULL  — only ever adopts a legacy row.
--   import_batch_id      — a second row on the same phone falls through rather
--                          than overwriting the first one's work.
--   FOR UPDATE
--   SKIP LOCKED          — two concurrent chunks cannot adopt the same lead.
-- ============================================================================

BEGIN;

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
      'facebook_ad_name','facebook_campaign_name','source_form'
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
