-- Link CRM profiles to their login accounts.
--
-- public.users rows carry `auth_id`, the pointer to the Supabase auth account.
-- The invite flow sets it server-side and can fail silently (the comment in
-- src/lib/resolveUserProfile.js has said so for a while), so the app resolves a
-- profile by auth_id OR, failing that, by the session's verified email.
--
-- The database has no such fallback. Every table's delete policy reads
--
--   FOR DELETE USING (EXISTS (SELECT 1 FROM users
--                              WHERE auth_id = auth.uid() AND role = 'admin'))
--
-- (migration 20240202000001), so a profile with no auth_id is an admin in every
-- screen and cannot delete a single row. Worse, PostgREST reports that refusal
-- as a success with an empty body: the confirm closes, nothing is deleted, and
-- no error is raised anywhere. That is the "I press delete and nothing happens"
-- report, and it applies to every delete in the app, not just products.
--
-- This links the rows that were never linked, matching on the email Supabase
-- Auth already verified.
--
-- SAFETY
--   * only rows whose auth_id IS NULL — an existing link is never repointed;
--   * only when exactly one auth account matches the email, so an ambiguous
--     match is left alone rather than resolved by guesswork;
--   * case-insensitive, trimmed comparison, because profile emails were typed
--     by hand over the years.
--
-- Idempotent: a second run finds nothing left to link.

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
