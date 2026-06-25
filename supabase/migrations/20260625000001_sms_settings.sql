-- SMS provider settings (019 / 019sms.co.il) — a single-row config table that
-- lets an admin paste their 019 API token + username + sender from the
-- Settings screen instead of us setting Supabase project secrets by hand.
--
-- SECURITY: the API token is a secret. Unlike quote_defaults (which every
-- authenticated user reads), NO client may read or write this table. RLS is
-- enabled with ZERO policies, so every anon/authenticated request is denied.
-- All access goes through the `smsSettings` and `sendSms` Edge Functions, which
-- use the service-role key (bypasses RLS). The raw token therefore never leaves
-- the server — the Settings UI only ever sees a masked hint (••••1234).
--
-- Design mirrors quote_defaults: one row, primary key clamped to 1, so the
-- Edge Functions do a plain upsert/select on id = 1.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sms_settings (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider      text        NOT NULL DEFAULT '019',
  token         text        NOT NULL DEFAULT '',
  username      text        NOT NULL DEFAULT '',
  sender        text        NOT NULL DEFAULT 'KingDavid',
  updated_date  timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

-- Create the singleton row so the Edge Functions can always UPDATE id = 1.
INSERT INTO public.sms_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Lock the table down: enable RLS and define NO policies. The service role used
-- by the Edge Functions bypasses RLS; everyone else is denied outright.
ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
