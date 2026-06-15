-- Rep-management columns on the `users` table.
--
-- Backs the new "נהל נציג" modal (Representatives.jsx → RepManageDialog),
-- which lets an admin manage everything about a rep in one place:
--   • work_schedule        — which days/hours the rep works (jsonb object,
--                            keyed by weekday 0..6 → { works, start, end })
--   • vacation_days        — list of vacation entries (jsonb array of
--                            { id, start_date, end_date, type, note })
--   • annual_vacation_days — yearly vacation allowance (integer)
--   • documents            — uploaded files such as the work contract
--                            (jsonb array of { id, name, url, category,
--                            uploaded_at, uploaded_by })
--   • extra_permissions    — grantable feature flags on top of the role
--                            (jsonb object, e.g. { "manage_service": true })
--
-- All columns are nullable / additive, so existing rows and existing code
-- paths are unaffected (the app falls back to sensible defaults when a
-- column is null). Re-runs are safe: ADD COLUMN IF NOT EXISTS + CREATE OR
-- REPLACE + DROP TRIGGER IF EXISTS are all idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS work_schedule        jsonb,
  ADD COLUMN IF NOT EXISTS vacation_days        jsonb,
  ADD COLUMN IF NOT EXISTS annual_vacation_days integer,
  ADD COLUMN IF NOT EXISTS documents            jsonb,
  ADD COLUMN IF NOT EXISTS extra_permissions    jsonb;

-- ── Privilege-escalation guard for extra_permissions ────────────────
-- The existing self_update_users policy (20260517000002) lets a non-admin
-- UPDATE their own row, and the existing privilege-escalation trigger only
-- guards role / commission_rate / is_active / department / email / auth_id.
-- Without this, a rep could PATCH their own row to grant themselves
-- extra_permissions (e.g. { "view_finance": true }). We add a SEPARATE,
-- additive BEFORE UPDATE trigger rather than editing the existing function,
-- so the proven privilege-escalation guard stays untouched. Two row-level
-- BEFORE UPDATE triggers coexist fine.
CREATE OR REPLACE FUNCTION public.prevent_users_permissions_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role
  FROM public.users
  WHERE auth_id = auth.uid();

  IF caller_role IS NULL OR caller_role <> 'admin' THEN
    IF NEW.extra_permissions IS DISTINCT FROM OLD.extra_permissions THEN
      RAISE EXCEPTION 'אסור לשנות extra_permissions — רק admin רשאי לעדכן הרשאות';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DROP TRIGGER IF EXISTS prevent_users_permissions_escalation_trigger ON public.users;
CREATE TRIGGER prevent_users_permissions_escalation_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_users_permissions_escalation();

NOTIFY pgrst, 'reload schema';
