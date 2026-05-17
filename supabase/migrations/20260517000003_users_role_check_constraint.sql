-- Allow the full set of role values the app actually assigns.
--
-- The `users_role_check` CHECK constraint was created back when the
-- table was first set up (via the Supabase Dashboard, not a tracked
-- migration), so it predates the `bookkeeper` role added in PR #168
-- and the `sales_user` value the invite-rep dialog has been using.
-- Symptom: admin tries to flip a rep to "מנהלת חשבונות" and the
-- update fails with:
--   new row for relation "users" violates check constraint
--   "users_role_check"
--
-- Fix: drop the old constraint, recreate it with every role the
-- frontend lets an admin pick. NULL is allowed too because some
-- legacy / freshly invited rows don't have a role set yet (the app
-- falls back to 'user' in those cases).

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (
    role IS NULL
    OR role IN ('admin', 'user', 'sales_user', 'factory_user', 'bookkeeper')
  );

NOTIFY pgrst, 'reload schema';
