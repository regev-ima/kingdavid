-- ============================================================================
-- Access levels (רמות הרשאה), the per-role permission matrix, and the
-- confidential super-admin set
-- ============================================================================
-- Adds the four-tier access model on top of the existing `users.role`:
--
--     נציג  <  מנהל חנות  <  מנהל ראשי  <  סופר אדמין
--
-- Everything here is ADDITIVE and nothing revokes an existing capability:
--
--   • users.access_level        — the visible tier: rep | store_manager |
--                                 chief_manager. NULL means "not set", and the
--                                 app infers it from `role` (admin → מנהל
--                                 ראשי, everyone else → נציג). Seeded below to
--                                 match, so the two agree from day one.
--   • users.permission_overrides — per-user exceptions, { key: true|false }.
--                                 Empty for everyone at first, which is why
--                                 nobody's access changes when this lands.
--   • role_permissions           — one row per editable tier holding the matrix
--                                 edited in הגדרות ← הרשאות ותפקידים. Seeded
--                                 EMPTY on purpose: an empty matrix means
--                                 "nothing was configured", and the client
--                                 falls through to the legacy gate for every
--                                 single check.
--   • super_admins               — WHO the super admins are. See below.
--
-- `role` itself is untouched. It still drives the sidebar, every canAccess*
-- gate and three other RLS policies; re-pointing all of that at a new column
-- in one migration is how you take the sales floor down on a Sunday morning.
--
-- ── Why super admin is a separate table, and not a fourth access_level ──────
--
-- Because it has to be a secret, and `users` is not a place secrets can live.
-- The table-wide SELECT policy on public.users is `USING (true)`: every signed
-- in user may read every user row, and the client does `select('*')`. Storing
-- 'super_admin' in users.access_level would therefore publish the answer to
-- "who are the super admins?" to every rep with a browser devtools panel, no
-- matter what the UI chooses to render.
--
-- So the tier column keeps only the three ordinary levels, and membership of
-- the confidential set lives in its own table whose SELECT policy answers
-- "only if you are already in it". A non-member gets zero rows and cannot
-- distinguish "the set is empty" from "I am not in it".
-- ============================================================================

BEGIN;

-- ── users: the new columns ──────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS access_level         text,
  ADD COLUMN IF NOT EXISTS permission_overrides jsonb;

-- Drop any earlier version of the constraint before re-adding it: an install
-- that ran a previous draft of this file may still allow 'super_admin' here.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_access_level_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_access_level_check
  CHECK (access_level IS NULL OR access_level IN
         ('rep', 'store_manager', 'chief_manager'));

COMMENT ON COLUMN public.users.access_level IS
  'רמת הרשאה גלויה: rep | store_manager | chief_manager. NULL = infer from role. Super admin is NOT stored here — see public.super_admins.';
COMMENT ON COLUMN public.users.permission_overrides IS
  'Per-user exceptions to the role matrix: { "finance.view": true, "leads.delete": false }.';

-- ── super_admins: the confidential set ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id    uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

COMMENT ON TABLE public.super_admins IS
  'Confidential. Membership is readable only by members — see the RLS policies below. Never expose this through a view or a join that a non-member can reach.';

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

-- ── The predicates ──────────────────────────────────────────────────────────
-- All SECURITY DEFINER. Two reasons: the RLS policy on super_admins has to ask
-- "is the caller a super admin?", which reads super_admins — that would recurse
-- forever under RLS, and SECURITY DEFINER bypasses it. And a non-member must be
-- able to call them without being able to read the table behind them.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.super_admins sa
      JOIN public.users u ON u.id = sa.user_id
     WHERE u.auth_id = auth.uid()
        OR lower(btrim(u.email)) = lower(btrim(auth.jwt() ->> 'email'))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.is_super_admin() IS
  'True when the CALLER is a super admin. Returns only a boolean about yourself — it never reveals anything about anybody else.';

-- Existence only, never identity. This is what keeps the bootstrap window
-- possible without publishing the membership: an admin can learn that the set
-- is empty (and therefore that they may appoint the first member), but never
-- who is in it once it is not.
CREATE OR REPLACE FUNCTION public.any_super_admin_exists()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_admins);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.can_manage_permissions()
RETURNS boolean AS $$
  SELECT public.is_super_admin()
      OR (NOT public.any_super_admin_exists() AND EXISTS (
            SELECT 1 FROM public.users u
             WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
               AND u.role = 'admin'
          ));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_super_admin()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.any_super_admin_exists()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_permissions()  TO authenticated;

-- ── super_admins policies ───────────────────────────────────────────────────
-- Read: members only. A non-member's SELECT returns zero rows rather than an
-- error, so the failure is indistinguishable from an empty table — which is
-- the point. There is deliberately no view, no join and no RPC that returns
-- the membership to anyone else.

DROP POLICY IF EXISTS "super_admins_select" ON public.super_admins;
CREATE POLICY "super_admins_select"
  ON public.super_admins FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Write: members only, plus the bootstrap window while the set is empty.
DROP POLICY IF EXISTS "super_admins_insert" ON public.super_admins;
CREATE POLICY "super_admins_insert"
  ON public.super_admins FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_permissions());

DROP POLICY IF EXISTS "super_admins_delete" ON public.super_admins;
CREATE POLICY "super_admins_delete"
  ON public.super_admins FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- No UPDATE policy: a membership row has nothing to update. Add or remove.

-- ── Seed ────────────────────────────────────────────────────────────────────
-- The two people named as super admins, matched on their exact addresses.
-- Not a name pattern: an authorisation rule keyed on "%רגב%" is one new hire
-- away from promoting the wrong person, and nobody would notice.

INSERT INTO public.super_admins (user_id, created_by)
SELECT u.id, 'migration:20260806000001'
  FROM public.users u
 WHERE lower(btrim(u.email)) IN ('nate@imagick.ai', 'regev@imagick.ai')
ON CONFLICT (user_id) DO NOTHING;

-- ── Seed the visible tier from the legacy role ──────────────────────────────
-- Only fills rows where it is still NULL, so re-running never overwrites a
-- level somebody set by hand. Super admins get 'chief_manager' here like any
-- other admin: their real level is the table above, and a tier column that
-- said otherwise would leak exactly what this migration is hiding.
--
-- The privilege-escalation trigger is switched off around the seed. It is
-- SECURITY INVOKER and raises whenever auth.uid() resolves to no admin — which
-- is exactly the case inside a migration, where there is no authenticated
-- caller at all.

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

-- An install that ran a previous draft of this file may have written
-- 'super_admin' into the column before the CHECK above was tightened.
UPDATE public.users
   SET access_level = 'chief_manager'
 WHERE access_level NOT IN ('rep', 'store_manager', 'chief_manager');

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
-- constrains. It holds no secret — only which switches are on, for tiers
-- everyone already knows exist.
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

-- No INSERT or DELETE policy: the three rows are created here and the set of
-- access levels is not the app's to extend at runtime.

COMMENT ON TABLE public.role_permissions IS
  'Per-access-level permission matrix edited from הגדרות ← הרשאות ותפקידים. Absent key = not configured.';

-- ── Privilege-escalation guard ──────────────────────────────────────────────
-- The self_update_users policy lets a non-admin UPDATE their own row, so every
-- new authorisation column has to be named here or it is self-service. Extends
-- the existing function (20260708000001) with the two new columns.
--
-- No super-admin branch is needed any more: the tier column cannot hold that
-- value (the CHECK above), and membership is guarded by the super_admins
-- policies instead.

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

COMMIT;

NOTIFY pgrst, 'reload schema';
