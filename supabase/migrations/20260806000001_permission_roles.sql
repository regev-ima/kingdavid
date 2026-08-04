-- ============================================================================
-- Access levels (רמות הרשאה) + the per-role permission matrix
-- ============================================================================
-- Adds the four-tier access model on top of the existing `users.role`:
--
--     נציג  <  מנהל חנות  <  מנהל ראשי  <  סופר אדמין
--
-- Everything here is ADDITIVE and nothing revokes an existing capability:
--
--   • users.access_level        — the new tier. NULL means "not set", and the
--                                 app infers it from `role` (admin → מנהל
--                                 ראשי, everyone else → נציג). Seeded below
--                                 to match, so the two agree from day one.
--   • users.permission_overrides — per-user exceptions, { key: true|false }.
--                                 Empty for everyone at first, which is why
--                                 nobody's access changes when this lands.
--   • role_permissions           — one row per editable tier holding the
--                                 matrix an admin edits in
--                                 הגדרות ← הרשאות ותפקידים. Seeded EMPTY on
--                                 purpose: an empty matrix means "nothing was
--                                 configured", and the client falls through to
--                                 the legacy gate for every single check.
--
-- `role` itself is untouched. It still drives the sidebar, every canAccess*
-- gate and three other RLS policies; re-pointing all of that at a new column
-- in one migration is how you take the sales floor down on a Sunday morning.
-- ============================================================================

BEGIN;

-- ── users: the new columns ──────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS access_level         text,
  ADD COLUMN IF NOT EXISTS permission_overrides jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_access_level_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_access_level_check
      CHECK (access_level IS NULL OR access_level IN
             ('rep', 'store_manager', 'chief_manager', 'super_admin'));
  END IF;
END $$;

COMMENT ON COLUMN public.users.access_level IS
  'רמת הרשאה: rep | store_manager | chief_manager | super_admin. NULL = infer from role.';
COMMENT ON COLUMN public.users.permission_overrides IS
  'Per-user exceptions to the role matrix: { "finance.view": true, "leads.delete": false }.';

-- ── Seed the tier from the legacy role ──────────────────────────────────────
-- Only fills rows where it is still NULL, so re-running never overwrites a
-- level somebody set by hand.
--
-- The privilege-escalation trigger is switched off around the seed. It is
-- SECURITY INVOKER and raises whenever auth.uid() resolves to no admin — which
-- is exactly the case inside a migration, where there is no authenticated
-- caller at all. Disabling it explicitly beats relying on the fact that the
-- currently-installed version of the function has not heard of access_level
-- yet: that happens to be true today and would stop being true the moment
-- anyone re-orders this file.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'prevent_users_privilege_escalation_trigger'
       AND tgrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users DISABLE TRIGGER prevent_users_privilege_escalation_trigger;
  END IF;
END $$;

UPDATE public.users
   SET access_level = CASE WHEN role = 'admin' THEN 'chief_manager' ELSE 'rep' END
 WHERE access_level IS NULL;

-- Netanel and Regev are the super admins (per the brief). Matched on name or
-- e-mail because there is no stable id to key on, and scoped to existing
-- admins so a same-named rep is never promoted. If this matches nobody the
-- app falls back to "any legacy admin may manage permissions" until somebody
-- is appointed — see canManagePermissions() in lib/permissions/resolve.js.
UPDATE public.users
   SET access_level = 'super_admin'
 WHERE role = 'admin'
   AND access_level IS DISTINCT FROM 'super_admin'
   AND (
        full_name ILIKE '%נתנאל%'
     OR full_name ILIKE '%רגב%'
     OR email     ILIKE 'netanel%'
     OR email     ILIKE 'natanel%'
     OR email     ILIKE 'regev%'
   );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'prevent_users_privilege_escalation_trigger'
       AND tgrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users ENABLE TRIGGER prevent_users_privilege_escalation_trigger;
  END IF;
END $$;

-- ── is_super_admin(): used by the policies below ────────────────────────────
-- Matches on auth_id OR e-mail, the same way the app_policies and
-- shift_assignments policies do, so a profile whose auth_id was never linked
-- still resolves.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
       AND u.access_level = 'super_admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- True while nobody has been appointed super admin yet. The bootstrap window:
-- without it a fresh environment has no one who can open the permissions
-- screen, and the feature is unreachable by construction.
CREATE OR REPLACE FUNCTION public.no_super_admin_exists()
RETURNS boolean AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.users WHERE access_level = 'super_admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.can_manage_permissions()
RETURNS boolean AS $$
  SELECT public.is_super_admin()
      OR (public.no_super_admin_exists() AND EXISTS (
            SELECT 1 FROM public.users u
             WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
               AND u.role = 'admin'
          ));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── role_permissions: the matrix ────────────────────────────────────────────

-- `id` IS the access level ('rep' | 'store_manager' | 'chief_manager') rather
-- than a surrogate key, so the generic entity API in src/api/entities.js —
-- which addresses every table as .update(id, …) — can write a row without a
-- bespoke code path.
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id           text        PRIMARY KEY
                           CHECK (id IN ('rep', 'store_manager', 'chief_manager')),
  -- { "finance.view": true, "leads.delete": false }. A key that is ABSENT is
  -- not the same as one set to false: absent means "not configured", and the
  -- client falls back to the legacy gate. That distinction is the entire
  -- backwards-compatibility story, so never default this to a full map.
  permissions  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_date timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

INSERT INTO public.role_permissions (id)
VALUES ('rep'), ('store_manager'), ('chief_manager')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Read: everyone signed in. The client cannot decide what a user may see
-- without knowing the matrix, so it has to be readable by the users it
-- constrains. It holds no secret — only which switches are on.
DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
CREATE POLICY "role_permissions_select"
  ON public.role_permissions FOR SELECT
  TO authenticated
  USING (true);

-- Write: super admins only (plus the bootstrap window). Whoever can edit the
-- matrix can grant themselves everything else, so this is the one gate that
-- has to hold at the database and not only in the UI.
DROP POLICY IF EXISTS "role_permissions_update" ON public.role_permissions;
CREATE POLICY "role_permissions_update"
  ON public.role_permissions FOR UPDATE
  TO authenticated
  USING (public.can_manage_permissions())
  WITH CHECK (public.can_manage_permissions());

-- No INSERT/DELETE policy: the three rows are created here and the set of
-- access levels is not the app's to extend at runtime.

COMMENT ON TABLE public.role_permissions IS
  'Per-access-level permission matrix edited from הגדרות ← הרשאות ותפקידים. Absent key = not configured.';

-- ── Privilege-escalation guard ──────────────────────────────────────────────
-- The self_update_users policy lets a non-admin UPDATE their own row, so every
-- new authorisation column has to be named here or it is self-service. Extends
-- the existing function (20260708000001) with the two new columns, and adds
-- the rule that only a super admin may mint another super admin — otherwise a
-- plain admin could promote themselves past the tier that guards this system.

CREATE OR REPLACE FUNCTION public.prevent_users_privilege_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
  caller_level text;
BEGIN
  SELECT role, access_level INTO caller_role, caller_level
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

  -- Applies to admins too: סופר אדמין is granted by a סופר אדמין, or during
  -- the bootstrap window when there is not one yet.
  IF NEW.access_level IS DISTINCT FROM OLD.access_level
     AND (NEW.access_level = 'super_admin' OR OLD.access_level = 'super_admin')
     AND caller_level IS DISTINCT FROM 'super_admin'
     AND NOT public.no_super_admin_exists()
  THEN
    RAISE EXCEPTION 'רק סופר אדמין רשאי להעניק או להסיר רמת סופר אדמין';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

COMMIT;

NOTIFY pgrst, 'reload schema';
