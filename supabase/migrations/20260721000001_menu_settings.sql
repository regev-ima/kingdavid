-- Server-side sidebar-menu preferences (hidden items + order).
--
-- WHY: until now these lived only in localStorage, which is scoped to a single
-- browser AND a single domain — so opening the app through a new Vercel
-- deployment URL (every release has its own) started from a clean slate and
-- the admin's menu curation "reset itself" after each version. Persisting the
-- singleton server-side makes the configuration survive releases and apply on
-- every browser/device.
--
-- Shape mirrors company_closures (id clamped to 1): every authenticated user
-- reads (the sidebar needs it), only admins update. Admin match uses the
-- proven dual condition (auth_id OR email) like the whatsapp tables.

BEGIN;

CREATE TABLE IF NOT EXISTS public.menu_settings (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hidden_items  jsonb       NOT NULL DEFAULT '["ClubSignups","LandingPages"]'::jsonb,
  menu_order    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_date  timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

-- Seed the singleton with the historical client-side defaults, so day-one
-- behavior is identical to what the app shipped with.
INSERT INTO public.menu_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_menu_settings_touch_updated_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS menu_settings_touch_updated_date ON public.menu_settings;
CREATE TRIGGER menu_settings_touch_updated_date
BEFORE UPDATE ON public.menu_settings
FOR EACH ROW
EXECUTE FUNCTION public.trg_menu_settings_touch_updated_date();

ALTER TABLE public.menu_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.menu_settings TO authenticated;

DROP POLICY IF EXISTS "auth_select_menu_settings" ON public.menu_settings;
CREATE POLICY "auth_select_menu_settings"
  ON public.menu_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_update_menu_settings" ON public.menu_settings;
CREATE POLICY "admin_update_menu_settings"
  ON public.menu_settings FOR UPDATE
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
