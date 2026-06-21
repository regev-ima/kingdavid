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

// Allow only same-origin redirects. Without this, a crafted login or
// logout URL like `?redirect=https://attacker.com/phish` would bounce
// the user to an external site mid-session with an open-redirect-shaped
// surface. We accept a relative path ("/orders") or a full URL that
// matches the current origin; anything else collapses to "/".
function sanitizeRedirect(target) {
  if (typeof target !== 'string' || !target) return '/';
  // Relative path — always safe.
  if (target.startsWith('/') && !target.startsWith('//')) return target;
  try {
    const url = new URL(target, window.location.origin);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Fall through to the default below.
  }
  return '/';
}

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
      window.location.href = sanitizeRedirect(redirectUrl);
    }
  },

  redirectToLogin(redirectUrl) {
    const loginPath = '/login';
    const safe = sanitizeRedirect(redirectUrl);
    const redirect = safe && safe !== '/' ? `?redirect=${encodeURIComponent(safe)}` : '';
    window.location.href = `${loginPath}${redirect}`;
  },
};

// ── Functions (Edge Functions) ──────────────────────────────────
const functions = {
  async invoke(functionName, params) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: params,
    });
    if (error) {
      // FunctionsHttpError wraps the actual response in `context`. The default
      // message is just "Edge Function returned a non-2xx status code", which
      // hides the useful body. Pull the real error text out before throwing.
      try {
        if (error.context && typeof error.context.json === 'function') {
          const body = await error.context.json();
          if (body?.error) error.message = body.error;
        }
      } catch {
        // ignore — fall back to the original error message
      }
      throw error;
    }
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

    async SendEmail(params) {
      return await functions.invoke('sendEmail', params);
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
  // Every invited user starts as a basic sales rep ("נציג מכירות") with no
  // extra permissions. An admin promotes them afterwards from the
  // Representatives screen, so there's no role to pick at invite time — the
  // Edge Function enforces this server-side as well.
  inviteUser: async (email) => {
    // Create user via Edge Function (needs service role). Pass redirectTo so the
    // invite email link lands on /login, where the set-password flow is wired up.
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/login`
      : undefined;
    return await functions.invoke('importUsersFromSheets', {
      directInvite: true,
      email,
      role: 'sales_user',
      redirectTo,
    });
  },
};

// ── Agents ──────────────────────────────────────────────────────
const agents = {
  getWhatsAppConnectURL: () => '#',

  async createConversation({ agent_name, metadata }) {
    const { data, error } = await supabase
      .from('agent_conversations')
      .insert({ agent_name, metadata, messages: [] })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  subscribeToConversation(conversationId, callback) {
    const channel = supabase
      .channel(`agent_conv_${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_conversations', filter: `id=eq.${conversationId}` },
        (payload) => { callback(payload.new); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  },

  async addMessage(conversation, message) {
    const messages = [...(conversation.messages || []), message];
    const { data, error } = await supabase
      .from('agent_conversations')
      .update({ messages })
      .eq('id', conversation.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
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
