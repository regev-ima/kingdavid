-- Let הגדרות ← טקסטים ותנאים actually reach the documents.
--
-- Until now every quote and every order was saved with a full copy of the
-- three legal texts, taken from the defaults at the moment it was created. A
-- stored copy always wins over the settings when a document resolves its
-- wording, so editing the texts in Settings changed nothing anyone could see —
-- not on existing orders, and not on a new order converted from a quote written
-- before the edit. Reported as "שיניתי את התנאים בהגדרות אבל בהזמנה עדיין
-- מופיע הישן".
--
-- The client now stores wording only where someone actually rewrote it
-- (customDocumentTerms in src/constants/documentTerms.js); standard wording is
-- left NULL and resolves live through app_settings. This migration does the
-- same to the rows already in the table.
--
-- Idempotent: clearing a column that is already NULL is a no-op, and the second
-- run finds nothing left to match. Rehearsed with
-- `scripts/local-test-db.sh <file> --twice`.

BEGIN;

-- Needs the columns and the settings table from
-- 20260806000002_app_settings_and_order_terms.sql. That one is idempotent, so
-- the workflow applies it first; say so plainly if someone runs this file alone.
DO $$
BEGIN
  IF to_regclass('public.app_settings') IS NULL THEN
    RAISE EXCEPTION 'apply 20260806000002_app_settings_and_order_terms.sql first';
  END IF;
END $$;

-- ── orders ───────────────────────────────────────────────────────────────────
-- Unconditional: there is no UI that edits an order's wording — every value in
-- these three columns was machine-stamped at creation. Wording that a rep did
-- customise lives on the quote the order came from, and the order screen and
-- the order PDF both fall back to that quote, so nothing is lost.
UPDATE public.orders
SET terms = NULL, warranty_terms = NULL, legal_notes = NULL
WHERE terms IS NOT NULL
   OR warranty_terms IS NOT NULL
   OR legal_notes IS NOT NULL;

-- ── quotes ───────────────────────────────────────────────────────────────────
-- A quote's texts ARE editable (step 3 of the quote wizard), so only the ones
-- still holding the standard wording are cleared. Comparison ignores
-- whitespace: a reflowed paragraph is not a change to what the customer reads.
--
-- Two sources count as "standard": the text shipped in
-- src/constants/documentTerms.js (what quotes were stamped with before an admin
-- ever opened the settings screen), and whatever that screen holds right now.
CREATE OR REPLACE FUNCTION pg_temp.norm(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g') $$;

CREATE TEMP TABLE standard_terms ON COMMIT DROP AS
SELECT
  pg_temp.norm($txt$30 ימי עסקים בהזמנת מיטה / 14 ימי עסקים בהזמנת מזרן.
תאום המשלוח יבוצע יום אחד קודם, ביום המשלוח תינתן התראה לפני הגעת המוביל.$txt$) AS terms,
  pg_temp.norm($txt$אחריות יצרן ל-10 שנים על המזרן.$txt$) AS warranty_terms,
  pg_temp.norm($txt$ניתן להחליף/לבטל הזמנה של מזרן תוך 30 יום מקבלתו בהחזר כספי מלא, למעט דמי הובלה.
* מזרנים שהוגדרו במידה מיוחדת על פי תקנון החברה אינם ניתנים לביטול/החלפה על אף אריזתם המקורית.
* החזרת מזרן יתבצע בתיאום מראש בלבד, בטלפון או במייל מול מחלקת שירות לקוחות.
* בסיסים ומיטות מכל סוג הינם הזמנה אישית, בעיצוב וייצור אישי ללקוח, עפ'י דרישותיו ולכן אינם ניתנים לביטול או החלפה בשום אופן.
* שינוי או ביטול הזמנה של בסיסים או מיטות יינתן עד 48 שעות מרגע ההזמנה בלבד. לאחר מכן לא יהיה ניתן לבטל.
*במידה וההובלה כרוכה במנוף/חבלים או פירוק/פינוי, העלות הנוספת תחול על חשבון הלקוח מול חברת השילוח וההובלה.
* מחיר ההובלה וההרכבה במדרגות, עד קומה 3, כל קומה נוספת בעלות ₪50 עבור כל פריט שאינו נכנס למעלית.
* הלקוח מצהיר כי יש לו גישה להכנסת הסחורה לביתו, ומאשר כי האחריות להכנסת כל מוצר שהוא לביתו חלה עליו בלבד.
*מסירת הסחורה ללקוח תבוצע אך ורק לאחר גמר חשבון ותשלום מלא בפועל.
* בהזמנת מזרן: תאום משלוח יבוצע יום אחד קודם. ביום המשלוח תינתן התראה לפני הגעת המוביל. ללקוח האפשרות לדחות את מועד האספקה.
* איסוף עצמי בתיאום מראש ישירות במפעל ברח׳ העמל 6 קרית מלאכי בימים א-ה בין השעות 9:00 - 16:00.

הלקוח מאשר בחתימתו אישור סופי ומוחלט לכל הכתוב לעיל,
ומצהיר בזאת כי הוא עבר על כל פרטי ההזמנה ומסכים לתנאי החברה ומדיניותה.$txt$) AS legal_notes
UNION
SELECT
  pg_temp.norm(value ->> 'terms'),
  pg_temp.norm(value ->> 'warranty_terms'),
  pg_temp.norm(value ->> 'legal_notes')
FROM public.app_settings
WHERE key = 'document_terms';

-- `notes` is where a quote keeps its general terms block. On a quote written
-- before the terms feature it may hold genuine free text — which by definition
-- matches neither standard wording, so it is left alone.
--
-- Each column is cleared only if it's actually there. These three are part of
-- the original base44 schema rather than of any migration in this repo, and
-- there is no staging database to find out on: a column that turned out to be
-- named differently would abort the transaction and take the orders half —
-- the half that fixes the reported bug — down with it.
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT *
    FROM (VALUES ('terms', 'terms'),
                 ('warranty_terms', 'warranty_terms'),
                 ('notes', 'legal_notes')) AS t(quote_col, standard_col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'quotes' AND column_name = col.quote_col
    ) THEN
      EXECUTE format(
        'UPDATE public.quotes q SET %I = NULL
           WHERE q.%I IS NOT NULL
             AND EXISTS (SELECT 1 FROM standard_terms s WHERE s.%I = pg_temp.norm(q.%I))',
        col.quote_col, col.quote_col, col.standard_col, col.quote_col);
    ELSE
      RAISE NOTICE 'quotes.% not present — skipped', col.quote_col;
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.orders.legal_notes IS
  'General terms block, set only when the source quote carried wording of its own. NULL = the order follows app_settings.document_terms (quotes keep the same text in `notes`).';

COMMIT;
