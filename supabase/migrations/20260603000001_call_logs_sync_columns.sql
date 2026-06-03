-- Fix the VoiceCenter call sync (תקלה: ניתוח שיחות לא נמשך).
--
-- Root cause: syncVoicenterCalls inserts into public.call_logs a set of columns
-- (starting with `phone_number`) that don't all exist on the table, so EVERY
-- insert failed with PGRST204 ("Could not find the 'phone_number' column").
-- supabase-js returns the error instead of throwing, so the function counted
-- the failures as "new calls" and reported success while writing nothing —
-- which is why call_logs never advanced past 13/05.
--
-- This adds every column the function writes, idempotently. Columns that
-- already exist are skipped (ADD COLUMN IF NOT EXISTS keeps their current
-- type), so this is safe to re-run and won't disturb the legacy data.

alter table public.call_logs
  add column if not exists call_id               text,
  add column if not exists lead_id               uuid,
  add column if not exists rep_id                text,
  add column if not exists phone_number          text,
  add column if not exists call_started_at       timestamptz,
  add column if not exists call_ended_at         timestamptz,
  add column if not exists call_duration_seconds integer,
  add column if not exists call_result           text,
  add column if not exists call_direction        text,
  add column if not exists recording_url         text;

-- Speed up the sync's existing-call lookup (.eq('call_id', …)). Non-unique on
-- purpose: legacy rows might contain duplicate call_ids, and the function
-- already de-dupes via an explicit select-then-insert/update.
create index if not exists call_logs_call_id_idx
  on public.call_logs (call_id)
  where call_id is not null;

-- Reload PostgREST's schema cache so the new columns are visible immediately.
notify pgrst, 'reload schema';
