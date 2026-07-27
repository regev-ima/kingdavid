-- ============================================================================
-- app_policies — the global default for "who sees which leads"
-- ============================================================================
-- Lead visibility now routes through src/lib/leadVisibility.js, whose default
-- was compiled into the bundle. That made the policy a deploy, not a setting.
-- This table moves it into the database so an admin can flip it from the
-- Settings screen, and gives the per-rep users.extra_permissions.view_all_leads
-- grant something to be an exception TO — while the default is 'all' that grant
-- is a no-op, because everyone already sees everything.
--
-- Singleton, same shape as sms_settings: a fixed id = 1 row, so every reader
-- and writer targets the same row and there is no "which row is current?"
-- question to get wrong.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_policies (
  id              integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- 'all' = every sales user sees the whole pipeline.
  -- 'own' = a sales user sees only leads where they are rep1 / rep2 /
  --         pending_rep_email, which is how the app behaved before.
  -- Admins are never narrowed by this, in the app or here.
  lead_visibility text        NOT NULL DEFAULT 'all'
                              CHECK (lead_visibility IN ('all', 'own')),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- Create the singleton up front so readers never have to cope with an empty
-- table and writers can always UPDATE id = 1.
INSERT INTO public.app_policies (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_policies ENABLE ROW LEVEL SECURITY;

-- Read: everyone signed in. The client cannot decide what a rep may see
-- without knowing the policy, so this has to be readable by the reps it
-- constrains. It holds no secret — just 'all' or 'own'.
DROP POLICY IF EXISTS "app_policies_select" ON public.app_policies;
CREATE POLICY "app_policies_select"
  ON public.app_policies FOR SELECT
  TO authenticated
  USING (true);

-- Write: admins only. Mirrors the shift_assignments convention, matching on
-- auth_id OR email so a profile whose auth_id was never linked still resolves.
DROP POLICY IF EXISTS "app_policies_update" ON public.app_policies;
CREATE POLICY "app_policies_update"
  ON public.app_policies FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ));

-- No INSERT or DELETE policy on purpose: the singleton is created here, and
-- without a policy those commands are denied to every non-superuser. That is
-- the intent — there is exactly one row and it is not for the app to add or
-- remove.

COMMENT ON TABLE  public.app_policies IS
  'Singleton (id = 1) of system-wide policy switches editable from Settings.';
COMMENT ON COLUMN public.app_policies.lead_visibility IS
  'all = sales users see every lead; own = only their own. Admins are never narrowed.';

COMMIT;

NOTIFY pgrst, 'reload schema';
