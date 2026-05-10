-- Schedule syncVoicenterCalls to run every 15 minutes via pg_cron.
--
-- Prerequisite (run once per environment, manually, before this migration runs):
--   SELECT vault.create_secret('https://<project-ref>.supabase.co', 'supabase_url');
--   SELECT vault.create_secret('<service-role-key>', 'supabase_service_role_key');
-- These are read from vault.decrypted_secrets at job execution time.

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
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/syncVoicenterCalls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);
