-- WhatsApp disconnect alerts — tell the team, on WhatsApp, the moment a rep's
-- phone drops off Green API.
--
-- WHY: when a rep's WhatsApp unlinks, two things stop silently — we stop
-- mirroring their conversations, and they can no longer send from the CRM
-- composer. Today nobody finds out until a customer complains or someone opens
-- "נהל נציג ← וואטסאפ" and sees the yellow "לא מאומת" banner. Green API already
-- tells us the instant it happens (the stateInstanceChanged webhook, which
-- setWebhookSettings already enables) — this migration adds the bookkeeping
-- that turns that event into exactly ONE WhatsApp message to the team group,
-- sent through one nominated rep's own instance.
--
-- Note the distinction the alert is built around: we alert when the INSTANCE is
-- alive and answering but its state is no longer `authorized` — i.e. Green API
-- is fine, the rep's phone is what dropped. A Green API call that fails outright
-- (network, revoked token) is NOT this condition and never raises an alert.
--
-- Three pieces:
--   whatsapp_alert_settings  — singleton config: on/off, which rep's instance
--       sends (the "notifier"), which group receives, the flap cooldown, and a
--       monitor_token that the scheduled sweep authenticates with.
--   whatsapp_accounts.*      — per-account outage bookkeeping, so an outage
--       produces one alert instead of one per webhook/sweep tick.
--   whatsapp_alert_log       — what we sent, when, and whether Green took it.
--
-- SECURITY: whatsapp_alert_settings holds monitor_token (a secret) and belongs
-- to the same locked-down family as whatsapp_accounts — RLS on, ZERO policies,
-- every access through the greenApiSettings / greenApiStateMonitor Edge
-- Functions (service role). whatsapp_alert_log is admin-readable and never
-- client-writable.
--
-- Idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY
-- before CREATE, guarded seeds.

BEGIN;

-- ── whatsapp_alert_settings (singleton, id = 1) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_alert_settings (
  id                 integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled            boolean     NOT NULL DEFAULT true,

  -- Whose Green API instance sends the alert. This is a rep like any other —
  -- the alert goes out from THEIR WhatsApp number into the group, which is why
  -- the group has to contain that number. NULL = nobody nominated yet, alerts
  -- are computed but nothing is sent.
  notifier_user_id   uuid        REFERENCES public.users(id) ON DELETE SET NULL,

  -- Where the alert lands. Green API chatId form: <id>@g.us for a group.
  group_chat_id      text        NOT NULL DEFAULT '120363410077585252@g.us',

  -- Minimum gap between two alerts about the SAME rep. This is flap
  -- suppression, not a repeat timer: an outage produces one alert (see
  -- alerted_since below), and the cooldown stops a phone that drops and
  -- reconnects every few minutes from filling the group.
  cooldown_minutes   integer     NOT NULL DEFAULT 60 CHECK (cooldown_minutes >= 0),

  -- Also announce when a rep's WhatsApp comes back (only for outages we
  -- actually alerted about — a silent blip stays silent in both directions).
  notify_on_recovery boolean     NOT NULL DEFAULT true,

  -- Shared secret the scheduled sweep presents (x-monitor-token). Kept in the
  -- DB rather than a project secret so the GitHub Action can read it with the
  -- SUPABASE_ACCESS_TOKEN it already has, with no new repo secret to provision.
  monitor_token      text        NOT NULL DEFAULT
                       replace(gen_random_uuid()::text, '-', '')
                       || replace(gen_random_uuid()::text, '-', ''),

  updated_date       timestamptz NOT NULL DEFAULT now(),
  updated_by         text
);

INSERT INTO public.whatsapp_alert_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- A row that predates this column set still needs a token.
UPDATE public.whatsapp_alert_settings
SET monitor_token = replace(gen_random_uuid()::text, '-', '')
                    || replace(gen_random_uuid()::text, '-', '')
WHERE id = 1 AND coalesce(monitor_token, '') = '';

-- Locked down exactly like whatsapp_accounts / sms_settings: RLS on, no
-- policies at all. Only the service role (Edge Functions) gets through.
ALTER TABLE public.whatsapp_alert_settings ENABLE ROW LEVEL SECURITY;

-- Best-effort first-run default: if exactly one rep matches the name the alert
-- was specified for AND already has Green API credentials, nominate them. Any
-- ambiguity (no match, several matches, no credentials) leaves it NULL for an
-- admin to set in הגדרות ← התראות ניתוק וואטסאפ.
WITH candidate AS (
  SELECT u.id
  FROM public.users u
  JOIN public.whatsapp_accounts a ON a.user_id = u.id
  WHERE (u.full_name ILIKE '%מעיין%' OR u.full_name ILIKE '%מעין%')
    AND a.instance_id <> ''
    AND a.api_token <> ''
)
UPDATE public.whatsapp_alert_settings s
SET notifier_user_id = (SELECT id FROM candidate)
WHERE s.id = 1
  AND s.notifier_user_id IS NULL
  AND (SELECT count(*) FROM candidate) = 1;

-- ── whatsapp_accounts — per-account outage bookkeeping ─────────────────────
-- These columns are what make the alert fire once per outage instead of once
-- per webhook. `disconnected_since` identifies the outage; `alerted_since` is
-- claimed compare-and-swap style by whichever of the webhook / sweep gets there
-- first, so simultaneous observers can't both send; `alert_sent_at` drives the
-- flap cooldown; `alert_attempt_at` and `alert_error` record the last attempt
-- so a repeating failure is diagnosable without being logged over and over.
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS disconnected_since timestamptz,
  ADD COLUMN IF NOT EXISTS alerted_since      timestamptz,
  ADD COLUMN IF NOT EXISTS alert_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS alert_attempt_at   timestamptz,
  ADD COLUMN IF NOT EXISTS alert_state        text,
  ADD COLUMN IF NOT EXISTS alert_error        text,
  ADD COLUMN IF NOT EXISTS alerts_muted       boolean NOT NULL DEFAULT false,
  -- "Has this instance ever actually been linked?" — without it, a rep being
  -- set up for the first time (notAuthorized until they scan the QR) would be
  -- announced to the group as having "disconnected", which they never were.
  ADD COLUMN IF NOT EXISTS was_authorized     boolean NOT NULL DEFAULT false;

-- Backfill: anything currently authorized, or that has ever produced a webhook
-- / reported its number, has been linked at some point.
UPDATE public.whatsapp_accounts
SET was_authorized = true
WHERE was_authorized = false
  AND (state = 'authorized' OR phone IS NOT NULL OR last_webhook_at IS NOT NULL);

-- Reps already sitting disconnected when this ships: open the outage now so the
-- first sweep reports them, instead of back-dating an unknown start time.
UPDATE public.whatsapp_accounts
SET disconnected_since = now()
WHERE disconnected_since IS NULL
  AND was_authorized = true
  AND instance_id <> ''
  AND state IS NOT NULL
  AND state <> 'authorized';

CREATE INDEX IF NOT EXISTS whatsapp_accounts_disconnected_idx
  ON public.whatsapp_accounts (disconnected_since)
  WHERE disconnected_since IS NOT NULL;

-- ── whatsapp_alert_log ─────────────────────────────────────────────────────
-- Append-only record of every alert we tried to send. Answers "did the group
-- ever get told?" without reading Edge Function logs, and is what the settings
-- screen shows.
CREATE TABLE IF NOT EXISTS public.whatsapp_alert_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid        REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  user_id          uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  rep_name         text,                       -- snapshot: survives a deleted user
  kind             text        NOT NULL DEFAULT 'disconnected'
                     CHECK (kind IN ('disconnected', 'recovered', 'test')),
  state            text,                       -- the Green stateInstance that triggered it
  source           text,                       -- 'webhook' | 'sweep' | 'check' | 'ui'
  chat_id          text,                       -- the group we sent to
  message          text,                       -- exactly what went out
  green_message_id text,
  ok               boolean     NOT NULL DEFAULT false,
  error            text,
  created_date     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_alert_log_created_idx
  ON public.whatsapp_alert_log (created_date DESC);
CREATE INDEX IF NOT EXISTS whatsapp_alert_log_user_idx
  ON public.whatsapp_alert_log (user_id, created_date DESC);

-- Admins read it; nobody writes from a client (the Edge Functions use the
-- service role, which bypasses RLS). Same dual-match admin check used across
-- the schema, so a profile linked by auth_id OR by email both resolve.
ALTER TABLE public.whatsapp_alert_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.whatsapp_alert_log TO authenticated;

DROP POLICY IF EXISTS "whatsapp_alert_log_select_admin" ON public.whatsapp_alert_log;
CREATE POLICY "whatsapp_alert_log_select_admin"
  ON public.whatsapp_alert_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
        AND u.role = 'admin'
    )
  );

-- ── Documentation ──────────────────────────────────────────────────────────
COMMENT ON TABLE  public.whatsapp_alert_settings IS
  'Singleton config for the "rep WhatsApp disconnected" alert: which rep''s Green API instance sends it, which group receives it, and the flap cooldown. Holds monitor_token — service role only, no RLS policies.';
COMMENT ON COLUMN public.whatsapp_alert_settings.notifier_user_id IS
  'The rep whose Green API instance sends the alert. That number must be a member of group_chat_id.';
COMMENT ON COLUMN public.whatsapp_alert_settings.cooldown_minutes IS
  'Minimum gap between two alerts about the same rep. Flap suppression — an outage already alerts only once.';
COMMENT ON COLUMN public.whatsapp_alert_settings.monitor_token IS
  'Shared secret for the scheduled sweep (x-monitor-token header on greenApiStateMonitor).';
COMMENT ON COLUMN public.whatsapp_accounts.disconnected_since IS
  'When the current outage started (state stopped being authorized). NULL = connected.';
COMMENT ON COLUMN public.whatsapp_accounts.alerted_since IS
  'The disconnected_since value we already announced — makes the alert one-per-outage.';
COMMENT ON COLUMN public.whatsapp_accounts.was_authorized IS
  'True once the instance has been observed authorized. Guards against announcing a never-linked rep as "disconnected".';
COMMENT ON TABLE  public.whatsapp_alert_log IS
  'Append-only record of every disconnect/recovery alert sent to the WhatsApp group.';

NOTIFY pgrst, 'reload schema';

COMMIT;
