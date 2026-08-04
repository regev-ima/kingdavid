// Shared helpers for talking to Green API (https://green-api.com) and for
// normalising the webhook payloads it POSTs to us.
//
// Green API REST shape:  {apiUrl}/waInstance{idInstance}/{method}/{apiToken}
// e.g. https://api.green-api.com/waInstance1101000001/getStateInstance/abcdef
//
// Read/config methods (getStateInstance, getSettings, setSettings) are used
// by greenApiSettings to connect + monitor a rep's instance. sendMessage /
// sendFileByUrl (phase 2) are used ONLY by greenApiSend, which sends through
// the caller's own (or, for an admin, an explicitly chosen rep's) instance —
// never with credentials the browser can see.

export interface GreenAccount {
  instance_id: string;
  api_token: string;
  api_url?: string;
  webhook_token?: string;
}

const DEFAULT_API_URL = 'https://api.green-api.com';

function apiBase(acc: GreenAccount): string {
  const host = (acc.api_url || DEFAULT_API_URL).replace(/\/+$/, '');
  return `${host}/waInstance${acc.instance_id}`;
}

/** Call a Green API method. GET when no body, POST (JSON) otherwise. */
export async function callGreenApi(
  acc: GreenAccount,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `${apiBase(acc)}/${method}/${acc.api_token}`;
  const init: RequestInit = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export async function getStateInstance(acc: GreenAccount) {
  return callGreenApi(acc, 'getStateInstance');
}

/** Send a plain text message to a chat (…@c.us / …@g.us). */
export async function sendTextMessage(acc: GreenAccount, chatId: string, message: string) {
  return callGreenApi(acc, 'sendMessage', { chatId, message });
}

/** Send a file by public URL, with an optional caption, to a chat. */
export async function sendFileByUrl(
  acc: GreenAccount,
  chatId: string,
  urlFile: string,
  fileName: string,
  caption?: string,
) {
  const body: Record<string, unknown> = { chatId, urlFile, fileName };
  if (caption) body.caption = caption;
  return callGreenApi(acc, 'sendFileByUrl', body);
}

/**
 * Israeli phone → Green API chatId ("9725XXXXXXXX@c.us"), or null when the
 * number is too short to be real. Kept as a named re-export so existing
 * callers don't change; the logic itself lives in _shared/phone.ts, which is
 * the one place this rule is written for Edge Functions.
 */
export { toWhatsAppChatId as normalizeIsraeliPhoneToChatId } from './phone.ts';

/** Read the instance's current settings (webhookUrl, notification flags, …). */
export async function getGreenSettings(acc: GreenAccount) {
  return callGreenApi(acc, 'getSettings');
}

/** Append the auth token to the webhook URL as a query param. */
export function buildWebhookUrlWithToken(webhookUrl: string, token?: string) {
  if (!token) return webhookUrl;
  return `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/**
 * Point the instance's webhook at our function and turn on the notification
 * types we need. Crucially we keep this READ-ONLY oriented: we enable incoming
 * + outgoing message notifications and the state-change notification, nothing
 * that sends.
 *
 * We carry the auth token in the URL query string (?token=…) and leave
 * webhookUrlToken EMPTY on purpose: when webhookUrlToken is set, Green API adds
 * an `Authorization: Bearer …` header, which the Supabase Edge gateway can
 * reject before the request reaches our function. A query-string token avoids
 * that entirely; the webhook function authenticates on ?token=.
 */
export async function setWebhookSettings(acc: GreenAccount, webhookUrl: string) {
  return callGreenApi(acc, 'setSettings', {
    webhookUrl: buildWebhookUrlWithToken(webhookUrl, acc.webhook_token),
    webhookUrlToken: '',
    incomingWebhook: 'yes',
    outgoingWebhook: 'yes',           // messages sent from the phone
    outgoingAPIMessageWebhook: 'yes', // messages sent via API
    outgoingMessageWebhook: 'yes',
    stateWebhook: 'yes',
    pollMessageWebhook: 'yes',
    markIncomingMessagesReaded: 'no', // we only observe — don't mark as read
  });
}

// ── Webhook normalisation ───────────────────────────────────────────────────

/**
 * Two identities live in every webhook and they are NOT the same one:
 *
 *   sender*  — who wrote THIS message. On an outgoing webhook that is the rep
 *              themselves; Green fills senderData with the instance owner.
 *   contact* — who the conversation is WITH. Always the other side, whichever
 *              direction the message went.
 *
 * Collapsing the two is what made every conversation in the list show the
 * rep's own WhatsApp name and phone number instead of the customer's: a chat
 * row first seen through an outgoing message (the rep answering from their
 * phone) was seeded from senderData, i.e. from the rep.
 */
export interface NormalizedMessage {
  kind: 'message';
  idInstance: string;
  idMessage: string | null;
  chatId: string;
  isGroup: boolean;
  direction: 'incoming' | 'outgoing';
  /** Author of this message — the rep on an outgoing one. Message-level only. */
  senderName: string;
  senderPhone: string;
  /** The other side of the conversation. '' when Green doesn't name them. */
  contactName: string;
  /** The other side's number, from the chat id. '' for groups. */
  contactPhone: string;
  /**
   * OUR OWN WhatsApp profile name, when this webhook reveals it. Only an
   * outgoing message does: there senderData describes the instance owner. We
   * persist it on the account so that every later webhook — incoming ones
   * included — can recognise and reject it as a contact name.
   */
  ownName: string;
  messageType: string;
  body: string;
  mediaUrl: string | null;
  fileName: string | null;
  timestamp: string | null; // ISO
}

export interface NormalizedState {
  kind: 'state';
  idInstance: string;
  stateInstance: string;
}

export interface NormalizedOther {
  kind: 'other';
  idInstance: string;
  typeWebhook: string;
}

export type NormalizedWebhook = NormalizedMessage | NormalizedState | NormalizedOther;

const INCOMING_TYPES = new Set(['incomingMessageReceived']);
// Messages sent from the phone vs. via the API. (outgoingMessageStatus is a
// delivery-status update, not a message, and is handled as 'other'.)
const OUTGOING_TYPES = new Set([
  'outgoingMessageReceived',
  'outgoingAPIMessageReceived',
]);

// Pull the human-readable text + media out of the many messageData shapes.
function extractContent(md: any): { type: string; body: string; mediaUrl: string | null; fileName: string | null } {
  const type = md?.typeMessage || 'unknown';
  const file = md?.fileMessageData || {};
  switch (type) {
    case 'textMessage':
      return { type: 'text', body: md?.textMessageData?.textMessage || '', mediaUrl: null, fileName: null };
    case 'extendedTextMessage':
      return { type: 'text', body: md?.extendedTextMessageData?.text || '', mediaUrl: null, fileName: null };
    case 'quotedMessage':
      return { type: 'text', body: md?.extendedTextMessageData?.text || md?.textMessageData?.textMessage || '', mediaUrl: null, fileName: null };
    case 'imageMessage':
      return { type: 'image', body: file.caption || '', mediaUrl: file.downloadUrl || null, fileName: file.fileName || null };
    case 'videoMessage':
      return { type: 'video', body: file.caption || '', mediaUrl: file.downloadUrl || null, fileName: file.fileName || null };
    case 'audioMessage':
      return { type: 'audio', body: file.caption || '', mediaUrl: file.downloadUrl || null, fileName: file.fileName || null };
    case 'documentMessage':
      return { type: 'document', body: file.caption || file.fileName || '', mediaUrl: file.downloadUrl || null, fileName: file.fileName || null };
    case 'stickerMessage':
      return { type: 'sticker', body: '', mediaUrl: file.downloadUrl || null, fileName: null };
    case 'locationMessage': {
      const loc = md?.locationMessageData || {};
      const label = [loc.nameLocation, loc.address].filter(Boolean).join(' · ');
      return { type: 'location', body: label || `${loc.latitude ?? ''}, ${loc.longitude ?? ''}`, mediaUrl: null, fileName: null };
    }
    case 'contactMessage':
      return { type: 'contact', body: md?.contactMessageData?.displayName || 'איש קשר', mediaUrl: null, fileName: null };
    case 'pollMessage':
      return { type: 'poll', body: md?.pollMessageData?.name || 'סקר', mediaUrl: null, fileName: null };
    case 'reactionMessage': {
      // A 👍 on one of our messages. Green puts the emoji in
      // extendedTextMessageData.text; older builds use reactionMessageData.
      // An EMPTY text is not a missing reaction — it is the customer removing
      // one, so keep it distinguishable instead of collapsing both to ''.
      const rd = md?.reactionMessageData || md?.extendedTextMessageData || {};
      return { type: 'reaction', body: (rd.text ?? '').trim(), mediaUrl: null, fileName: null };
    }
    case 'editedMessage':
      return {
        type: 'text',
        body: md?.editedMessageData?.textMessage || md?.editedMessageData?.text || '',
        mediaUrl: null,
        fileName: null,
      };
    case 'deletedMessage':
      return { type: 'deleted', body: '', mediaUrl: null, fileName: null };
    default:
      return { type, body: '', mediaUrl: null, fileName: null };
  }
}

function phoneFromChatId(chatId: string): string {
  if (!chatId) return '';
  return chatId.replace(/@c\.us$/, '').replace(/@g\.us$/, '');
}

// Green happily reports a bare number as a "name" when the contact isn't saved
// in the phone book. Storing that as contact_name freezes raw digits into the
// chat title and beats the UI's own phone formatting, so treat it as no name
// and let the phone fallback do its job.
const PHONE_LIKE = /^\+?[\d][\d\s()\-.]*$/;

function contactLabel(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || PHONE_LIKE.test(name)) return '';
  return name;
}

export function normalizeWebhook(payload: any): NormalizedWebhook | null {
  if (!payload || typeof payload !== 'object') return null;
  const typeWebhook: string = payload.typeWebhook || '';
  const idInstance = String(payload?.instanceData?.idInstance ?? '');

  if (typeWebhook === 'stateInstanceChanged') {
    return { kind: 'state', idInstance, stateInstance: payload.stateInstance || '' };
  }

  const isIncoming = INCOMING_TYPES.has(typeWebhook);
  const isOutgoing = OUTGOING_TYPES.has(typeWebhook);
  if (!isIncoming && !isOutgoing) {
    return { kind: 'other', idInstance, typeWebhook };
  }

  const sd = payload.senderData || {};
  const chatId: string = sd.chatId || '';
  const isGroup = /@g\.us$/.test(chatId);
  const { type, body, mediaUrl, fileName } = extractContent(payload.messageData || {});
  const tsSec = Number(payload.timestamp);
  const timestamp = Number.isFinite(tsSec) && tsSec > 0 ? new Date(tsSec * 1000).toISOString() : null;

  // Who wrote this message. Fine to take from senderData — that is exactly
  // what senderData describes.
  const senderName = sd.senderContactName || sd.senderName || sd.chatName || '';

  // Who the conversation is with. Deliberately NOT senderData on an outgoing
  // message, where every sender-* field is the rep's own WhatsApp profile.
  let contactName: string;
  if (isGroup) {
    // The conversation IS the group. senderContactName is whichever member
    // happened to speak, which never identifies the chat.
    contactName = contactLabel(sd.chatName);
  } else if (isIncoming) {
    contactName = contactLabel(sd.senderContactName) || contactLabel(sd.chatName)
      || contactLabel(sd.senderName);
  } else {
    // chatName is the only field naming the other side here — and when it
    // merely echoes our own profile name, it isn't naming them either.
    const ours = [contactLabel(sd.senderName), contactLabel(sd.senderContactName)].filter(Boolean);
    const named = contactLabel(sd.chatName);
    contactName = ours.includes(named) ? '' : named;
  }

  return {
    kind: 'message',
    idInstance,
    idMessage: payload.idMessage ? String(payload.idMessage) : null,
    chatId,
    isGroup,
    direction: isIncoming ? 'incoming' : 'outgoing',
    senderName,
    // sd.sender is the rep on an outgoing message and an individual member
    // inside a group, so it can only ever be the message's author.
    senderPhone: phoneFromChatId(sd.sender || chatId),
    contactName,
    contactPhone: isGroup ? '' : phoneFromChatId(chatId),
    ownName: isIncoming ? '' : (contactLabel(sd.senderName) || contactLabel(sd.senderContactName)),
    messageType: type,
    body,
    mediaUrl,
    fileName,
    timestamp,
  };
}
