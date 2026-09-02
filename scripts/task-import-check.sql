-- ============================================================================
-- Task import check — one lead, its tasks, and the latest import batches.
-- ============================================================================
-- Read-only. Answers "did the tasks land on the lead, and on whom" for one
-- lead — the one whose card was used to spec the import (phone 0556676193) —
-- plus the state of the most recent task_import_batches, so a run can be
-- judged without opening the SQL Editor.
--
-- One result set, one shape, so the diagnostics workflow renders it as a
-- single table:
--   kind    lead | batch | task
--   when    lead: created; batch: started; task: created (Kaveret stamp)
--   title   lead: name + phone; batch: file; task: text
--   status  lead: lead status; batch: batch status; task: open/done + lead status
--   rep     rep1
--   detail  lead: id; batch: counts; task: due date · import id · created here?
-- ============================================================================

WITH the_lead AS (
  SELECT *
  FROM public.leads
  WHERE phone_normalized = public.normalize_il_phone('0556676193')
  ORDER BY created_date DESC NULLS LAST
  LIMIT 5
),
rows_out AS (
  SELECT
    0 AS ord,
    'lead' AS kind,
    to_char(l.created_date AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI') AS "when",
    coalesce(l.full_name, '') || ' · ' || coalesce(l.phone, '') AS title,
    coalesce(l.status, '') AS status,
    coalesce(l.rep1, '') AS rep,
    'id ' || l.id::text
      || ' · notes: ' || left(coalesce(l.notes, ''), 60) AS detail,
    l.created_date AS sort_ts
  FROM the_lead l

  UNION ALL
  SELECT
    1,
    'batch',
    to_char(b.created_date AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI'),
    coalesce(b.file_name, b.id::text),
    b.status,
    coalesce(b.uploaded_by, ''),
    'rows ' || b.total_rows || ' · processed ' || b.processed_rows
      || ' · created ' || b.created_tasks || ' · updated ' || b.updated_tasks
      || ' · unmatched ' || b.unmatched_rows || ' · failed ' || b.failed_rows,
    b.created_date
  FROM public.task_import_batches b

  UNION ALL
  SELECT
    2,
    'task',
    to_char(coalesce(t.manual_created_date, t.created_date) AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI'),
    left(coalesce(t.summary, ''), 80),
    CASE WHEN t.task_status = 'completed' THEN 'בוצעה' ELSE 'פתוחה' END
      || coalesce(' · ' || t.status, ''),
    coalesce(t.rep1, ''),
    'due ' || coalesce(to_char(t.due_date AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI'), '—')
      || ' · type ' || coalesce(t.task_type, '')
      || CASE WHEN coalesce(t.unique_id, '') LIKE 'kaveret:%' THEN ' · מיובאת' ELSE ' · נוצרה כאן' END,
    coalesce(t.manual_created_date, t.created_date)
  FROM public.sales_tasks t
  WHERE t.lead_id IN (SELECT id FROM the_lead)
)
SELECT kind, "when", title, status, rep, detail
FROM rows_out
ORDER BY ord,
         CASE WHEN ord = 1 THEN sort_ts END DESC,
         CASE WHEN ord = 2 THEN sort_ts END DESC
LIMIT 60;
