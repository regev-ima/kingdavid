-- ============================================================================
-- Fix: backfill_lead_contacts() could not be run from the SQL Editor
-- ============================================================================
-- 20260726000001 shipped backfill_lead_contacts() with this guard:
--
--   IF NOT EXISTS (SELECT 1 FROM public.users u
--                  WHERE (u.auth_id = auth.uid()
--                      OR u.email = (auth.jwt() ->> 'email'))
--                    AND u.role = 'admin') THEN RAISE EXCEPTION 'forbidden' …
--
-- …and then documented it to be run from the Supabase SQL Editor. Those two
-- things contradict: the SQL Editor has no JWT, so auth.uid() and
-- auth.jwt()->>'email' are both NULL, `u.email = NULL` is never true, and the
-- function refuses with "forbidden: admin role required". The only place it
-- could actually run was a logged-in admin's browser session, which is not
-- where a 104k-row chunked backfill belongs.
--
-- This file adds public.assert_admin_or_service() and rebuilds
-- backfill_lead_contacts() on top of it, plus a looping wrapper so the whole
-- backfill is one call instead of ~52.
--
-- NOT changed: process_lead_import() keeps the JWT-only guard. It is invoked
-- from the import screen by a logged-in admin, where that guard is exactly
-- right, and rebuilding its 150-line body here purely to swap four lines would
-- duplicate it across two migrations and invite drift.
-- ============================================================================

BEGIN;

-- ─── Shared guard ──────────────────────────────────────────────────────────
-- Why "no JWT ⇒ allow" is safe rather than a hole:
--   * EXECUTE on these functions is granted to `authenticated` only, never to
--     `anon`, so an unauthenticated PostgREST request cannot reach them.
--   * A PostgREST request carrying the `authenticated` role always has a JWT,
--     so `auth.uid() IS NULL AND email IS NULL` cannot describe one.
--   * What is left — the SQL Editor, a service_role key, a cron job — already
--     holds full, RLS-bypassing access to every table these functions touch.
--     Refusing them buys no security; it only breaks the documented workflow.
CREATE OR REPLACE FUNCTION public.assert_admin_or_service()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL AND (auth.jwt() ->> 'email') IS NULL THEN
    RETURN;  -- SQL Editor / service_role / cron
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_admin_or_service() IS
  'Raises unless the caller is an admin user or a no-JWT connection (SQL Editor / service_role / cron).';

-- ─── Rebuilt backfill ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_lead_contacts(p_chunk integer DEFAULT 2000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  PERFORM public.assert_admin_or_service();

  FOR r IN
    SELECT id, phone, full_name, email, source, created_date
    FROM public.leads
    WHERE contact_id IS NULL AND phone IS NOT NULL AND btrim(phone) <> ''
    ORDER BY created_date NULLS LAST
    LIMIT p_chunk
  LOOP
    UPDATE public.leads
    SET contact_id = public.resolve_or_create_contact(
          r.phone, r.full_name, r.email, NULL, NULL, r.source, r.created_date)
    WHERE id = r.id;
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

-- ─── Looping wrapper ───────────────────────────────────────────────────────
-- Runs chunk after chunk until nothing is left or the time budget is spent, so
-- the operator makes one call instead of ~52 for a 104k-row table. Returns
-- done=false when it stopped on the clock — call it again to continue.
CREATE OR REPLACE FUNCTION public.backfill_lead_contacts_all(
  p_chunk       integer DEFAULT 2000,
  p_max_seconds integer DEFAULT 240
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  started   timestamptz := clock_timestamp();
  n         integer;
  attached  integer := 0;
  rounds    integer := 0;
  remaining bigint;
BEGIN
  PERFORM public.assert_admin_or_service();

  LOOP
    SELECT public.backfill_lead_contacts(p_chunk) INTO n;
    attached := attached + n;
    rounds   := rounds + 1;
    EXIT WHEN n = 0;
    EXIT WHEN extract(epoch FROM clock_timestamp() - started) > p_max_seconds;
  END LOOP;

  SELECT count(*) INTO remaining
  FROM public.leads
  WHERE contact_id IS NULL AND phone IS NOT NULL AND btrim(phone) <> '';

  RETURN jsonb_build_object(
    'attached',       attached,
    'rounds',         rounds,
    'remaining',      remaining,
    'done',           remaining = 0,
    'elapsed_seconds', round(extract(epoch FROM clock_timestamp() - started)::numeric, 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_or_service()                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_lead_contacts(integer)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_lead_contacts_all(integer, integer)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_lead_contacts(integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_lead_contacts_all(integer, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Run the whole backfill (repeat while "done" is false):
--   SELECT public.backfill_lead_contacts_all();
