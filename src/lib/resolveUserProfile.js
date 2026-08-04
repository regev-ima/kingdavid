import { supabase } from '@/api/supabaseClient';

/**
 * Resolve the CRM profile row (`public.users`) for an authenticated Supabase
 * auth user.
 *
 * Primary match is by `auth_id`. If that misses we fall back to the session's
 * email — which Supabase Auth has already verified — so a legitimate login can
 * never dead-end on the `/login` bounce loop just because `auth_id` was never
 * linked (the invite flow links it server-side and that can fail silently) or
 * drifted out of sync.
 *
 * Uses `.limit(1)` rather than `.single()` on purpose: `.single()` throws when
 * zero or more-than-one rows come back, and a single stray/duplicate row would
 * otherwise lock the user out completely instead of just logging them in.
 *
 * @param {{ id?: string, email?: string } | null | undefined} authUser
 * @returns {Promise<object | null>} the profile row, or null if none exists.
 */
export async function resolveUserProfile(authUser) {
  if (!authUser) return null;

  if (authUser.id) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authUser.id)
      .limit(1);
    if (data && data.length > 0) return data[0];
  }

  if (authUser.email) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .ilike('email', authUser.email)
      .limit(1);
    if (data && data.length > 0) {
      const profile = data[0];
      // Heal the link we just had to work around.
      //
      // The fallback above keeps the user logged in, but the DATABASE only ever
      // matches on auth_id: every RLS delete policy reads
      //   EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role='admin')
      // so an admin whose row was never linked is an admin everywhere in the UI
      // and cannot delete a single row — and PostgREST reports that refusal as a
      // success with no rows, which is how "I click delete and nothing happens"
      // stayed invisible.
      //
      // Only fills an EMPTY link, never repoints one that already exists: a row
      // pointing at a different account is a real conflict, not drift, and
      // stealing it would hand one person another's records.
      if (authUser.id && !profile.auth_id) {
        const { data: linked } = await supabase
          .from('users')
          .update({ auth_id: authUser.id })
          .eq('id', profile.id)
          .is('auth_id', null)
          .select('*')
          .limit(1);
        if (linked && linked.length > 0) return linked[0];
      }
      return profile;
    }
  }

  return null;
}
