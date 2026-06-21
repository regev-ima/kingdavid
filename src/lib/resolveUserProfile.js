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
    if (data && data.length > 0) return data[0];
  }

  return null;
}
