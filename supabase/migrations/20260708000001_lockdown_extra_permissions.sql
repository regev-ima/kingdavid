-- Close a self-service privilege-escalation hole: the users-table lockdown
-- trigger (20260517000002) blocks non-admins from changing role /
-- commission_rate / is_active / department / email / auth_id on their own row —
-- but NOT extra_permissions or can_manage_service. A rep could therefore grant
-- themselves every grantable capability (view_finance, bulk_update,
-- manage_service, edit_schedule) with a single self-update. Extend the guard to
-- cover both columns.

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_users_privilege_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

COMMIT;
