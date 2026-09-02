-- ============================================================================
-- Lead gap check — why one day counts fewer leads here than in Kaveret.
-- ============================================================================
-- Read-only. Kaveret's funnel for 30/08/2026 says 190 leads; the lead screen
-- here says 171, all of them live (webhook / site), none from the import. So
-- the gap is in live intake. One table that separates the candidates: the
-- source mix, the hour profile (a timezone edge shows up at the day's ends),
-- phones that appear twice (Kaveret counts a repeat as a new card, this CRM
-- may fold it into the existing lead), and Facebook leads whose Facebook
-- timestamp is 30/08 but which reached this CRM on another day.
-- ============================================================================

WITH day AS (
  SELECT ('2026-08-30 00:00'::timestamp AT TIME ZONE 'Asia/Jerusalem') AS d0,
         ('2026-08-31 00:00'::timestamp AT TIME ZONE 'Asia/Jerusalem') AS d1
),
day_leads AS (
  SELECT l.* FROM public.leads l, day
  WHERE l.effective_sort_date >= day.d0 AND l.effective_sort_date < day.d1
),
checks AS (
  SELECT 1 AS ord, 'leads on 30/08 (Israel day)' AS label, count(*)::text AS value FROM day_leads

  UNION ALL
  SELECT 2, 'by source', coalesce(string_agg(s || ': ' || n, ' · ' ORDER BY n DESC), '—')
  FROM (SELECT coalesce(nullif(source, ''), '—') s, count(*) n FROM day_leads GROUP BY 1) x

  UNION ALL
  SELECT 4, 'by hour (Israel)', coalesce(string_agg(h || ':' || n, ' ' ORDER BY h), '—')
  FROM (SELECT to_char(created_date AT TIME ZONE 'Asia/Jerusalem', 'HH24') h, count(*) n FROM day_leads GROUP BY 1) x

  UNION ALL
  SELECT 5, 'leads 29/08 21:00–24:00 and 31/08 00:00–03:00 (Israel) — the day edges',
         (SELECT count(*) FROM public.leads, day WHERE created_date >= d0 - interval '3 hours' AND created_date < d0)::text
         || ' before · '
         || (SELECT count(*) FROM public.leads, day WHERE created_date >= d1 AND created_date < d1 + interval '3 hours')::text
         || ' after'

  UNION ALL
  SELECT 6, 'phones appearing on more than one lead on 30/08', count(*)::text
  FROM (SELECT phone_normalized FROM day_leads WHERE phone_normalized IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x

  UNION ALL
  SELECT 7, 'leads on 30/08 whose phone already had an OLDER lead here (repeat enquiry)', count(*)::text
  FROM day_leads d
  WHERE EXISTS (SELECT 1 FROM public.leads o, day
                WHERE o.phone_normalized = d.phone_normalized AND o.id <> d.id AND o.created_date < day.d0)

  UNION ALL
  SELECT 10, 'leads on 30/08 with no phone / invalid phone', 
         (SELECT count(*) FROM day_leads WHERE phone_normalized IS NULL)::text || ' no phone · '
         || (SELECT count(*) FROM day_leads WHERE phone_normalized IS NOT NULL AND length(phone_normalized) NOT BETWEEN 11 AND 12)::text || ' odd length'

  UNION ALL
  SELECT 11, 'by unique_id prefix (which intake wrote them)', coalesce(string_agg(p || ': ' || n, ' · ' ORDER BY n DESC), '—')
  FROM (SELECT coalesce(left(unique_id, 6), '—') p, count(*) n FROM day_leads GROUP BY 1) x

  UNION ALL
  SELECT 12, 'lead columns that exist for source / facebook timing (so the next check can use them)',
         coalesce(string_agg(column_name, ', ' ORDER BY column_name), '—')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'leads'
    AND (column_name LIKE 'facebook_%' OR column_name LIKE 'source%' OR column_name IN ('landing_page','utm_source','last_api_update'))

  UNION ALL
  SELECT 13, 'leads on 30/08 (Israel) by last_api_update day (when the webhook last touched them)',
         coalesce(string_agg(dd || ': ' || n, ' · ' ORDER BY dd), '—')
  FROM (SELECT coalesce(to_char(last_api_update AT TIME ZONE 'Asia/Jerusalem', 'DD/MM'), '—') dd, count(*) n
        FROM day_leads GROUP BY 1) x
)
SELECT ord, label, value FROM checks ORDER BY ord;
