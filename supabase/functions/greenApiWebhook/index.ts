// greenApiWebhook — public endpoint that Green API POSTs WhatsApp notifications
// to. Deployed with --no-verify-jwt (like hyp-notify) so Green API can reach
// it; we authenticate each call by matching the per-instance webhook token.
//
// This endpoint records; the one thing it sends is the disconnect alert (see
// the stateInstanceChanged branch below), which goes out through a DIFFERENT
// rep's instance — never the one the webhook arrived from. It mirrors BOTH
// directions into whatsapp_chats / whatsapp_messages: incoming
// messages, and outgoing ones sent either from the rep's phone or through the
// app via greenApiSend (phase 2). Green API echoes app-sent messages back
// here too (outgoingAPIMessageReceived) — the dedupe on green_message_id
// below means that echo is a no-op, since greenApiSend already inserted the
// row when it sent.
//
// Status rule (drives the colour in the UI):
//   incoming last  → chat.status = 'waiting'  (customer waiting for a reply)
//   outgoing last  → chat.status = 'answered' (we replied — "got service", green)

import { createServiceClient } from '../_shared/supabase.ts';
import { normalizeWebhook } from '../_shared/greenApi.ts';
import { handleAccountState } from '../_shared/whatsappAlerts.ts';

// Collect every token the caller supplied — Green carries it as ?token= (our
// setup), but a stale config or the Supabase gateway may also put one in the
// Authorization header. We accept a match from EITHER, so reconfigurations and
// gateway quirks don't silently 401 every webhook.
function providedTokens(req: Request): string[] {
  const out: string[] = [];
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) out.push(m[1].trim());
  try {
    const q = new URL(req.url).searchParams.get('token');
    if (q) out.push(q.trim());
  } catch { /* ignore */ }
  return out;
}

Deno.serve(async (req) => {
  // Green API only POSTs; answer everything else with a plain OK so health
  // checks / browser hits don't look like errors.
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200 });
  }

  try {
    const payload = await req.json().catch(() => null);
    const norm = normalizeWebhook(payload);
    if (!norm || !norm.idInstance) {
      return Response.json({ ok: true, ignored: 'unrecognized' }, { status: 200 });
    }

    const svc = createServiceClient();
    const { data: account } = await svc
      .from('whatsapp_accounts')
      .select('*')
      .eq('instance_id', norm.idInstance)
      .maybeSingle();

    // Unknown instance — ack with 200 so Green API stops retrying, but log it.
    if (!account) {
      console.warn('[greenApiWebhook] no account for instance', norm.idInstance);
      return Response.json({ ok: true, ignored: 'unknown_instance' }, { status: 200 });
    }

    // Record that Green API reached us BEFORE the auth check, so the
    // "last received" timestamp is a reliable "is Green delivering?" signal
    // even when the token is wrong. The instance id isn't secret, so a bumped
    // timestamp leaks nothing. Also capture the connected number (wid) — Green
    // only sends it inside webhook payloads, not via getStateInstance.
    const wid: string = payload?.instanceData?.wid || '';
    const widPhone = wid ? wid.replace(/@c\.us$/, '') : '';
    const accUpdate: Record<string, unknown> = { last_webhook_at: new Date().toISOString() };
    if (widPhone && account.phone !== widPhone) accUpdate.phone = widPhone;
    await svc.from('whatsapp_accounts').update(accUpdate).eq('id', account.id);
    // Keep the in-memory row in step — the disconnect alert quotes the number.
    Object.assign(account, accUpdate);

    // Authenticate: the token must match what we configured (carried as
    // ?token= in the webhook URL, with an Authorization: Bearer fallback).
    if (account.webhook_token) {
      if (!providedTokens(req).includes(account.webhook_token)) {
        console.warn('[greenApiWebhook] token mismatch for instance', norm.idInstance);
        return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
    }

    if (norm.kind === 'state') {
      await svc.from('whatsapp_accounts')
        .update({ state: norm.stateInstance, last_state_at: new Date().toISOString() })
        .eq('id', account.id);

      // THE live path for the disconnect alert. Green API pushes
      // stateInstanceChanged the moment the rep's phone unlinks, so the team
      // group hears about it in seconds — no polling involved. `account` still
      // holds the pre-change bookkeeping, which is what decides whether this
      // outage has already been announced. A failure here must not 500 the
      // webhook: the state above is already recorded, and the scheduled sweep
      // will pick the alert up.
      let alert = 'noop';
      try {
        const res = await handleAccountState(svc, account, norm.stateInstance, 'webhook');
        alert = res.action;
      } catch (e) {
        console.error('[greenApiWebhook] disconnect alert failed', e);
        alert = 'error';
      }
      return Response.json({ ok: true, handled: 'state', alert }, { status: 200 });
    }

    if (norm.kind !== 'message' || !norm.chatId) {
      return Response.json({ ok: true, ignored: norm.kind }, { status: 200 });
    }

    // ── Upsert the conversation row ──────────────────────────────────────────
    let { data: chat } = await svc
      .from('whatsapp_chats')
      .select('*')
      .eq('account_id', account.id)
      .eq('chat_id', norm.chatId)
      .maybeSingle();

    if (!chat) {
      const { data: created, error: chatErr } = await svc
        .from('whatsapp_chats')
        .insert({
          account_id: account.id,
          user_id: account.user_id,
          chat_id: norm.chatId,
          // The CONTACT, never the sender: on an outgoing webhook senderData
          // is the rep's own profile, and seeding the row from it is what put
          // the rep's own name and number on every conversation in the list.
          contact_name: norm.contactName || null,
          contact_phone: norm.contactPhone || null,
          is_group: norm.isGroup,
        })
        .select()
        .single();
      if (chatErr) {
        // Lost a race with a concurrent webhook — re-read the row.
        ({ data: chat } = await svc
          .from('whatsapp_chats')
          .select('*')
          .eq('account_id', account.id)
          .eq('chat_id', norm.chatId)
          .maybeSingle());
      } else {
        chat = created;
      }
    }
    if (!chat) {
      console.error('[greenApiWebhook] could not resolve chat row', norm.chatId);
      return Response.json({ ok: false, error: 'chat_resolve_failed' }, { status: 500 });
    }

    // ── Insert the message (dedupe on green_message_id) ──────────────────────
    if (norm.idMessage) {
      const { data: dupe } = await svc
        .from('whatsapp_messages')
        .select('id')
        .eq('account_id', account.id)
        .eq('green_message_id', norm.idMessage)
        .maybeSingle();
      if (dupe) {
        return Response.json({ ok: true, deduped: true }, { status: 200 });
      }
    }

    const msgTs = norm.timestamp || new Date().toISOString();
    const { error: msgErr } = await svc.from('whatsapp_messages').insert({
      chat_ref: chat.id,
      account_id: account.id,
      user_id: account.user_id,
      green_message_id: norm.idMessage,
      chat_id: norm.chatId,
      direction: norm.direction,
      sender_name: norm.senderName || null,
      sender_phone: norm.senderPhone || null,
      message_type: norm.messageType,
      body: norm.body || null,
      media_url: norm.mediaUrl,
      file_name: norm.fileName,
      msg_timestamp: msgTs,
      raw: payload,
    });
    if (msgErr) {
      console.error('[greenApiWebhook] message insert failed', msgErr);
      return Response.json({ ok: false, error: 'message_insert_failed' }, { status: 500 });
    }

    // ── Roll the conversation summary forward (only if this is the newest) ───
    const prevTs = chat.last_message_at ? new Date(chat.last_message_at).getTime() : 0;
    const thisTs = new Date(msgTs).getTime();
    const isNewest = thisTs >= prevTs;

    const preview = norm.body
      || ({ image: '📷 תמונה', video: '🎬 וידאו', audio: '🎤 הודעה קולית', document: '📄 קובץ',
            sticker: 'מדבקה', location: '📍 מיקום', contact: '👤 איש קשר', poll: '📊 סקר' }[norm.messageType] || '');

    const chatUpdate: Record<string, unknown> = {};
    if (isNewest) {
      chatUpdate.last_message_text = preview;
      chatUpdate.last_message_at = msgTs;
      chatUpdate.last_message_direction = norm.direction;
      // Incoming → customer is waiting; outgoing → we answered (green).
      chatUpdate.status = norm.direction === 'incoming' ? 'waiting' : 'answered';
    }
    if (norm.direction === 'incoming') {
      chatUpdate.unread_count = (chat.unread_count || 0) + 1;
    } else if (isNewest) {
      // We replied — clear the waiting backlog.
      chatUpdate.unread_count = 0;
    }

    // ── Keep the contact identity pointing at the customer ───────────────────
    // Rows created before the sender/contact split carry the REP's name and
    // number, because whichever webhook created them seeded from senderData.
    // Repair them here so a chat fixes itself the next time it sees traffic —
    // the migration handles the quiet ones that may never get another message.
    if (norm.isGroup) {
      // A group has no single contact number — the chat id IS the group, and a
      // rep's number left here shows up under the group's name in the header.
      if (chat.contact_phone) chatUpdate.contact_phone = null;
    } else if (norm.contactPhone && chat.contact_phone !== norm.contactPhone) {
      chatUpdate.contact_phone = norm.contactPhone;
    }
    // An outgoing webhook is the one place Green tells us our OWN profile
    // name. If that string is sitting in contact_name, it came from the wrong
    // side of the conversation.
    const nameIsOurs = norm.direction === 'outgoing'
      && !!norm.senderName && chat.contact_name === norm.senderName;
    if (norm.contactName && (!chat.contact_name || nameIsOurs)) {
      chatUpdate.contact_name = norm.contactName;
    } else if (nameIsOurs) {
      chatUpdate.contact_name = null;
    }

    if (Object.keys(chatUpdate).length > 0) {
      await svc.from('whatsapp_chats').update(chatUpdate).eq('id', chat.id);
    }

    return Response.json({ ok: true, handled: 'message', direction: norm.direction }, { status: 200 });
  } catch (error) {
    console.error('[greenApiWebhook] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
});
