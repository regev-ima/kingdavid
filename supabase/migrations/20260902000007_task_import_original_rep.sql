-- ============================================================================
-- Task import: keep the Kaveret rep on the task
-- ============================================================================
-- An open task of a rep who left is handed to the lead's current owner or the
-- fallback rep, and until now that was the only rep the task remembered. The
-- card then said the follow-up was Yonatan's when it was Miri's, and nothing
-- on the task said otherwise.
--
-- sales_tasks.imported_rep holds the address the task carried in Kaveret, for
-- every imported task, whether or not rep1 was changed. The task dialog shows
-- it as "נציג בכוורת" when it differs from rep1. A former rep who is added as
-- a disabled user (with a name) is then shown by name wherever the address
-- appears, history included.
--
-- process_task_import is otherwise byte-identical to 20260902000006.
-- ============================================================================

BEGIN;

ALTER TABLE public.sales_tasks ADD COLUMN IF NOT EXISTS imported_rep text;

CREATE OR REPLACE FUNCTION public.process_task_import(
  p_batch_id uuid,
  p_chunk    integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch       public.task_import_batches%ROWTYPE;
  v_cols        text[];
  r             record;
  d             jsonb;
  k             text;
  v_phone       text;
  v_norm        text;
  v_name        text;
  v_extid       text;
  v_summary     text;
  v_rep1        text;
  v_status      text;
  v_task_status text;
  v_type        text;
  v_created     timestamptz;
  v_due         timestamptz;
  v_lead        uuid;
  v_task        uuid;
  v_uid         text;
  v_uid_legacy  text;
  v_uid_v2      text;
  v_prev        jsonb;
  v_lead_rep    text;
  v_rep_orig    text;
  v_row         jsonb;
  v_names       text;
  v_vals        text;
  v_set         text;
  v_created_n   integer := 0;
  v_updated_n   integer := 0;
  v_unmatched_n integer := 0;
  v_failed_n    integer := 0;
  v_done        integer := 0;
  v_remaining   integer;
BEGIN
  PERFORM public.assert_admin_or_service();

  SELECT * INTO v_batch FROM public.task_import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch % not found', p_batch_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.task_import_batches SET status = 'processing' WHERE id = p_batch_id;

  SELECT array_agg(column_name::text) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_tasks'
    AND is_generated = 'NEVER'
    AND column_name = ANY (ARRAY[
      'lead_id','rep1','rep2','task_type','task_status','status','summary',
      'due_date','work_start_date','manual_created_date','created_date',
      'completed_at','unique_id','imported_rep'
    ]);

  FOR r IN
    SELECT * FROM public.task_import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY id
    LIMIT p_chunk
  LOOP
    BEGIN
      d       := r.data;
      v_lead  := NULL;
      v_task  := NULL;

      v_phone   := NULLIF(btrim(coalesce(d ->> 'phone', '')), '');
      v_norm    := public.normalize_il_phone(v_phone);
      v_name    := NULLIF(btrim(coalesce(d ->> 'full_name', '')), '');
      v_extid   := NULLIF(btrim(coalesce(d ->> 'external_lead_id', '')), '');
      v_summary := NULLIF(btrim(coalesce(d ->> 'summary', '')), '');
      v_rep1    := NULLIF(lower(btrim(coalesce(d ->> 'rep1', ''))), '');
      -- Who had it in Kaveret, kept on the task whatever happens to rep1
      -- below — the name a card shows for "whose call was this" when the
      -- open task itself had to move to someone who still works here.
      v_rep_orig := v_rep1;
      v_status  := NULLIF(btrim(coalesce(d ->> 'status', '')), '');
      v_type    := coalesce(NULLIF(btrim(coalesce(d ->> 'task_type', '')), ''), 'call');
      v_task_status := CASE WHEN d ->> 'task_status' = 'completed' THEN 'completed' ELSE 'not_completed' END;

      v_created := CASE WHEN NULLIF(d ->> 'created_at', '') IS NOT NULL
                        THEN ((d ->> 'created_at')::timestamp AT TIME ZONE 'Asia/Jerusalem') END;
      v_due     := CASE WHEN NULLIF(d ->> 'due_at', '') IS NOT NULL
                        THEN ((d ->> 'due_at')::timestamp AT TIME ZONE 'Asia/Jerusalem') END;

      -- The lead. Kaveret's own id first, when the export carries one; the
      -- lead import stores it in external_id and mirrors it into unique_id.
      IF v_extid IS NOT NULL THEN
        SELECT id INTO v_lead
        FROM public.leads
        WHERE (external_source = v_batch.external_source AND external_id = v_extid)
           OR unique_id = v_extid
        ORDER BY created_date DESC NULLS LAST
        LIMIT 1;
      END IF;

      -- Then by phone: name-matched first, then THE LEAD THAT EXISTED WHEN
      -- THE TASK WAS CREATED — the newest lead created at or before the
      -- task's creation stamp, or the earliest lead when none predates it.
      -- One phone can hold several leads here (an enquiry from February and
      -- a fresh form in August) where Kaveret had one card; "newest lead"
      -- hung February's calls on the August lead and left the February card
      -- empty.
      IF v_lead IS NULL AND v_norm IS NOT NULL THEN
        SELECT id INTO v_lead
        FROM public.leads
        WHERE phone_normalized = v_norm
        ORDER BY (v_name IS NOT NULL AND full_name ILIKE '%' || v_name || '%') DESC,
                 (v_created IS NULL OR created_date IS NULL OR created_date <= v_created) DESC,
                 CASE WHEN v_created IS NULL OR created_date IS NULL OR created_date <= v_created
                      THEN created_date END DESC NULLS LAST,
                 created_date ASC
        LIMIT 1;
      END IF;

      IF v_lead IS NULL THEN
        UPDATE public.task_import_rows
        SET status = 'unmatched',
            error  = CASE WHEN v_phone IS NULL THEN 'אין טלפון בשורה'
                          ELSE 'לא נמצא ליד לטלפון ' || v_phone END
        WHERE id = r.id;
        v_unmatched_n := v_unmatched_n + 1;
        v_done := v_done + 1;
        CONTINUE;
      END IF;

      -- A rep who is no longer a user here. The row says so (the browser
      -- checked the address against the users list) and names the fallback.
      -- A task already done keeps the address it was done under — that is
      -- history — unless the operator asked to move those too. An OPEN task
      -- has to land in someone's queue: the lead's current owner here, who
      -- inherited the lead, or else the fallback the operator picked.
      IF (d ->> 'rep_unknown') = 'true'
         AND (v_task_status = 'not_completed' OR (d ->> 'rep_move_completed') = 'true') THEN
        SELECT NULLIF(lower(btrim(coalesce(rep1, ''))), '') INTO v_lead_rep
        FROM public.leads WHERE id = v_lead;
        v_rep1 := coalesce(
          v_lead_rep,
          NULLIF(lower(btrim(coalesce(d ->> 'rep_fallback', ''))), ''),
          v_rep1
        );
      END IF;

      -- What makes this task this task: the lead, the minute Kaveret created
      -- it, and its text. The full run showed Kaveret DOES create two tasks
      -- on one lead in the same minute (a note and a call, rows 4893/4894),
      -- so lead + minute alone folded the second into the first. The text
      -- tells them apart; the due date stays out of the identity, because a
      -- rescheduled follow-up is the edit a re-run is meant to carry over.
      -- A row with no creation stamp falls back to text + due date, the only
      -- identity it has.
      --
      -- The browser may hand over an id of its own (a file that has one).
      v_uid_legacy := 'kaveret:' || md5(v_lead::text || '|' || coalesce(d ->> 'created_at', '')
                          || '|' || coalesce(v_summary, '') || '|' || coalesce(d ->> 'due_at', ''));
      v_uid_v2 := CASE WHEN NULLIF(d ->> 'created_at', '') IS NOT NULL
                       THEN 'kaveret:v2:' || md5(v_lead::text || '|' || (d ->> 'created_at'))
                       ELSE v_uid_legacy END;
      v_uid := coalesce(
        NULLIF(btrim(coalesce(d ->> 'unique_id', '')), ''),
        CASE WHEN NULLIF(d ->> 'created_at', '') IS NOT NULL
             THEN 'kaveret:v3:' || md5(v_lead::text || '|' || (d ->> 'created_at')
                                       || '|' || lower(coalesce(v_summary, '')))
             ELSE v_uid_legacy END
      );

      v_row := jsonb_strip_nulls(jsonb_build_object(
        'lead_id',             v_lead,
        'rep1',                v_rep1,
        'task_type',           v_type,
        'task_status',         v_task_status,
        'status',              v_status,
        'summary',             coalesce(v_summary, ''),
        'due_date',            v_due,
        'work_start_date',     v_created,
        'manual_created_date', v_created,
        'created_date',        v_created,
        'completed_at',        CASE WHEN v_task_status = 'completed' THEN coalesce(v_due, v_created) END,
        'unique_id',           v_uid,
        'imported_rep',        v_rep_orig
      ));

      v_names := ''; v_vals := ''; v_set := '';
      FOR k IN SELECT key FROM jsonb_each(v_row) LOOP
        IF k = ANY (v_cols) THEN
          v_names := v_names || CASE WHEN v_names = '' THEN '' ELSE ', ' END || quote_ident(k);
          v_vals  := v_vals  || CASE WHEN v_vals  = '' THEN '' ELSE ', ' END || quote_nullable(v_row ->> k);
          -- unique_id rides along in the UPDATE so a row found under the
          -- earlier derivation (lead + time + text + due) is moved to the
          -- current one, and the next run finds it there directly.
          IF k NOT IN ('lead_id', 'created_date') THEN
            v_set := v_set || CASE WHEN v_set = '' THEN '' ELSE ', ' END
                     || quote_ident(k) || ' = ' || quote_nullable(v_row ->> k);
          END IF;
        END IF;
      END LOOP;

      IF 'unique_id' = ANY (v_cols) THEN
        SELECT id INTO v_task FROM public.sales_tasks
        WHERE unique_id IN (v_uid, v_uid_v2, v_uid_legacy)
        ORDER BY (unique_id = v_uid) DESC, (unique_id = v_uid_v2) DESC
        LIMIT 1;
      END IF;

      IF v_task IS NOT NULL THEN
        -- Snapshot the row before touching it, so rollback_task_import() can
        -- put it back exactly. The whole row, not just the columns written:
        -- cheap, and it does not have to track this column list.
        SELECT to_jsonb(t) INTO v_prev FROM public.sales_tasks t WHERE t.id = v_task;
        EXECUTE format('UPDATE public.sales_tasks SET %s WHERE id = %L', v_set, v_task);
        UPDATE public.task_import_rows
        SET status = 'updated', lead_id = v_lead, task_id = v_task, previous = v_prev WHERE id = r.id;
        v_updated_n := v_updated_n + 1;
      ELSE
        EXECUTE format('INSERT INTO public.sales_tasks (%s) VALUES (%s) RETURNING id', v_names, v_vals)
          INTO v_task;
        UPDATE public.task_import_rows
        SET status = 'created', lead_id = v_lead, task_id = v_task WHERE id = r.id;
        v_created_n := v_created_n + 1;
      END IF;

      v_done := v_done + 1;

    EXCEPTION WHEN others THEN
      UPDATE public.task_import_rows
      SET status = 'failed', error = left(SQLERRM, 500)
      WHERE id = r.id;
      v_failed_n := v_failed_n + 1;
      v_done := v_done + 1;
    END;
  END LOOP;

  UPDATE public.task_import_batches SET
    processed_rows = processed_rows + v_done,
    created_tasks  = created_tasks  + v_created_n,
    updated_tasks  = updated_tasks  + v_updated_n,
    unmatched_rows = unmatched_rows + v_unmatched_n,
    failed_rows    = failed_rows    + v_failed_n
  WHERE id = p_batch_id;

  SELECT count(*) INTO v_remaining
  FROM public.task_import_rows WHERE batch_id = p_batch_id AND status = 'pending';

  IF v_remaining = 0 THEN
    UPDATE public.task_import_batches
    SET status = 'done', finished_date = now()
    WHERE id = p_batch_id;
  END IF;

  RETURN jsonb_build_object(
    'processed_now',  v_done,
    'remaining',      v_remaining,
    'created_tasks',  v_created_n,
    'updated_tasks',  v_updated_n,
    'unmatched_rows', v_unmatched_n,
    'failed_rows',    v_failed_n,
    'done',           v_remaining = 0
  );
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
