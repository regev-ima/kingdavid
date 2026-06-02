-- Schedule the VoiceCenter call sync (תקלה: ניתוח שיחות הפסיק להתעדכן).
--
-- The edge function `syncVoicenterCalls` pulls the last 30 minutes of CDR
-- records from VoiceCenter and resolves pending call statuses. It is meant to
-- run every ~15 minutes, but the schedule lived only in the Supabase dashboard
-- (nothing in this repo), so when the function was refactored mid-May the
-- recurring invocation was never re-attached and the sync silently stopped.
--
-- This migration version-controls the schedule via pg_cron + pg_net so it can
-- never drift again. It is idempotent (safe to re-run).
--
-- ── ONE-TIME OPERATOR SETUP (run once per project, NOT committed) ──────────
-- The job reads the project URL and service-role key from Vault so no secret
-- is ever stored in git. Create them once (Dashboard → SQL editor), replacing
-- the placeholders with this project's values:
--
--     select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--     select vault.create_secret('<SERVICE_ROLE_KEY>',                'service_role_key');
--
-- To rotate later:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'service_role_key'),
--       '<NEW_SERVICE_ROLE_KEY>');
--
-- Until both secrets exist the cron job runs harmlessly as a no-op (the
-- guarded SELECT below simply produces no row, so net.http_post is skipped).
-- ---------------------------------------------------------------------------

-- 1. Extensions ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 2. Replace any previous definition of the job ----------------------------
do $$
begin
  perform cron.unschedule('sync-voicenter-calls');
exception
  when others then null; -- job did not exist yet
end $$;

-- 3. Schedule the sync every 15 minutes ------------------------------------
-- The body resolves the URL + key from Vault inside a FROM subquery and only
-- fires net.http_post when BOTH secrets are present, so a missing secret
-- degrades to a no-op instead of a recurring error in cron.job_run_details.
select cron.schedule(
  'sync-voicenter-calls',
  '*/15 * * * *',
  $cron$
  select
    net.http_post(
      url     := cfg.url_base || '/functions/v1/syncVoicenterCalls',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || cfg.svc_key
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    )
  from (
    -- btrim/rtrim defend against a stray newline or trailing slash pasted into
    -- the Vault secret, which would otherwise make pg_net reject the URL with
    -- "Quote command returned error".
    select
      rtrim(btrim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url')), '/') as url_base,
      btrim((select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))         as svc_key
  ) cfg
  where nullif(cfg.url_base, '') is not null
    and nullif(cfg.svc_key, '')  is not null;
  $cron$
);
