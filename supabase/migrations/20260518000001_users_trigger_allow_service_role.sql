-- Bug fix on top of 20260517000002_users_privilege_escalation_lockdown.sql.
--
-- The privilege-escalation trigger correctly blocks non-admin users from
-- editing sensitive columns (role, commission_rate, is_active, department,
-- email, auth_id). But it conflates two different "no auth.uid()" cases:
--
--   1. An anonymous caller (should be blocked — correct).
--   2. A service-role caller from an edge function (should NOT be blocked —
--      these are legitimate system operations like the invite flow linking
--      a freshly-created auth user to its users-table profile via auth_id).
--
-- Symptom in production: handleDirectInvite in importUsersFromSheets writes
-- the profile, then tries to `UPDATE users SET auth_id = ...`. Service role
-- has no JWT, so auth.uid() is NULL, so caller_role is NULL, so the trigger
-- rejects the change. The invitee ends up with auth_id = NULL and cannot
-- log in even with the correct password.
--
-- Fix: let the trigger short-circuit when auth.role() = 'service_role'.
-- This is the standard Supabase signal that the call came from a trusted
-- system context (edge function with the service-role key), not a user.

CREATE OR REPLACE FUNCTION public.prevent_users_privilege_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
  -- Service-role callers (edge functions running with the service key) are
  -- trusted system context — never block them.
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

NOTIFY pgrst, 'reload schema';
