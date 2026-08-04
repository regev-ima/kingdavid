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
//   'qr'      { user_id? }                           → Green API authorization QR
//             (base64 PNG) so the phone can be linked from inside the CRM
//   'list'    (admin only)                          → all accounts + status
//   'purge'   { user_id? }                          → wipe one account's chat history
//   'purge_all' (admin only)                        → wipe EVERY account's chat history
//   'disconnect' { user_id? } (admin only)          → detach the Green API instance
//              (clear creds, stop webhooks) but KEEP the recorded chat history
//   'diagnose' { user_id? }                         → compare our webhook config vs Green's
//
// Disconnect alerts (admin only) — the "tell the group when a rep's WhatsApp
// drops" feature. Config lives in whatsapp_alert_settings; the alert itself is
// raised by greenApiWebhook (live) and greenApiStateMonitor (sweep):
//   'alerts_get'                                    → config + per-rep state + recent log
//   'alerts_save'  { enabled, notifier_user_id, group_chat_id, cooldown_minutes,
//                    notify_on_recovery }           → update the config
//   'alerts_test'                                   → send a test message to the group
//   'alerts_mute'  { user_id, muted }               → silence one rep's alerts
//   'alerts_sweep'                                  → run the state sweep now

import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';
import { getStateInstance, getGreenSettings, setWebhookSettings, buildWebhookUrlWithToken, callGreenApi } from '../_shared/greenApi.ts';
import {
  handleAccountState, loadAlertSettings, sweepAccounts, sendTestAlert,
  describeGroup, normalizeChatId, stateLabelHe,
} from '../_shared/whatsappAlerts.ts';

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

      // Someone opened the connection screen — a third chance (after the live
      // webhook and the scheduled sweep) to notice this rep has dropped, or to
      // close out an outage that just ended. Never fatal to the request.
      try {
        await handleAccountState(svc, acc, stateInstance, 'check');
      } catch (e) {
        console.error('[greenApiSettings] disconnect alert failed', e);
      }

      return Response.json({
        ok: true,
        state: stateInstance,
        state_ok: state.ok,
        settings_ok: action === 'connect' ? !!settingsResult?.ok : undefined,
        ...statusOf(await loadAccount()),
      }, { headers: cors });
    }

    if (action === 'qr') {
      // Return the Green API authorization QR so the rep can link their phone
      // from INSIDE the CRM — no need to open the Green API console. The
      // api_token stays server-side; the browser only receives the QR image
      // (base64 PNG). Green's `qr` returns { type, message }:
      //   type 'qrCode'      → message is a base64 PNG to scan
      //   type 'alreadyLogged' → instance is already authorized
      //   type 'error'       → message explains why (e.g. still starting)
      const acc = await loadAccount();
      if (!acc?.instance_id || !acc?.api_token) {
        return Response.json({ ok: false, error: 'not_configured' }, { status: 400, headers: cors });
      }
      const qr = await callGreenApi(acc, 'qr');
      // Refresh + persist the live state so the UI can tell when linking is done.
      const state = await getStateInstance(acc);
      const stateInstance = state.data?.stateInstance || null;
      await svc.from('whatsapp_accounts')
        .update({ state: stateInstance, last_state_at: new Date().toISOString() })
        .eq('id', acc.id);
      // The QR dialog polls until the phone links, so this is where a recovery
      // is seen first — the group gets the "back online" message the second the
      // rep finishes scanning, rather than on the next sweep.
      try {
        await handleAccountState(svc, acc, stateInstance, 'check');
      } catch (e) {
        console.error('[greenApiSettings] disconnect alert failed', e);
      }
      const type = qr.data?.type || (qr.ok ? 'unknown' : 'error');
      return Response.json({
        ok: true,
        type,                                     // 'qrCode' | 'alreadyLogged' | 'error' | …
        message: qr.data?.message || '',          // base64 PNG when type === 'qrCode'
        state: stateInstance,                     // 'authorized' once the phone links
        authorized: stateInstance === 'authorized' || type === 'alreadyLogged',
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

    if (action === 'disconnect') {
      // Detach the Green API instance from this rep WITHOUT touching the
      // recorded history. Admin-only, same reasoning as purge (a rep must not
      // be able to unilaterally stop being mirrored). We keep the account row
      // (so its chats/messages, which FK to it, stay intact) and only clear the
      // credentials + deactivate it — after this the composer locks, sending is
      // disabled, and inbound webhooks for this instance no longer match.
      if (!isAdmin) {
        return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
      }
      const acc = await loadAccount();
      if (!acc) {
        return Response.json({ ok: false, error: 'not_found' }, { status: 404, headers: cors });
      }

      // Best-effort: ask Green API to stop delivering webhooks to us. Ignore
      // failures (the instance may already be gone / creds revoked) — clearing
      // instance_id below already makes any further webhook a no-op on our side.
      if (acc.instance_id && acc.api_token) {
        try {
          await callGreenApi(acc, 'setSettings', {
            webhookUrl: '',
            incomingWebhook: 'no',
            outgoingWebhook: 'no',
            outgoingAPIMessageWebhook: 'no',
            outgoingMessageWebhook: 'no',
            stateWebhook: 'no',
          });
        } catch (e) {
          console.warn('[greenApiSettings] disconnect setSettings failed (ignored)', e);
        }
      }

      const { error } = await svc.from('whatsapp_accounts').update({
        instance_id: '',
        api_token: '',
        webhook_token: '',
        state: null,
        phone: null,
        is_active: false,
        updated_by: user.email || null,
        updated_date: new Date().toISOString(),
      }).eq('id', acc.id);
      if (error) {
        console.error('[greenApiSettings] disconnect failed', error);
        return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
      }
      return Response.json({ ok: true, disconnected: true, ...statusOf(await loadAccount()) }, { headers: cors });
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

    // ── Disconnect alerts ───────────────────────────────────────────────────
    // Everything below is admin-only: it configures a message that goes out to
    // a WhatsApp group on the whole team's behalf, and it reads monitor_token.
    if (action.startsWith('alerts_')) {
      if (!isAdmin) {
        return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
      }

      if (action === 'alerts_get') {
        const settings = await loadAlertSettings(svc);

        // Every rep with a Green API account, plus their live-ish state, so the
        // screen can show who would be alerted about and who can do the
        // alerting. Two queries + a join in JS rather than a PostgREST embed —
        // the FK name isn't something this function should depend on.
        // api_token is read only to derive `configured` and is never returned,
        // same as the 'list' action above.
        const { data: accounts } = await svc
          .from('whatsapp_accounts')
          .select('id, user_id, instance_id, api_token, state, phone, is_active, alerts_muted, was_authorized, disconnected_since, alerted_since, alert_sent_at, alert_state, alert_error, last_state_at')
          .order('updated_date', { ascending: false });
        const { data: users } = await svc
          .from('users')
          .select('id, full_name, email, role, is_active');

        const nameOf = new Map((users || []).map((u: any) => [u.id, u.full_name || u.email]));
        const reps = (accounts || []).map((a: any) => ({
          user_id: a.user_id,
          name: nameOf.get(a.user_id) || 'לא ידוע',
          configured: !!(a.instance_id && a.api_token),
          state: a.state,
          state_label: stateLabelHe(a.state),
          connected: a.state === 'authorized',
          phone: a.phone,
          is_active: a.is_active !== false,
          was_authorized: !!a.was_authorized,
          alerts_muted: !!a.alerts_muted,
          disconnected_since: a.disconnected_since,
          alerted: !!a.alerted_since,
          alert_sent_at: a.alert_sent_at,
          alert_error: a.alert_error,
          last_state_at: a.last_state_at,
        }));

        const { data: log } = await svc
          .from('whatsapp_alert_log')
          .select('id, rep_name, kind, state, source, chat_id, ok, error, created_date')
          .order('created_date', { ascending: false })
          .limit(20);

        // Only ever a hint of monitor_token — it authenticates the sweep.
        const tok = settings?.monitor_token || '';
        return Response.json({
          ok: true,
          settings: settings ? {
            enabled: settings.enabled,
            notifier_user_id: settings.notifier_user_id,
            group_chat_id: settings.group_chat_id,
            cooldown_minutes: settings.cooldown_minutes,
            notify_on_recovery: settings.notify_on_recovery,
            monitor_token_hint: tok ? `••••${tok.slice(-4)}` : '',
          } : null,
          reps,
          log: log || [],
        }, { headers: cors });
      }

      if (action === 'alerts_save') {
        const patch: Record<string, unknown> = {
          updated_by: user.email || null,
          updated_date: new Date().toISOString(),
        };
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (typeof body.notify_on_recovery === 'boolean') patch.notify_on_recovery = body.notify_on_recovery;
        if ('notifier_user_id' in body) patch.notifier_user_id = body.notifier_user_id || null;
        if ('group_chat_id' in body) {
          const chatId = normalizeChatId(body.group_chat_id);
          if (!chatId) {
            return Response.json({ ok: false, error: 'group_chat_id_invalid' }, { status: 400, headers: cors });
          }
          patch.group_chat_id = chatId;
        }
        if ('cooldown_minutes' in body) {
          const n = Number(body.cooldown_minutes);
          if (!Number.isFinite(n) || n < 0) {
            return Response.json({ ok: false, error: 'cooldown_invalid' }, { status: 400, headers: cors });
          }
          patch.cooldown_minutes = Math.round(n);
        }

        // The notifier sends through their own instance, so an unconfigured
        // one would make every alert fail silently. Refuse it up front.
        if (patch.notifier_user_id) {
          const { data: acc } = await svc
            .from('whatsapp_accounts').select('instance_id, api_token')
            .eq('user_id', patch.notifier_user_id).maybeSingle();
          if (!acc?.instance_id || !acc?.api_token) {
            return Response.json({ ok: false, error: 'notifier_not_configured' }, { status: 400, headers: cors });
          }
        }

        const { error } = await svc.from('whatsapp_alert_settings').update(patch).eq('id', 1);
        if (error) {
          console.error('[greenApiSettings] alerts_save failed', error);
          return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
        }

        // Report back whether the group is real and reachable from the
        // notifier's instance — a wrong id is otherwise invisible until the
        // first real outage goes unannounced.
        const saved = await loadAlertSettings(svc);
        const group = saved ? await describeGroup(svc, saved) : null;
        return Response.json({ ok: true, saved: true, group }, { headers: cors });
      }

      if (action === 'alerts_test') {
        const res = await sendTestAlert(svc, user.email);
        return Response.json(
          { ok: !!res.ok, error: res.ok ? undefined : res.error, chat_id: res.chatId },
          { headers: cors },
        );
      }

      if (action === 'alerts_mute') {
        const target = String(body.user_id || '').trim();
        if (!target) {
          return Response.json({ ok: false, error: 'user_id_required' }, { status: 400, headers: cors });
        }
        const { error } = await svc.from('whatsapp_accounts')
          .update({ alerts_muted: !!body.muted })
          .eq('user_id', target);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
        }
        return Response.json({ ok: true, muted: !!body.muted }, { headers: cors });
      }

      if (action === 'alerts_sweep') {
        const summary = await sweepAccounts(svc, 'ui');
        return Response.json({ ok: true, ...summary }, { headers: cors });
      }
    }

    return Response.json({ ok: false, error: 'unknown_action' }, { status: 400, headers: cors });
  } catch (error) {
    console.error('[greenApiSettings] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
