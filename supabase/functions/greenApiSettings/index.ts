// greenApiSettings — manage a rep's Green API (WhatsApp) connection from the
// CRM. The api_token is a SECRET: it lives only in the locked-down
// whatsapp_accounts table (service role) and the browser only ever receives a
// masked hint (••••1234).
//
// Permission model:
//   * admin       — manage ANY rep's account (pass user_id).
//   * sales rep   — manage ONLY their own account (user_id is forced to self).
//
// Actions (POST body { action }):
//   'get'     { user_id? }                         → connection status for a rep
//   'save'    { user_id?, instance_id, api_token?, api_url? } → upsert creds
//             (api_token blank = keep the saved one). Generates a webhook_token.
//   'connect' { user_id? }                          → push our webhook URL into
//             Green API (setSettings) + refresh state. Enables incoming +
//             outgoing notifications. Never enables sending.
//   'check'   { user_id? }                          → refresh getStateInstance
//   'list'    (admin only)                          → all accounts + status
//   'purge'   { user_id? }                          → wipe one account's chat history
//   'purge_all' (admin only)                        → wipe EVERY account's chat history
//   'diagnose' { user_id? }                         → compare our webhook config vs Green's

import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';
import { getStateInstance, getGreenSettings, setWebhookSettings, buildWebhookUrlWithToken } from '../_shared/greenApi.ts';

function maskToken(t: string) {
  return t ? `••••${t.slice(-4)}` : '';
}

function randomToken() {
  // 32 hex chars — used as the Green API webhookUrlToken so we can authenticate
  // inbound webhooks back to a specific instance.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function webhookUrl() {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  return `${base}/functions/v1/greenApiWebhook`;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    let user: { id?: string; role?: string; email?: string } | null = null;
    try { user = await getUser(req); } catch { user = null; }
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    }

    const isAdmin = user.role === 'admin';
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || 'get';
    const svc = createServiceClient();

    // Resolve the target rep. Non-admins can only ever act on themselves.
    const targetUserId: string = isAdmin ? (body.user_id || user.id) : user.id;
    if (!targetUserId) {
      return Response.json({ ok: false, error: 'user_id_required' }, { status: 400, headers: cors });
    }

    const loadAccount = async () => {
      const { data } = await svc.from('whatsapp_accounts').select('*').eq('user_id', targetUserId).maybeSingle();
      return data;
    };

    const statusOf = (acc: any) => ({
      configured: !!(acc?.instance_id && acc?.api_token),
      user_id: targetUserId,
      instance_id: acc?.instance_id || '',
      api_url: acc?.api_url || 'https://api.green-api.com',
      token_set: !!acc?.api_token,
      token_hint: maskToken(acc?.api_token || ''),
      webhook_set: !!acc?.webhook_token,
      state: acc?.state || null,
      phone: acc?.phone || null,
      is_active: acc?.is_active !== false,
      last_webhook_at: acc?.last_webhook_at || null,
      last_state_at: acc?.last_state_at || null,
      updated_date: acc?.updated_date || null,
      updated_by: acc?.updated_by || null,
      webhook_url: webhookUrl(),
    });

    if (action === 'get') {
      return Response.json({ ok: true, ...statusOf(await loadAccount()) }, { headers: cors });
    }

    if (action === 'list') {
      if (!isAdmin) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
      const { data: accounts } = await svc
        .from('whatsapp_accounts')
        .select('id, user_id, instance_id, api_token, state, phone, is_active, last_webhook_at, updated_date')
        .order('updated_date', { ascending: false });
      const rows = (accounts || []).map((a) => ({
        id: a.id,
        user_id: a.user_id,
        instance_id: a.instance_id,
        configured: !!(a.instance_id && a.api_token),
        token_hint: maskToken(a.api_token || ''),
        state: a.state,
        phone: a.phone,
        is_active: a.is_active !== false,
        last_webhook_at: a.last_webhook_at,
        updated_date: a.updated_date,
      }));
      return Response.json({ ok: true, accounts: rows }, { headers: cors });
    }

    if (action === 'save') {
      const instance_id = String(body.instance_id || '').trim();
      const api_url = String(body.api_url || '').trim() || 'https://api.green-api.com';
      const incomingToken = typeof body.api_token === 'string' ? body.api_token.trim() : '';

      if (!instance_id) {
        return Response.json({ ok: false, error: 'instance_id_required' }, { status: 400, headers: cors });
      }

      // Make sure the target rep exists (FK + clearer error).
      const { data: targetUser } = await svc.from('users').select('id').eq('id', targetUserId).maybeSingle();
      if (!targetUser) {
        return Response.json({ ok: false, error: 'user_not_found' }, { status: 404, headers: cors });
      }

      const existing = await loadAccount();
      const nextToken = incomingToken || existing?.api_token || '';
      const webhook_token = existing?.webhook_token || randomToken();

      const row = {
        user_id: targetUserId,
        instance_id,
        api_token: nextToken,
        api_url,
        webhook_token,
        is_active: true,
        updated_by: user.email || null,
        updated_date: new Date().toISOString(),
      };

      const { error } = existing
        ? await svc.from('whatsapp_accounts').update(row).eq('id', existing.id)
        : await svc.from('whatsapp_accounts').insert(row);

      if (error) {
        console.error('[greenApiSettings] save failed', error);
        return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
      }
      return Response.json({ ok: true, ...statusOf(await loadAccount()) }, { headers: cors });
    }

    if (action === 'connect' || action === 'check') {
      const acc = await loadAccount();
      if (!acc?.instance_id || !acc?.api_token) {
        return Response.json({ ok: false, error: 'not_configured' }, { status: 400, headers: cors });
      }

      // Always refresh the live state from Green API.
      const state = await getStateInstance(acc);
      const stateInstance = state.data?.stateInstance || null;

      let settingsResult: any = undefined;
      if (action === 'connect') {
        settingsResult = await setWebhookSettings(acc, webhookUrl());
        if (!settingsResult.ok) {
          console.error('[greenApiSettings] setSettings failed', settingsResult.status, settingsResult.data);
        }
      }

      await svc.from('whatsapp_accounts')
        .update({ state: stateInstance, last_state_at: new Date().toISOString() })
        .eq('id', acc.id);

      return Response.json({
        ok: true,
        state: stateInstance,
        state_ok: state.ok,
        settings_ok: action === 'connect' ? !!settingsResult?.ok : undefined,
        ...statusOf(await loadAccount()),
      }, { headers: cors });
    }

    if (action === 'purge') {
      // Delete ALL recorded chats + messages for this account. Admin-only on
      // purpose: a rep must not be able to wipe their own history to hide poor
      // service — that defeats the whole point of the mirror. The Green API
      // credentials and the account row are kept, so recording continues for
      // new messages going forward.
      if (!isAdmin) {
        return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
      }
      const acc = await loadAccount();
      if (!acc) {
        return Response.json({ ok: false, error: 'not_found' }, { status: 404, headers: cors });
      }
      const { error: mErr } = await svc.from('whatsapp_messages').delete().eq('account_id', acc.id);
      if (mErr) {
        console.error('[greenApiSettings] purge messages failed', mErr);
        return Response.json({ ok: false, error: mErr.message }, { status: 500, headers: cors });
      }
      const { error: cErr } = await svc.from('whatsapp_chats').delete().eq('account_id', acc.id);
      if (cErr) {
        console.error('[greenApiSettings] purge chats failed', cErr);
        return Response.json({ ok: false, error: cErr.message }, { status: 500, headers: cors });
      }
      return Response.json({ ok: true, purged: true }, { headers: cors });
    }

    if (action === 'purge_all') {
      // Same as 'purge', looped over every connected account. Admin-only.
      if (!isAdmin) {
        return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
      }
      const { data: accounts } = await svc.from('whatsapp_accounts').select('id');
      let purgedCount = 0;
      for (const acc of accounts || []) {
        const { error: mErr } = await svc.from('whatsapp_messages').delete().eq('account_id', acc.id);
        if (mErr) {
          console.error('[greenApiSettings] purge_all messages failed', acc.id, mErr);
          continue;
        }
        const { error: cErr } = await svc.from('whatsapp_chats').delete().eq('account_id', acc.id);
        if (cErr) {
          console.error('[greenApiSettings] purge_all chats failed', acc.id, cErr);
          continue;
        }
        purgedCount++;
      }
      return Response.json({ ok: true, purged: true, purged_count: purgedCount }, { headers: cors });
    }

    if (action === 'diagnose') {
      // Show what Green API ACTUALLY has configured, so we can confirm the
      // webhook URL + notification flags match ours (key when nothing arrives).
      const acc = await loadAccount();
      if (!acc?.instance_id || !acc?.api_token) {
        return Response.json({ ok: false, error: 'not_configured' }, { status: 400, headers: cors });
      }
      const state = await getStateInstance(acc);
      const settings = await getGreenSettings(acc);
      const expectedUrl = buildWebhookUrlWithToken(webhookUrl(), acc.webhook_token);
      const greenUrl = settings.data?.webhookUrl || '';

      // Ground truth: how much have we actually recorded for this account?
      const { count: chatsCount } = await svc
        .from('whatsapp_chats').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
      const { count: msgsCount } = await svc
        .from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('account_id', acc.id);
      const { data: lastMsg } = await svc
        .from('whatsapp_messages')
        .select('direction, body, message_type, msg_timestamp, created_date')
        .eq('account_id', acc.id)
        .order('created_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      return Response.json({
        ok: true,
        state: state.data?.stateInstance || null,
        state_ok: state.ok,
        chats_count: chatsCount ?? 0,
        messages_count: msgsCount ?? 0,
        last_message: lastMsg || null,
        green: {
          webhookUrl: greenUrl,
          incomingWebhook: settings.data?.incomingWebhook,
          outgoingWebhook: settings.data?.outgoingWebhook,
          outgoingAPIMessageWebhook: settings.data?.outgoingAPIMessageWebhook,
          outgoingMessageWebhook: settings.data?.outgoingMessageWebhook,
          stateWebhook: settings.data?.stateWebhook,
        },
        expected_webhook_url: expectedUrl,
        webhook_matches: !!greenUrl && greenUrl === expectedUrl,
        settings_ok: settings.ok,
        last_webhook_at: acc.last_webhook_at || null,
      }, { headers: cors });
    }

    return Response.json({ ok: false, error: 'unknown_action' }, { status: 400, headers: cors });
  } catch (error) {
    console.error('[greenApiSettings] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
