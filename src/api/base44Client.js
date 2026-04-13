/**
 * Supabase-backed replacement for the Base44 SDK.
 *
 * This module exposes the same `base44` interface that the rest of the app
 * already imports, so no changes are needed in the 76+ consumer files.
 *
 *   base44.entities.<Entity>.list / filter / create / update / delete
 *   base44.auth.me / logout / redirectToLogin / updateMe
 *   base44.functions.invoke(name, params)
 */
import { supabase } from './supabaseClient';
import { entities } from './entities';

// ── Auth helpers ────────────────────────────────────────────────
const auth = {
  /**
   * Get the currently logged-in user profile.
   */
  async me() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw authError || new Error('Not authenticated');

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (profileError) throw profileError;
    return profile;
  },

  /**
   * Update the current user's profile.
   */
  async updateMe(data) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: profile, error } = await supabase
      .from('users')
      .update(data)
      .eq('auth_id', user.id)
      .select()
      .single();

    if (error) throw error;
    return profile;
  },

  /**
   * Log out and optionally redirect.
   */
  async logout(redirectUrl) {
    await supabase.auth.signOut();
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  },

  /**
   * Redirect to login page.
   */
  redirectToLogin(redirectUrl) {
    const loginPath = '/login';
    const redirect = redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : '';
    window.location.href = `${loginPath}${redirect}`;
  },
};

// ── Functions (Edge Functions) ──────────────────────────────────
const functions = {
  /**
   * Invoke a Supabase Edge Function.
   * Mimics base44.functions.invoke(name, params).
   */
  async invoke(functionName, params) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: params,
    });
    if (error) throw error;
    return data;
  },
};

// ── App Logs (no-op, was Base44-specific) ───────────────────────
const appLogs = {
  logUserInApp: async () => {},
};

// ── Users management (no-op stubs) ─────────────────────────────
const users = {
  inviteUser: async () => { throw new Error('User invite not implemented yet'); },
};

// ── Agents (no-op stubs) ────────────────────────────────────────
const agents = {
  getWhatsAppConnectURL: () => '#',
};

// ── Main export ─────────────────────────────────────────────────
export const base44 = {
  entities,
  auth,
  functions,
  appLogs,
  users,
  agents,
  supabase,
};
