/**
 * Supabase-backed replacement for the Base44 SDK.
 *
 * This module exposes the same `base44` interface that the rest of the app
 * already imports, so no changes are needed in the 76+ consumer files.
 *
 *   base44.entities.<Entity>.list / filter / create / update / delete / subscribe
 *   base44.auth.me / logout / redirectToLogin / updateMe
 *   base44.functions.invoke(name, params)
 *   base44.integrations.Core.UploadFile / SendEmail / InvokeLLM / ExtractDataFromUploadedFile
 *   base44.asServiceRole.entities.* (same as entities, RLS disabled via service role)
 */
import { supabase } from './supabaseClient';
import { entities } from './entities';

// ── Auth helpers ────────────────────────────────────────────────
const auth = {
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

  async logout(redirectUrl) {
    await supabase.auth.signOut();
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  },

  redirectToLogin(redirectUrl) {
    const loginPath = '/login';
    const redirect = redirectUrl ? `?redirect=${encodeURIComponent(redirectUrl)}` : '';
    window.location.href = `${loginPath}${redirect}`;
  },
};

// ── Functions (Edge Functions) ──────────────────────────────────
const functions = {
  async invoke(functionName, params) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: params,
    });
    if (error) throw error;
    return data;
  },
};

// ── Integrations (Core: file upload, email, LLM) ───────────────
const integrations = {
  Core: {
    async UploadFile({ file }) {
      const fileName = `${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage
        .from('uploads')
        .upload(fileName, file);

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('uploads')
        .getPublicUrl(fileName);

      return { file_url: urlData.publicUrl };
    },

    async SendEmail({ to, subject, body }) {
      // Route through Edge Function for email sending
      return await functions.invoke('sendEmail', { to, subject, body });
    },

    async InvokeLLM({ prompt, response_json_schema, model }) {
      // Route through Edge Function for LLM calls
      return await functions.invoke('invokeLLM', { prompt, response_json_schema, model });
    },

    async ExtractDataFromUploadedFile({ file_url, json_schema }) {
      return await functions.invoke('extractData', { file_url, json_schema });
    },
  },
};

// ── App Logs (no-op) ────────────────────────────────────────────
const appLogs = {
  logUserInApp: async () => {},
};

// ── Users management ────────────────────────────────────────────
const users = {
  inviteUser: async () => { throw new Error('User invite not implemented yet'); },
};

// ── Agents ──────────────────────────────────────────────────────
const agents = {
  getWhatsAppConnectURL: () => '#',
};

// ── Main export ─────────────────────────────────────────────────
export const base44 = {
  entities,
  auth,
  functions,
  integrations,
  appLogs,
  users,
  agents,
  // asServiceRole uses the same entities (RLS is disabled on tables)
  asServiceRole: { entities },
  supabase,
};
