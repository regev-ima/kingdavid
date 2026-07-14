// greenApiSend — send a WhatsApp text or file message through a rep's own
// Green API instance, and record it in whatsapp_chats / whatsapp_messages so
// it shows up immediately in the chat screen (the webhook's echo of the same
// message is deduped on green_message_id, per phase 1).
//
// This reverses the phase-1 "read-only, never sends" rule by explicit client
// instruction (see whatsapp-phase2-messaging-plan.md §0). Green API tokens
// still never reach the browser — this function is the only place that calls
// a Green send method, using the service role to read the caller's (or, for
// admins, another rep's) stored credentials.
//
// Permission model:
//   * chat_ref given  → allowed if the caller owns that chat, or is admin
//     (admin sending through a rep's own instance — the UI must show a
//     warning for this case).
//   * no chat_ref     → as_user_id (admin only) or the caller's own account.
//
// POST body: { action: 'text'|'file', chat_ref?, phone?, as_user_id?,
//              message?, file_url?, file_name?, template_id? }
// Response:  { ok: true, idMessage, chat_ref } | { ok: false, error, details? }

import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';
import { getStateInstance, sendTextMessage, sendFileByUrl, normalizeIsraeliPhoneToChatId } from '../_shared/greenApi.ts';

const RATE_LIMIT_PER_MINUTE = 20;

function messageTypeFromFileName(fileName: string | null | undefined): string {
  const ext = (fileName || '').toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a', 'oga'].includes(ext)) return 'audio';
  return 'document'; // pdf and everything else Green treats as a document
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    let user: { id?: string; role?: string; email?: string; full_name?: string } | null = null;
    try { user = await getUser(req); } catch { user = null; }
    if (!user?.id) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    }

    const isAdmin = user.role === 'admin';
    const body = await req.json().catch(() => ({}));
    const action: 'text' | 'file' = body.action === 'file' ? 'file' : 'text';
    const svc = createServiceClient();

    // ── Resolve the sending account (+ existing chat, if any) ─────────────
    let chat: any = null;
    let account: any = null;

    if (body.chat_ref) {
      const { data: chatRow } = await svc.from('whatsapp_chats').select('*').eq('id', body.chat_ref).maybeSingle();
      if (!chatRow) {
        return Response.json({ ok: false, error: 'chat_not_found' }, { status: 404, headers: cors });
      }
      if (!isAdmin && chatRow.user_id !== user.id) {
        return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
      }
      chat = chatRow;
      const { data: accRow } = await svc.from('whatsapp_accounts').select('*').eq('id', chatRow.account_id).maybeSingle();
      account = accRow;
    } else {
      const targetUserId: string = (isAdmin && body.as_user_id) ? body.as_user_id : user.id;
      const { data: accRow } = await svc.from('whatsapp_accounts').select('*').eq('user_id', targetUserId).maybeSingle();
      account = accRow;
    }

    if (!account?.instance_id || !account?.api_token) {
      return Response.json({ ok: false, error: 'not_configured' }, { status: 400, headers: cors });
    }

    // ── Guard: the instance must be authorized to send ─────────────────────
    let state = account.state;
    if (state !== 'authorized') {
      const fresh = await getStateInstance(account);
      state = fresh.data?.stateInstance || state;
      await svc.from('whatsapp_accounts')
        .update({ state, last_state_at: new Date().toISOString() })
        .eq('id', account.id);
    }
    if (state !== 'authorized') {
      return Response.json({ ok: false, error: 'instance_not_authorized' }, { status: 400, headers: cors });
    }

    // ── Soft rate guard: avoid runaway sends from a stuck client/template loop ─
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await svc
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', account.id)
      .eq('sent_via_app', true)
      .gte('created_date', since);
    if ((recentCount ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return Response.json({ ok: false, error: 'rate_limited' }, { status: 429, headers: cors });
    }

    // ── Compute the destination chatId ──────────────────────────────────────
    const chatId: string | null = chat?.chat_id || normalizeIsraeliPhoneToChatId(body.phone);
    if (!chatId) {
      return Response.json({ ok: false, error: 'invalid_destination' }, { status: 400, headers: cors });
    }

    const message: string = typeof body.message === 'string' ? body.message.trim() : '';

    // ── Send through Green API ──────────────────────────────────────────────
    let sendResult;
    if (action === 'file') {
      const fileUrl: string = String(body.file_url || '');
      const fileName: string = String(body.file_name || 'קובץ.pdf');
      if (!fileUrl) {
        return Response.json({ ok: false, error: 'file_url_required' }, { status: 400, headers: cors });
      }
      sendResult = await sendFileByUrl(account, chatId, fileUrl, fileName, message || undefined);
    } else {
      if (!message) {
        return Response.json({ ok: false, error: 'message_required' }, { status: 400, headers: cors });
      }
      sendResult = await sendTextMessage(account, chatId, message);
    }

    if (!sendResult.ok || !sendResult.data?.idMessage) {
      console.error('[greenApiSend] Green send failed', sendResult.status, sendResult.data);
      return Response.json(
        { ok: false, error: 'green_send_failed', details: sendResult.data },
        { status: 502, headers: cors },
      );
    }
    const idMessage = String(sendResult.data.idMessage);

    // ── Upsert the chat row (race-safe, mirrors greenApiWebhook) ───────────
    if (!chat) {
      const { data: existing } = await svc
        .from('whatsapp_chats').select('*')
        .eq('account_id', account.id).eq('chat_id', chatId).maybeSingle();
      chat = existing || null;
    }
    if (!chat) {
      const { data: created, error: chatErr } = await svc
        .from('whatsapp_chats')
        .insert({
          account_id: account.id,
          user_id: account.user_id,
          chat_id: chatId,
          contact_phone: chatId.replace(/@c\.us$/, ''),
          is_group: false,
        })
        .select()
        .single();
      if (chatErr) {
        const { data: raced } = await svc
          .from('whatsapp_chats').select('*')
          .eq('account_id', account.id).eq('chat_id', chatId).maybeSingle();
        chat = raced;
      } else {
        chat = created;
      }
    }
    if (!chat) {
      console.error('[greenApiSend] could not resolve chat row', chatId);
      return Response.json({ ok: false, error: 'chat_resolve_failed' }, { status: 500, headers: cors });
    }

    // ── Record the outgoing message ─────────────────────────────────────────
    const messageType = action === 'file' ? messageTypeFromFileName(body.file_name) : 'text';
    const nowIso = new Date().toISOString();
    const { error: msgErr } = await svc.from('whatsapp_messages').insert({
      chat_ref: chat.id,
      account_id: account.id,
      user_id: account.user_id,
      green_message_id: idMessage,
      chat_id: chatId,
      direction: 'outgoing',
      sender_name: user.full_name || null,
      message_type: messageType,
      body: message || null,
      media_url: action === 'file' ? String(body.file_url) : null,
      file_name: action === 'file' ? String(body.file_name || '') : null,
      msg_timestamp: nowIso,
      sent_via_app: true,
      sent_by: user.email || null,
      template_id: body.template_id || null,
    });
    if (msgErr) {
      // Green already sent it — the outgoingAPIMessageReceived webhook echo
      // will still record it (dedupe key = green_message_id), so don't fail
      // the request; just log loudly for follow-up.
      console.error('[greenApiSend] message insert failed', msgErr);
    }

    // ── Roll the conversation summary forward ───────────────────────────────
    // Guarded on last_message_at so this can't clobber a newer INCOMING
    // message that the webhook races in concurrently (mirrors the webhook's
    // own `isNewest` check, but as an atomic DB-side condition instead of a
    // read-then-write — a customer reply landing between our message insert
    // and this update must not get silently flipped back to "answered").
    const preview = message || (action === 'file' ? `📄 ${body.file_name || 'קובץ'}` : '');
    await svc.from('whatsapp_chats').update({
      last_message_text: preview,
      last_message_at: nowIso,
      last_message_direction: 'outgoing',
      status: 'answered',
      unread_count: 0,
    }).eq('id', chat.id).or(`last_message_at.is.null,last_message_at.lte.${nowIso}`);

    return Response.json({ ok: true, idMessage, chat_ref: chat.id }, { headers: cors });
  } catch (error) {
    console.error('[greenApiSend] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
