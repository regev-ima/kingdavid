-- WhatsApp — Phase 2: sending, templates + shortcuts, PDF attachments.
--
-- Phase 1 (20260625000002_whatsapp_chat.sql) mirrored WhatsApp read-only and
-- explicitly said "the platform never sends". That rule is REVERSED by
-- explicit client instruction — see whatsapp-phase2-messaging-plan.md §0.
-- The platform can now send text + file messages through greenApiSend
-- (service role, using the rep's own Green API instance). This migration only
-- adds the DB support for that: a shared message-template library (with
-- keyboard-shortcut expansion in the composer) and additive bookkeeping
-- columns on whatsapp_messages so outgoing app-sent messages are distinguishable
-- from what the webhook mirrors from the phone.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE, seed rows guarded by NOT EXISTS.

BEGIN;

-- ── whatsapp_templates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text NOT NULL DEFAULT 'general'
                CHECK (category IN ('sales','availability','service','general')),
  title         text NOT NULL,
  body          text NOT NULL,          -- supports {{placeholders}}, resolved client-side
  shortcut      text,                   -- text-replacement key (no '/', no spaces)
                CHECK (shortcut IS NULL OR shortcut !~ '[\s/]'),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_shortcut_key
  ON public.whatsapp_templates (shortcut) WHERE shortcut IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_templates_category_idx
  ON public.whatsapp_templates (category, sort_order);

-- Reuse the touch trigger created in phase 1.
DROP TRIGGER IF EXISTS whatsapp_templates_touch_updated_date ON public.whatsapp_templates;
CREATE TRIGGER whatsapp_templates_touch_updated_date
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.trg_whatsapp_touch_updated_date();

-- RLS: every authenticated user reads (reps need templates in the composer);
-- only admins write. Same dual-match admin check used across the DB.
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;

DROP POLICY IF EXISTS "whatsapp_templates_select" ON public.whatsapp_templates;
CREATE POLICY "whatsapp_templates_select"
  ON public.whatsapp_templates FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "whatsapp_templates_write_admin" ON public.whatsapp_templates;
CREATE POLICY "whatsapp_templates_write_admin"
  ON public.whatsapp_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
        AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
        AND u.role = 'admin'
    )
  );

-- Seed a handful of starter templates (one+ per category) so the admin screen
-- and the composer's "/" menu aren't empty on first load. Guarded on shortcut
-- so re-running the migration never duplicates them.
INSERT INTO public.whatsapp_templates (category, title, body, shortcut, sort_order)
SELECT v.category, v.title, v.body, v.shortcut, v.sort_order
FROM (VALUES
  ('general',      'פתיחה עם שם',        'היי {{שם}}, מדבר/ת {{נציג}} מקינג דוד 🙏 איך אפשר לעזור?', 'שלום', 1),
  ('sales',        'הצעת מחיר מצורפת',   'היי {{שם}}, מצורפת הצעת המחיר שלך מקינג דוד. אשמח לענות על כל שאלה 🙏', 'מחיר1', 1),
  ('availability', 'בדיקת זמינות',        'היי {{שם}}, בודק/ת זמינות במלאי ואחזור אליך תוך זמן קצר 🙏', 'זמין', 1),
  ('service',      'פנייה לשירות התקבלה', 'היי {{שם}}, פנייתך התקבלה ומטופלת אצלנו. ניצור קשר בהקדם. תודה על הסבלנות 🙏', 'שירות1', 1)
) AS v(category, title, body, shortcut, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_templates t WHERE t.shortcut = v.shortcut
);

-- ── whatsapp_messages: outgoing-from-app bookkeeping (additive) ───────────
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_via_app boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_by      text,
  ADD COLUMN IF NOT EXISTS template_id  uuid;

NOTIFY pgrst, 'reload schema';

COMMIT;
