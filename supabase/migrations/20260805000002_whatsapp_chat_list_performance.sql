-- Make the WhatsApp conversation list load instantly instead of in 5-10s.
--
-- Clicking "ממתינים" runs
--   SELECT * FROM whatsapp_chats WHERE status='waiting'
--   ORDER BY last_message_at DESC LIMIT 100
-- and two things made that slow, both of which get worse as the table grows.
--
-- 1. THE RLS POLICY WAS CORRELATED. It read
--      EXISTS (SELECT 1 FROM users u
--              WHERE (u.auth_id = auth.uid() OR u.email = auth.jwt()->>'email')
--                AND (u.role='admin' OR u.id = whatsapp_chats.user_id))
--    Because the subquery mentions whatsapp_chats.user_id it is correlated, so
--    Postgres re-runs it FOR EVERY CANDIDATE ROW — and each run calls auth.uid()
--    and auth.jwt() again, scans public.users, and applies users' OWN row
--    security on top. Hundreds of thousands of nested evaluations for one page
--    of 100 rows.
--
--    The rewrite below resolves "who is asking" ONCE per statement. Neither
--    helper mentions the row being checked, so both become uncorrelated
--    sub-plans the planner evaluates a single time; STABLE lets it cache them,
--    and SECURITY DEFINER keeps the lookup out of users' own RLS. The rule
--    itself is unchanged: admin → every row, everyone else → only rows they own.
--
-- 2. NO INDEX MATCHED THE QUERY. There were separate indexes on (status) and on
--    (last_message_at DESC), so a filtered + sorted + limited read could use one
--    or the other but never both: Postgres walked the table newest-first and
--    threw rows away one at a time, running the policy on each. The composite
--    indexes below answer filter + sort + limit in a single range scan.
--
-- Idempotent. Indexes are created without CONCURRENTLY because the Supabase
-- Management API runs each file in one transaction; whatsapp_chats is small
-- enough that the brief lock is not a problem.

-- ── Who is asking? Resolved once, not once per row ──────────────────────────
-- Matching on auth_id OR email is what the previous policy did (the session
-- token is shaped differently depending on how the user signed in), and both
-- could in principle match different rows — so this stays a set, exactly as the
-- EXISTS did.
CREATE OR REPLACE FUNCTION public.app_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.auth_id = auth.uid()
     OR u.email = (auth.jwt() ->> 'email')
$$;

CREATE OR REPLACE FUNCTION public.app_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  )
$$;

COMMENT ON FUNCTION public.app_user_ids() IS
  'public.users ids of the calling session. STABLE + SECURITY DEFINER so an RLS policy resolves the caller once per statement (uncorrelated subquery) instead of once per row.';
COMMENT ON FUNCTION public.app_user_is_admin() IS
  'True when the calling session maps to a public.users row with role = admin.';

-- They expose only the caller's own identity, but keep the grant tight anyway.
REVOKE ALL ON FUNCTION public.app_user_ids()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_ids()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_is_admin() TO authenticated;

-- ── The same rule, evaluated once ───────────────────────────────────────────
DROP POLICY IF EXISTS "whatsapp_chats_select_own_or_admin" ON public.whatsapp_chats;
CREATE POLICY "whatsapp_chats_select_own_or_admin"
  ON public.whatsapp_chats FOR SELECT
  TO authenticated
  USING (
    (SELECT public.app_user_is_admin())
    OR user_id IN (SELECT public.app_user_ids())
  );

DROP POLICY IF EXISTS "whatsapp_messages_select_own_or_admin" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_select_own_or_admin"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (
    (SELECT public.app_user_is_admin())
    OR user_id IN (SELECT public.app_user_ids())
  );

-- The client's one write path (mark a conversation as handled) carried the same
-- correlated check, so a rep pressing "סמן כטופל" paid the same cost.
DROP POLICY IF EXISTS "whatsapp_chats_update_own_or_admin" ON public.whatsapp_chats;
CREATE POLICY "whatsapp_chats_update_own_or_admin"
  ON public.whatsapp_chats FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.app_user_is_admin())
    OR user_id IN (SELECT public.app_user_ids())
  )
  WITH CHECK (
    (SELECT public.app_user_is_admin())
    OR user_id IN (SELECT public.app_user_ids())
  );

-- ── Indexes that match how the list is actually read ────────────────────────
-- A rep's cut: their rows, one status, newest first — one range scan.
CREATE INDEX IF NOT EXISTS whatsapp_chats_user_status_last_idx
  ON public.whatsapp_chats (user_id, status, last_message_at DESC);
-- A rep's unfiltered cut ("הכל"), and the per-rep admin filter.
CREATE INDEX IF NOT EXISTS whatsapp_chats_user_last_idx
  ON public.whatsapp_chats (user_id, last_message_at DESC);
-- An admin's cut across every rep.
CREATE INDEX IF NOT EXISTS whatsapp_chats_status_last_idx
  ON public.whatsapp_chats (status, last_message_at DESC);

-- The helpers hit public.users on every statement; without these that lookup is
-- a sequential scan. Guarded because the columns are base44-era and this repo
-- has no CREATE TABLE for public.users.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='users' AND column_name='auth_id') THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS users_auth_id_idx ON public.users (auth_id)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='users' AND column_name='email') THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email)';
    END IF;
  END IF;
END $$;

ANALYZE public.whatsapp_chats;
ANALYZE public.whatsapp_messages;
