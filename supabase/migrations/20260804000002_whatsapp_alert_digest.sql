-- WhatsApp disconnect alerts — the daily "still disconnected" digest.
--
-- WHY: 20260804000001 alerts once per outage and then goes quiet until the rep
-- reconnects. That keeps the group calm, but it leans on an assumption — that
-- the one message was read. A 🔴 that lands at 02:00, or inside a busy group,
-- gets buried, and then a rep is down for three days with nobody noticing:
-- exactly the failure the alert exists to prevent, one step later.
--
-- The fix is deliberately NOT a per-rep repeat timer. A reminder every few
-- hours turns the group into noise within two days (one rep down for a week at
-- 4h = 42 messages, and it multiplies by however many are down). Instead: ONE
-- message a day, at a fixed hour, listing everyone still disconnected and for
-- how long. It cannot flood — the ceiling is one extra message per day
-- regardless of how many reps are down or how long they stay down — and it
-- keeps the problem in front of someone until it is fixed.
--
-- When everyone is connected the digest sends NOTHING. Silence is the good
-- state; a daily "all fine" would train people to ignore the group.
--
-- The scheduled sweep (greenApiStateMonitor, every 10 minutes) carries this —
-- the first sweep at or after digest_hour sends the day's digest and stamps
-- digest_last_sent_on. No second cron, no new secret. GitHub's scheduler is
-- best-effort, so the digest can land a few minutes past the hour.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.whatsapp_alert_settings
  ADD COLUMN IF NOT EXISTS daily_digest        boolean  NOT NULL DEFAULT true,
  -- Hour of day in Israel time (Asia/Jerusalem), 0–23. The sweep compares
  -- against the wall clock there, not UTC, so DST never shifts it.
  ADD COLUMN IF NOT EXISTS digest_hour         smallint NOT NULL DEFAULT 9
                                               CHECK (digest_hour BETWEEN 0 AND 23),
  -- The Israel-local date whose digest already went out. Claimed
  -- compare-and-swap style, so two overlapping sweeps can't both send.
  ADD COLUMN IF NOT EXISTS digest_last_sent_on date;

-- The log gains a fourth kind.
ALTER TABLE public.whatsapp_alert_log DROP CONSTRAINT IF EXISTS whatsapp_alert_log_kind_check;
ALTER TABLE public.whatsapp_alert_log ADD CONSTRAINT whatsapp_alert_log_kind_check
  CHECK (kind IN ('disconnected', 'recovered', 'test', 'digest'));

COMMENT ON COLUMN public.whatsapp_alert_settings.daily_digest IS
  'Send one message a day listing reps still disconnected. Sends nothing when everybody is connected.';
COMMENT ON COLUMN public.whatsapp_alert_settings.digest_hour IS
  'Hour of day (0-23) in Asia/Jerusalem at which the digest goes out. The sweep delivers it on its first pass at or after this hour.';
COMMENT ON COLUMN public.whatsapp_alert_settings.digest_last_sent_on IS
  'Israel-local date of the last digest sent. Claimed before sending so overlapping sweeps cannot double-send.';

NOTIFY pgrst, 'reload schema';

COMMIT;
