-- ============================================================================
-- Import readiness — the one check standing between here and the full import.
-- ============================================================================
-- Read-only. Answers two questions:
--
--   A. Did the pilot import ADOPT legacy leads, or duplicate them? (rows 1-4)
--      This is the deciding one. process_lead_import was rebuilt so that an
--      imported Kaveret row matching an existing lead by normalized phone
--      stamps its external_id onto that lead instead of creating a second row.
--      If adopted_leads is 0 on a batch that overlapped existing data, the
--      adoption path did not fire and the full import would double the file.
--
--   B. Is the contact layer actually populated? (rows 5-8)
--      Every lead should now hang off a contact, so an imported lead lands on
--      the same person as the legacy one rather than inventing a new customer.
--
-- Run it, read row 3. Anything other than "0 adopted" on a batch whose rows
-- overlapped existing leads means go.
-- ============================================================================

WITH last_batch AS (
  SELECT *
  FROM public.lead_import_batches
  ORDER BY created_date DESC
  LIMIT 1
),
checks AS (

  SELECT 1 AS ord, 'ייבוא אחרון — מתי' AS label,
         coalesce(to_char(created_date AT TIME ZONE 'Asia/Jerusalem',
                          'DD/MM/YYYY HH24:MI'), 'לא בוצע ייבוא') AS value
  FROM last_batch
  UNION ALL SELECT 1, 'ייבוא אחרון — מתי', 'לא בוצע ייבוא כלל'
  WHERE NOT EXISTS (SELECT 1 FROM last_batch)

  UNION ALL
  SELECT 2, 'שורות בקובץ / נכשלו',
         total_rows::text || ' / ' || failed_rows::text
  FROM last_batch

  -- THE DECIDING ROW.
  UNION ALL
  SELECT 3, 'אומצו לידים קיימים (adopted)',
         adopted_leads::text
           || CASE WHEN adopted_leads = 0
                   THEN '  ← אם הקובץ חפף לידים קיימים, האימוץ לא פעל'
                   ELSE '  ← האימוץ פעל' END
  FROM last_batch

  UNION ALL
  SELECT 4, 'נוצרו חדשים / עודכנו קיימים',
         created_leads::text || ' / ' || updated_leads::text
  FROM last_batch

  -- ---- B: the contact layer ------------------------------------------------

  UNION ALL
  SELECT 5, 'לידים המקושרים לאיש קשר',
         count(*) FILTER (WHERE contact_id IS NOT NULL)::text
           || ' / ' || count(*)::text
  FROM public.leads

  -- What is left here is leads with no usable phone — nothing to attach them
  -- by. A non-zero number is expected and harmless; a large one is not.
  UNION ALL
  SELECT 6, 'לידים שעדיין ממתינים לקישור',
         count(*)::text
  FROM public.leads
  WHERE contact_id IS NULL AND phone IS NOT NULL AND btrim(phone) <> ''

  UNION ALL
  SELECT 7, 'אנשי קשר במערכת',
         count(*)::text
  FROM public.customers

  -- More than one lead per contact is the repeat-enquiry case working as
  -- designed: two submissions, two rows, one person.
  UNION ALL
  SELECT 8, 'אנשי קשר עם יותר מפנייה אחת',
         count(*)::text || ' אנשי קשר, ' || coalesce(sum(n)::text, '0') || ' פניות'
  FROM (SELECT contact_id, count(*) AS n
        FROM public.leads
        WHERE contact_id IS NOT NULL
        GROUP BY contact_id HAVING count(*) > 1) d

  -- Kaveret rows already carrying their source id. Before the first import
  -- this is 0; after it, it is how many leads the import can recognise on a
  -- re-run instead of re-importing.
  UNION ALL
  SELECT 9, 'לידים הנושאים external_id (מזהה כוורת)',
         count(*) FILTER (WHERE external_id IS NOT NULL)::text
           || ' / ' || count(*)::text
  FROM public.leads
)
SELECT ord AS "#", label AS "בדיקה", value AS "תוצאה"
FROM checks ORDER BY ord;
