-- Two things the legal texts on a quote / an order need:
--
--   1. `app_settings` — a generic key/value(JSON) config table. Its first key
--      is 'document_terms', holding the three texts an admin edits in
--      הגדרות ← טקסטים ותנאים (תנאי תשלום ואספקה / אחריות / תנאים כלליים).
--      The row is NOT seeded here on purpose: with no row the client resolves
--      to the same text from src/constants/documentTerms.js, so "restore to
--      default" and day-one behaviour both come from one place — the code.
--
--   2. `orders.terms` / `warranty_terms` / `legal_notes` — the copy of the
--      wording stamped onto an order when it is created (from the quote it was
--      converted from, else from the current defaults). Editing the texts in
--      Settings afterwards must not rewrite orders that were already sold.
--
-- This migration is applied by hand in Supabase, so the client is written to
-- work before it runs: reads of a missing table fall back to the defaults in
-- code, and writes of a not-yet-existing column are retried without it
-- (writeWithSchemaResilience in src/api/entities.js) rather than failing the
-- order insert.

BEGIN;

-- ── app_settings ─────────────────────────────────────────────────────────────
-- `id` IS the setting key (text), not a surrogate uuid: the generic entity
-- layer addresses rows with .eq('id', …), so keying on `id` lets the client do
-- AppSettings.update('document_terms', …) without a bespoke API.
CREATE TABLE IF NOT EXISTS public.app_settings (
  id           text        PRIMARY KEY,
  value        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_date timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

COMMENT ON TABLE public.app_settings IS
  'Key/value app configuration. id = the setting key, value = JSON payload.';

-- Bump updated_date on every write so the Settings UI can show "last edited"
-- without the client having to remember to send it.
CREATE OR REPLACE FUNCTION public.trg_app_settings_touch_updated_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_settings_touch_updated_date ON public.app_settings;
CREATE TRIGGER app_settings_touch_updated_date
BEFORE INSERT OR UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.trg_app_settings_touch_updated_date();

-- RLS:
--   * every signed-in user reads (each quote/order screen resolves the texts);
--   * only admins write — these are company-wide legal texts;
--   * nobody deletes.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_app_settings" ON public.app_settings;
CREATE POLICY "auth_select_app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_app_settings" ON public.app_settings;
CREATE POLICY "admin_insert_app_settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
        AND u.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "admin_update_app_settings" ON public.app_settings;
CREATE POLICY "admin_update_app_settings"
  ON public.app_settings FOR UPDATE
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

-- ── the order's own copy of the wording ──────────────────────────────────────
-- Nullable with no default: NULL means "this order predates the copy", and the
-- screens resolve it through the quote / settings / code instead.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS terms          text,
  ADD COLUMN IF NOT EXISTS warranty_terms text,
  ADD COLUMN IF NOT EXISTS legal_notes    text;

COMMENT ON COLUMN public.orders.legal_notes IS
  'General terms block as it stood when the order was created (quotes keep the same text in `notes`).';

NOTIFY pgrst, 'reload schema';

COMMIT;
