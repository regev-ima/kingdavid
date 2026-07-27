-- ============================================================================
-- Status check — paste this whole file into the Supabase SQL Editor and Run.
-- ============================================================================
-- Read-only. Touches nothing. Returns one table that answers, in order:
--   1-3  did the 20260726 migration actually take effect on production data
--   4-5  how much backfill work is outstanding
--   6-7  how many duplicate contacts really exist (the UNIQUE index is created
--        only when the data is already clean, so #6 tells you which happened)
--   8    whether DELETE FROM leads will succeed or be blocked by foreign keys
-- ============================================================================

WITH checks AS (

  SELECT 1 AS ord, 'leads: phone_normalized populated' AS label,
         count(*) FILTER (WHERE phone_normalized IS NOT NULL)::text
           || ' / ' || count(*)::text AS value
  FROM public.leads

  -- phone_valid is generated on customers only; leads gets phone_normalized
  -- alone, so this measures contact-side phone quality.
  UNION ALL
  SELECT 2, 'customers: phone_valid = true',
         count(*) FILTER (WHERE phone_valid)::text || ' / ' || count(*)::text
  FROM public.customers

  UNION ALL
  SELECT 3, 'customers: phone_normalized populated',
         count(*) FILTER (WHERE phone_normalized IS NOT NULL)::text
           || ' / ' || count(*)::text
  FROM public.customers

  UNION ALL
  SELECT 4, 'leads awaiting backfill (contact_id IS NULL)',
         count(*)::text
  FROM public.leads
  WHERE contact_id IS NULL AND phone IS NOT NULL AND btrim(phone) <> ''

  UNION ALL
  SELECT 5, 'leads already linked to a contact',
         count(*)::text
  FROM public.leads WHERE contact_id IS NOT NULL

  -- If this says MISSING, the migration found duplicate phones and skipped the
  -- unique index on purpose rather than failing. #7 is then the cleanup size.
  UNION ALL
  SELECT 6, 'customers UNIQUE index on phone_normalized',
         CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                           WHERE schemaname = 'public'
                             AND indexname = 'customers_phone_normalized_uniq')
              THEN 'created (data was clean)'
              ELSE 'MISSING — duplicates present, see next row' END

  UNION ALL
  SELECT 7, 'duplicate contact groups / extra rows to merge',
         coalesce(count(*)::text, '0') || ' groups / '
           || coalesce(sum(n - 1)::text, '0') || ' extra rows'
  FROM (SELECT phone_normalized, count(*) AS n
        FROM public.customers
        WHERE phone_normalized IS NOT NULL
        GROUP BY phone_normalized HAVING count(*) > 1) d

  -- Every FK pointing at leads without ON DELETE CASCADE/SET NULL will block a
  -- bulk delete. This is the row that decides whether the wipe is one statement
  -- or a migration.
  UNION ALL
  SELECT 8, 'FKs blocking DELETE FROM leads',
         CASE WHEN count(*) = 0 THEN 'none — delete will succeed'
              ELSE count(*)::text || ' blocking: ' || string_agg(rel, ', ') END
  FROM (
    SELECT c.conrelid::regclass::text AS rel
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.leads'::regclass
      AND c.confdeltype NOT IN ('c', 'n')   -- c = cascade, n = set null
  ) blockers
)
SELECT ord AS "#", label AS "בדיקה", value AS "תוצאה"
FROM checks ORDER BY ord;
