-- ============================================================================
-- How many incoming enquiries is the CRM currently swallowing?
-- ============================================================================
-- upsertLead merges a new submission into an existing lead when it finds the
-- same phone string, appending a "עודכן מ-API" note instead of creating a row.
-- The ad networks count that submission as a conversion; the CRM does not.
--
-- upsertLead now matches a submission on unique_id, or failing that on
-- (phone_normalized + the original created_date the caller sent). A repeat
-- enquiry carries a new timestamp and becomes its own row; a scheduled re-sync
-- carries the original one and updates in place.
--
-- Row 1 therefore no longer gates a decision — it reports how many leads carry
-- unique_id, the strongest of the two keys. Callers that send NEITHER a
-- unique_id nor a created_date have no key at all and will produce a row per
-- send; rows 3 and 4 are where that would show up as growth.
--
-- Read-only.
-- ============================================================================

WITH checks AS (

  -- THE DECIDING ROW. High share => unique_id is a reliable re-sync key and the
  -- phone fallback can go. Low share => removing it would duplicate on re-sync.
  SELECT 1 AS ord, 'leads carrying a unique_id' AS label,
         count(*) FILTER (WHERE nullif(btrim(unique_id), '') IS NOT NULL)::text
           || ' / ' || count(*)::text AS value
  FROM public.leads

  UNION ALL
  SELECT 2, 'leads that arrived via the API at all',
         count(*) FILTER (WHERE last_api_update IS NOT NULL)::text
           || ' / ' || count(*)::text
  FROM public.leads

  -- Every "עודכן מ-API" note is one submission that did NOT become its own
  -- lead. This is the size of the under-count, measured rather than guessed.
  UNION ALL
  SELECT 3, 'submissions merged away (extra "עודכן מ-API" notes)',
         coalesce(sum(
           (length(notes) - length(replace(notes, 'עודכן מ-API', '')))
           / nullif(length('עודכן מ-API'), 0)
         ), 0)::text
  FROM public.leads
  WHERE notes LIKE '%עודכן מ-API%'

  UNION ALL
  SELECT 4, 'leads showing at least one merge',
         count(*)::text
  FROM public.leads
  WHERE notes LIKE '%עודכן מ-API%'

  -- Same person, several lead rows: enquiries that DID get counted separately,
  -- because the phone was written differently or they came via the site form.
  UNION ALL
  SELECT 5, 'phones with more than one lead row / extra rows',
         coalesce(count(*)::text, '0') || ' / '
           || coalesce(sum(n - 1)::text, '0')
  FROM (SELECT phone_normalized, count(*) AS n
        FROM public.leads
        WHERE phone_normalized IS NOT NULL
        GROUP BY phone_normalized HAVING count(*) > 1) d

  -- Same picture for the last 30 days only, which is the window that actually
  -- gets compared against ad-network reporting.
  UNION ALL
  SELECT 6, 'merges in the last 30 days',
         count(*)::text
  FROM public.leads
  WHERE notes LIKE '%עודכן מ-API%'
    AND coalesce(last_api_update, updated_date, created_date) > now() - interval '30 days'
)
SELECT ord AS "#", label AS "בדיקה", value AS "תוצאה"
FROM checks ORDER BY ord;
