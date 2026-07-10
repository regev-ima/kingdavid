-- Single-row config table holding which AI model powers the "נסח עם AI"
-- style features across the app (currently: WhatsApp template drafting in
-- WhatsAppTemplatesTab.jsx). The model id is an OpenRouter model id
-- (e.g. "openai/gpt-4o-mini", "anthropic/claude-3.5-haiku") — OpenRouter lets
-- us route to whichever provider without juggling a separate API key per
-- vendor. The invokeLLM Edge Function reads this row (service role) when the
-- caller doesn't pass an explicit `model` override.
--
-- Design: one row, primary key clamped to 1, same pattern as quote_defaults —
-- the React side does a plain `.list()` / `.update(1)` round-trip.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_settings (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider      text    NOT NULL DEFAULT 'openrouter',
  model         text    NOT NULL DEFAULT 'openai/gpt-4o-mini',
  updated_date  timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

INSERT INTO public.ai_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_ai_settings_touch_updated_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_settings_touch_updated_date ON public.ai_settings;
CREATE TRIGGER ai_settings_touch_updated_date
BEFORE UPDATE ON public.ai_settings
FOR EACH ROW
EXECUTE FUNCTION public.trg_ai_settings_touch_updated_date();

-- RLS: everyone authenticated reads (any screen using an AI-compose feature
-- may want to know the active model); only admins write.
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_ai_settings" ON public.ai_settings;
CREATE POLICY "auth_select_ai_settings"
  ON public.ai_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_update_ai_settings" ON public.ai_settings;
CREATE POLICY "admin_update_ai_settings"
  ON public.ai_settings FOR UPDATE
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

NOTIFY pgrst, 'reload schema';

COMMIT;
