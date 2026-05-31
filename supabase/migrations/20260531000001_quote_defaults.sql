-- Single-row config table holding the defaults that prefill a fresh quote's
-- "תנאי תשלום ואספקה" (terms) and "הערות" (notes) textareas, plus the
-- default payment methods chip selection. The form used to ship hard-coded
-- defaults inside NewQuote.jsx; admins kept asking us to tweak them and we
-- kept pushing code, so we're moving the source of truth into the DB and
-- exposing it from the Settings page.
--
-- Design: one row, primary key clamped to 1, so the React side can do a
-- plain `.list()` / `.update(1)` round-trip without a join or a name key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_defaults (
  id                       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  terms                    text    NOT NULL DEFAULT '',
  notes                    text    NOT NULL DEFAULT '',
  payment_terms_selection  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  updated_date             timestamptz NOT NULL DEFAULT now(),
  updated_by               text
);

-- Seed the singleton with what NewQuote.jsx used to ship as the literal
-- defaults, so day-one behavior is identical for reps.
INSERT INTO public.quote_defaults (id, terms, notes, payment_terms_selection)
VALUES (
  1,
  'תשלום מלא עם ההזמנה. אספקה תוך 14-21 ימי עסקים.',
  'ניתן להחליף/לבטל הזמנה של מזרן תוך 30 יום מקבלתו בהחזר כספי מלא, למעט דמי הובלה.
* מזרנים שהוגדרו במידה מיוחדת על פי תקנון החברה אינם ניתנים לביטול/החלפה על אף אריזתם המקורית.
* החזרת מזרן יתבצע בתיאום מראש בלבד, בטלפון או במייל מול מחלקת שירות לקוחות.
* בסיסים ומיטות מכל סוג הינם הזמנה אישית, בעיצוב וייצור אישי ללקוח, עפ''י דרישותיו ולכן אינם ניתנים לביטול או החלפה בשום אופן.
* שינוי או ביטול הזמנה של בסיסים או מיטות יינתן עד 48 שעות מרגע ההזמנה בלבד. לאחר מכן לא יהיה ניתן לבטל.
*במידה וההובלה כרוכה במנוף/חבלים או פירוק/פינוי, העלות הנוספת תחול על חשבון הלקוח מול חברת השילוח וההובלה.
* מחיר ההובלה וההרכבה במדרגות, עד קומה 3, כל קומה נוספת בעלות ₪50 עבור כל פריט שאינו נכנס למעלית.
* הלקוח מצהיר כי יש לו גישה להכנסת הסחורה לביתו, ומאשר כי האחריות להכנסת כל מוצר שהוא לביתו חלה עליו בלבד.
*מסירת הסחורה ללקוח תבוצע אך ורק לאחר גמר חשבון ותשלום מלא בפועל.
* בהזמנת מזרן: תאום משלוח יבוצע יום אחד קודם. ביום המשלוח תינתן התראה לפני הגעת המוביל. ללקוח האפשרות לדחות את מועד האספקה.
* איסוף עצמי בתיאום מראש ישירות במפעל ברח׳ העמל 6 קרית מלאכי בימים א-ה בין השעות 9:00 - 16:00.

הלקוח מאשר בחתימתו אישור סופי ומוחלט לכל הכתוב לעיל,
ומצהיר בזאת כי הוא עבר על כל פרטי ההזמנה ומסכים לתנאי החברה ומדיניותה.',
  '[]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Bump `updated_date` on every UPDATE so the Settings UI can show
-- "last edited" without us having to remember to set it from the client.
CREATE OR REPLACE FUNCTION public.trg_quote_defaults_touch_updated_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_defaults_touch_updated_date ON public.quote_defaults;
CREATE TRIGGER quote_defaults_touch_updated_date
BEFORE UPDATE ON public.quote_defaults
FOR EACH ROW
EXECUTE FUNCTION public.trg_quote_defaults_touch_updated_date();

-- RLS:
--   * Every authenticated user reads (every NewQuote render needs the row).
--   * Only admins can update — defaults are company-wide policy.
--   * Nobody inserts/deletes — the singleton is created by this migration.
ALTER TABLE public.quote_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_quote_defaults" ON public.quote_defaults;
CREATE POLICY "auth_select_quote_defaults"
  ON public.quote_defaults FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_update_quote_defaults" ON public.quote_defaults;
CREATE POLICY "admin_update_quote_defaults"
  ON public.quote_defaults FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = (auth.jwt() ->> 'email')
        AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = (auth.jwt() ->> 'email')
        AND u.role = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
