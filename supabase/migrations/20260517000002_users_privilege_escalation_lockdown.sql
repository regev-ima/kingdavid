-- Privilege-escalation hardening on the `users` table.
--
-- Until this migration the catch-all `USING (true)` / `WITH CHECK (true)`
-- policies from 20240202000001_enable_rls_all_tables.sql meant ANY
-- authenticated user could:
--   • UPDATE their own row to set `role = 'admin'` and
--     `commission_rate = 100`,
--   • UPDATE other users' rows (e.g. flip a rep's voicenter_extension
--     to redirect their incoming calls to the attacker),
--   • INSERT a brand-new admin user.
--
-- The rest of the schema deliberately stays permissive — the business
-- wants every rep to see every lead / quote / order / customer for
-- hand-off and cross-rep visibility. This migration scopes the
-- privilege-escalation surface to the `users` table alone, with the
-- minimum changes needed to keep the existing flows (admin editing
-- reps on Representatives.jsx, self-profile updates) working.
--
-- The protection has three layers:
--   1. INSERT — admins only. Self-signup goes through Supabase Auth,
--      which writes the row via service-role, so we don't break that.
--   2. UPDATE — split policy: admins can update any row, anyone else
--      can only update their own row.
--   3. BEFORE UPDATE trigger — even on self-update, sensitive columns
--      (role, commission_rate, is_active, department, email, auth_id)
--      can only be changed by admins. RLS is row-level and can't
--      compare OLD vs NEW; the trigger fills that gap.

-- ── 1. INSERT: admins only ──────────────────────────────────────────
DROP POLICY IF EXISTS auth_insert_users ON public.users;

CREATE POLICY admin_insert_users ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users
      WHERE auth_id = auth.uid()
        AND role = 'admin'
    )
  );

-- ── 2. UPDATE: split admin / self ───────────────────────────────────
DROP POLICY IF EXISTS auth_update_users ON public.users;

-- Admin can update anyone, any column (subject to the trigger below
-- which is a no-op for admins).
CREATE POLICY admin_update_users ON public.users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users
      WHERE auth_id = auth.uid()
        AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users
      WHERE auth_id = auth.uid()
        AND role = 'admin'
    )
  );

-- Non-admin: only their own row, but the trigger will reject changes
-- to the sensitive columns.
CREATE POLICY self_update_users ON public.users
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- ── 3. Column-level guard via BEFORE UPDATE trigger ─────────────────
-- SECURITY INVOKER (default) so auth.uid() reflects the actual caller.
-- The SELECT against public.users succeeds because the table-wide
-- SELECT policy is still `USING (true)` for authenticated users.
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DROP TRIGGER IF EXISTS prevent_users_privilege_escalation_trigger ON public.users;
CREATE TRIGGER prevent_users_privilege_escalation_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_users_privilege_escalation();

NOTIFY pgrst, 'reload schema';
