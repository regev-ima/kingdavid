-- Let trusted server-side callers through the privilege-escalation trigger.
--
-- prevent_users_privilege_escalation (20260517000002, last redefined in
-- 20260806000001) blocks non-admin writes to the sensitive columns. It decides
-- "who is calling" with
--
--   SELECT role INTO caller_role FROM public.users WHERE auth_id = auth.uid();
--
-- which conflates two very different callers that both produce a NULL result:
--
--   1. an anonymous / unprivileged client — must stay blocked;
--   2. an edge function holding the service-role key — has no JWT `sub`, so
--      auth.uid() is NULL, so caller_role is NULL, so it is blocked too.
--
-- Case 2 is the invite flow. handleDirectInvite in importUsersFromSheets
-- creates the profile, invites the auth user, then runs
--
--   UPDATE users SET auth_id = <new uuid> WHERE email = ...
--
-- and the trigger rejects it with 'אסור לשנות auth_id'. The edge function only
-- logs that failure, so the invite reports success while auth_id stays NULL.
--
-- That NULL is not cosmetic. resolveUserProfile.js still logs the person in by
-- falling back to their verified email, but the DATABASE has no such fallback:
-- every RLS delete policy reads
--
--   EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
--
-- so an unlinked user cannot delete a single row — and PostgREST reports that
-- refusal as a success with an empty body, which is the "I press delete and
-- nothing happens" report.
--
-- The client-side self-heal in resolveUserProfile.js cannot escape this either:
-- it runs as the signed-in user, whose auth_id is still NULL, so caller_role is
-- NULL and the same trigger rejects the same column. Setting auth_id requires
-- already having auth_id.
--
-- Fix: short-circuit on auth.role() = 'service_role', Supabase's signal that the
-- call carries the service key — a trusted server context, not a user. Every
-- other caller keeps exactly the guards it has today.
--
-- This body is 20260806000001's verbatim, plus the escape. It deliberately
-- keeps the extra_permissions / can_manage_service / access_level /
-- permission_overrides guards added after the original fix was written:
-- replacing the function with an older body would silently reopen them.
--
-- Idempotent: CREATE OR REPLACE, safe to re-run.

CREATE OR REPLACE FUNCTION public.prevent_users_privilege_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
  -- Service-role callers (edge functions running with the service key) are a
  -- trusted system context — never block them. Checked before the lookup
  -- below, which cannot identify them at all.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role
  FROM public.users
  WHERE auth_id = auth.uid();

  IF caller_role IS NULL OR caller_role <> 'admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'אסור לשנות role — רק admin רשאי לעדכן את שדה התפקיד';
    END IF;
    IF NEW.commission_rate IS DISTINCT FROM OLD.commission_rate THEN
      RAISE EXCEPTION 'אסור לשנות commission_rate — רק admin רשאי לעדכן עמלה';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'אסור לשנות is_active — רק admin רשאי להפעיל/להשבית משתמש';
    END IF;
    IF NEW.department IS DISTINCT FROM OLD.department THEN
      RAISE EXCEPTION 'אסור לשנות department — רק admin רשאי לעדכן מחלקה';
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'אסור לשנות email — רק admin רשאי לעדכן כתובת מייל';
    END IF;
    IF NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
      RAISE EXCEPTION 'אסור לשנות auth_id';
    END IF;
    IF NEW.extra_permissions IS DISTINCT FROM OLD.extra_permissions THEN
      RAISE EXCEPTION 'אסור לשנות extra_permissions — רק admin רשאי להעניק הרשאות';
    END IF;
    IF NEW.can_manage_service IS DISTINCT FROM OLD.can_manage_service THEN
      RAISE EXCEPTION 'אסור לשנות can_manage_service — רק admin רשאי להעניק הרשאות';
    END IF;
    IF NEW.access_level IS DISTINCT FROM OLD.access_level THEN
      RAISE EXCEPTION 'אסור לשנות access_level — רק admin רשאי לעדכן רמת הרשאה';
    END IF;
    IF NEW.permission_overrides IS DISTINCT FROM OLD.permission_overrides THEN
      RAISE EXCEPTION 'אסור לשנות permission_overrides — רק admin רשאי להעניק הרשאות';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Link the profiles that the broken trigger left unlinked. Same guards as
-- 20260804000007: only empty links, only an unambiguous single email match.
UPDATE public.users u
   SET auth_id = a.id
  FROM auth.users a
 WHERE u.auth_id IS NULL
   AND u.email IS NOT NULL
   AND lower(btrim(u.email)) = lower(btrim(a.email))
   AND (
     SELECT count(*) FROM auth.users a2
      WHERE lower(btrim(a2.email)) = lower(btrim(u.email))
   ) = 1;

NOTIFY pgrst, 'reload schema';
