-- ============================================================================
-- Task history import: Kaveret's task export → sales_tasks, one row per task
-- ============================================================================
-- The lead import brought the leads over but not their history. The Kaveret
-- LEAD export only carries the titles of a lead's open tasks in one cell, so
-- there was nothing to import: no dates, no status, no rep, and none of the
-- tasks already done. Kaveret's TASK export has all of it, one task per row:
--
--   תאריך יצירה | תאריך תחילת עבודה | מנהל תיק | סטטוס כרטיס | סטטוס משימה |
--   טלפון | טלפון ראשי | משימה - ליד | שם לקוח | תוכן משימה | ליד id
--
-- Same shape as the lead import (src/components/settings/ImportTasksTab.jsx):
-- the browser parses and uploads rows into task_import_rows, and this function
-- does the matching and writing in chunks, so an interrupted run resumes from
-- the table.
--
-- Matching a row to its lead. The export's "ליד id" column is empty in
-- practice, so the lead is found by phone: normalize_il_phone() on the row
-- against leads.phone_normalized (indexed). When several leads share the
-- phone, the one whose name matches the row wins, then the newest. A row whose
-- phone matches no lead is marked `unmatched`, not failed — it is a row the
-- operator has to look at (a lead Kaveret has and this CRM does not), not an
-- error in the row.
--
-- Idempotency. Kaveret gives a task no id, so one is derived from what makes
-- the task the task — lead + creation time + text + due time — and stored in
-- sales_tasks.unique_id. Re-running the same file updates those rows instead
-- of duplicating them.
--
-- Dates. The export writes Israel wall-clock time ("31/08/2026 16:10"); the
-- browser passes it through as 'YYYY-MM-DD HH:MM' and the conversion to an
-- absolute time happens here, AT TIME ZONE 'Asia/Jerusalem', so the DST rule
-- is Postgres's rather than the browser's.
--   תאריך יצירה       → created_date, manual_created_date, work_start_date
--   תאריך תחילת עבודה → due_date (Kaveret's name for "when to do it")
--   completed tasks   → completed_at = due date (the export has no completion
--                       stamp; the due date is the closest fact it holds)
--
-- The column list is filtered against information_schema at runtime, like the
-- lead import, so a column this database lacks is skipped rather than aborting
-- the run.
--
-- BEFORE A BULK RUN: the Database Webhooks on sales_tasks (updateTaskCounters
-- and friends, configured in the Supabase dashboard, not in this repo) fire
-- once per inserted row. Pause them for the run, as for the lead import.
-- ============================================================================

BEGIN;

-- ─── 1. sales_tasks.unique_id ────────────────────────────────────────────────
-- The Sheets task importer already reads and writes this column; make sure it
-- exists and is indexed, since every imported row looks itself up by it.
ALTER TABLE public.sales_tasks ADD COLUMN IF NOT EXISTS unique_id text;
CREATE INDEX IF NOT EXISTS sales_tasks_unique_id_idx
  ON public.sales_tasks (unique_id) WHERE unique_id IS NOT NULL;

-- ─── 2. Staging ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name        text,
  external_source  text NOT NULL DEFAULT 'kaveret',
  uploaded_by      text,
  status           text NOT NULL DEFAULT 'uploading',
    -- uploading → ready → processing → done | failed
  mapping          jsonb,
  total_rows       integer NOT NULL DEFAULT 0,
  processed_rows   integer NOT NULL DEFAULT 0,
  created_tasks    integer NOT NULL DEFAULT 0,
  updated_tasks    integer NOT NULL DEFAULT 0,
  unmatched_rows   integer NOT NULL DEFAULT 0,
  failed_rows      integer NOT NULL DEFAULT 0,
  error            text,
  created_date     timestamptz NOT NULL DEFAULT now(),
  finished_date    timestamptz
);

CREATE TABLE IF NOT EXISTS public.task_import_rows (
  id         bigserial PRIMARY KEY,
  batch_id   uuid NOT NULL REFERENCES public.task_import_batches(id) ON DELETE CASCADE,
  row_number integer,
  data       jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending',
    -- pending → created | updated | unmatched | failed
  error      text,
  lead_id    uuid,
  task_id    uuid
);

CREATE INDEX IF NOT EXISTS task_import_rows_pending_idx
  ON public.task_import_rows (batch_id, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS task_import_rows_batch_status_idx
  ON public.task_import_rows (batch_id, status);

-- ─── 3. process_task_import ─────────────────────────────────────────────────
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
      'completed_at','unique_id'
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

      -- Then by phone: name-matched first, then the newest.
      IF v_lead IS NULL AND v_norm IS NOT NULL THEN
        SELECT id INTO v_lead
        FROM public.leads
        WHERE phone_normalized = v_norm
        ORDER BY (v_name IS NOT NULL AND full_name ILIKE '%' || v_name || '%') DESC,
                 created_date DESC NULLS LAST
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

      -- What makes this task this task. The browser may hand over an id of its
      -- own (a file that has one); otherwise derive it.
      v_uid := coalesce(
        NULLIF(btrim(coalesce(d ->> 'unique_id', '')), ''),
        'kaveret:' || md5(v_lead::text || '|' || coalesce(d ->> 'created_at', '')
                          || '|' || coalesce(v_summary, '') || '|' || coalesce(d ->> 'due_at', ''))
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
        'unique_id',           v_uid
      ));

      v_names := ''; v_vals := ''; v_set := '';
      FOR k IN SELECT key FROM jsonb_each(v_row) LOOP
        IF k = ANY (v_cols) THEN
          v_names := v_names || CASE WHEN v_names = '' THEN '' ELSE ', ' END || quote_ident(k);
          v_vals  := v_vals  || CASE WHEN v_vals  = '' THEN '' ELSE ', ' END || quote_nullable(v_row ->> k);
          IF k NOT IN ('lead_id', 'unique_id', 'created_date') THEN
            v_set := v_set || CASE WHEN v_set = '' THEN '' ELSE ', ' END
                     || quote_ident(k) || ' = ' || quote_nullable(v_row ->> k);
          END IF;
        END IF;
      END LOOP;

      IF 'unique_id' = ANY (v_cols) THEN
        SELECT id INTO v_task FROM public.sales_tasks WHERE unique_id = v_uid LIMIT 1;
      END IF;

      IF v_task IS NOT NULL THEN
        EXECUTE format('UPDATE public.sales_tasks SET %s WHERE id = %L', v_set, v_task);
        UPDATE public.task_import_rows
        SET status = 'updated', lead_id = v_lead, task_id = v_task WHERE id = r.id;
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

-- ─── 4. RLS + grants ────────────────────────────────────────────────────────
ALTER TABLE public.task_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_import_rows    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_import_batches_admin ON public.task_import_batches;
CREATE POLICY task_import_batches_admin ON public.task_import_batches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'));

DROP POLICY IF EXISTS task_import_rows_admin ON public.task_import_rows;
CREATE POLICY task_import_rows_admin ON public.task_import_rows
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u
                 WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
                   AND u.role = 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_import_rows    TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.task_import_rows_id_seq     TO authenticated;

REVOKE ALL ON FUNCTION public.process_task_import(uuid, integer)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_task_import(uuid, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
