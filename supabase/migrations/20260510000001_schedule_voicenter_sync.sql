-- Schedule syncVoicenterCalls to run every 15 minutes via pg_cron.
--
-- Prerequisite (run once per environment, manually, before this migration takes effect):
--   ALTER DATABASE postgres SET app.supabase_url = 'https://<project-ref>.supabase.co';
--   ALTER DATABASE postgres SET app.supabase_service_role_key = '<service-role-key>';
-- These settings are read at job execution time by current_setting() below.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any existing schedule so this migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('sync-voicenter-calls');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-voicenter-calls',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/syncVoicenterCalls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);
