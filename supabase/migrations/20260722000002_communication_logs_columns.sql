-- Communication logs — ensure the columns the app writes actually exist.
--
-- `communication_logs` is a base44-legacy table with no CREATE TABLE migration
-- in this repo, so its real schema is whatever base44 provisioned. The lead
-- screen's "הוסף תקשורת" writes {type, direction, subject, content, outcome,
-- duration_seconds, notes, lead_id, rep_id}, but the client's PostgREST wrapper
-- (writeWithSchemaResilience) SILENTLY DROPS any column the table doesn't have
-- and retries — so a missing `content` column meant the row saved with an empty
-- body and the note/communication text simply vanished (nothing shown in the
-- "פעילות הליד" timeline).
--
-- Add every written column IF NOT EXISTS (existing columns are left untouched,
-- so their real types are preserved) and widen the GRANT so the new columns are
-- writable by authenticated clients. Idempotent — safe to re-run.

BEGIN;

ALTER TABLE public.communication_logs
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS rep_id text;

-- The RLS policies (auth_insert/auth_update, CHECK true) already gate rows;
-- this table-level GRANT ensures the SQL privilege layer covers the newly
-- added columns too (a prior column-scoped grant would exclude them).
GRANT SELECT, INSERT, UPDATE ON public.communication_logs TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
