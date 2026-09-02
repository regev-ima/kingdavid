-- ============================================================================
-- Lead gap check — why one day counts fewer leads here than in Kaveret.
-- ============================================================================
-- Read-only. Kaveret's funnel for 30/08/2026 says 190 leads; the lead screen
-- here, filtered to that day, says 171. One table that separates the usual
-- suspects: which date column the tile counts on, the Israel day versus the
-- UTC day, what the import did with that day's rows (adopted into an older
-- lead, failed on the phone), and duplicates Kaveret counts twice.
-- ============================================================================

WITH day AS (
  SELECT ('2026-08-30 00:00'::timestamp AT TIME ZONE 'Asia/Jerusalem') AS d0,
         ('2026-08-31 00:00'::timestamp AT TIME ZONE 'Asia/Jerusalem') AS d1
),
day_rows AS (
  SELECT r.*, b.file_name
  FROM public.lead_import_rows r
  JOIN public.lead_import_batches b ON b.id = r.batch_id, day
  WHERE (r.data ->> 'created_date') IS NOT NULL
    AND (r.data ->> 'created_date')::timestamptz >= day.d0
    AND (r.data ->> 'created_date')::timestamptz <  day.d1
),
checks AS (
  SELECT 1 AS ord, 'leads: created_date in Israel day 30/08' AS label, count(*)::text AS value
  FROM public.leads, day WHERE created_date >= d0 AND created_date < d1

  UNION ALL
  SELECT 2, 'leads: effective_sort_date in Israel day 30/08 (what the tile counts)', count(*)::text
  FROM public.leads, day WHERE effective_sort_date >= d0 AND effective_sort_date < d1

  UNION ALL
  SELECT 3, 'leads: created_date in UTC day 30/08', count(*)::text
  FROM public.leads WHERE created_date >= '2026-08-30'::timestamptz AND created_date < '2026-08-31'::timestamptz

  UNION ALL
  SELECT 4, 'leads on 30/08 (Israel, effective_sort_date) by source', 
         coalesce(string_agg(src || ': ' || n, ' · ' ORDER BY n DESC), '—')
  FROM (SELECT coalesce(external_source, 'app/webhook') src, count(*) n
        FROM public.leads, day WHERE effective_sort_date >= d0 AND effective_sort_date < d1
        GROUP BY 1) s

  UNION ALL
  SELECT 5, 'leads on 30/08 (Israel) with no rep1', count(*)::text
  FROM public.leads, day WHERE effective_sort_date >= d0 AND effective_sort_date < d1
    AND nullif(btrim(coalesce(rep1, '')), '') IS NULL

  UNION ALL
  SELECT 6, 'import rows whose Kaveret created_date is 30/08', count(*)::text FROM day_rows

  UNION ALL
  SELECT 7, 'import rows dated 30/08 by outcome', 
         coalesce(string_agg(status || ': ' || n, ' · ' ORDER BY n DESC), '—')
  FROM (SELECT status, count(*) n FROM day_rows GROUP BY 1) s

  UNION ALL
  SELECT 8, 'import rows dated 30/08: distinct phones', count(DISTINCT public.normalize_il_phone(data ->> 'phone'))::text
  FROM day_rows

  UNION ALL
  SELECT 9, 'import rows dated 30/08 whose lead now carries a DIFFERENT effective_sort_date (adopted into an older lead)',
         count(*)::text
  FROM day_rows r JOIN public.leads l ON l.id = r.lead_id, day
  WHERE l.effective_sort_date IS NULL OR l.effective_sort_date < d0 OR l.effective_sort_date >= d1

  UNION ALL
  SELECT 10, 'import rows dated 30/08: failed — errors',
         coalesce(string_agg(err || ': ' || n, ' · ' ORDER BY n DESC), '—')
  FROM (SELECT left(coalesce(error, ''), 50) err, count(*) n FROM day_rows WHERE status = 'failed' GROUP BY 1) s

  UNION ALL
  SELECT 11, 'import rows dated 30/08: files', 
         coalesce(string_agg(file_name || ': ' || n, ' · '), '—')
  FROM (SELECT file_name, count(*) n FROM day_rows GROUP BY 1) s

  UNION ALL
  SELECT 12, 'leads on 30/08 (Israel) by status',
         coalesce(string_agg(st || ': ' || n, ' · ' ORDER BY n DESC), '—')
  FROM (SELECT coalesce(status, '—') st, count(*) n
        FROM public.leads, day WHERE effective_sort_date >= d0 AND effective_sort_date < d1
        GROUP BY 1) s
)
SELECT ord, label, value FROM checks ORDER BY ord;
