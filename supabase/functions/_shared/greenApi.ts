// Shared helpers for talking to Green API (https://green-api.com) and for
// normalising the webhook payloads it POSTs to us.
//
// Green API REST shape:  {apiUrl}/waInstance{idInstance}/{method}/{apiToken}
// e.g. https://api.green-api.com/waInstance1101000001/getStateInstance/abcdef
//
// We deliberately use ONLY read/config methods here (getStateInstance,
// getSettings, setSettings). We never call sendMessage — the product rule is
// that the platform mirrors WhatsApp, it does not send from it.

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

/**
 * Point the instance's webhook at our function and turn on the notification
 * types we need. Crucially we keep this READ-ONLY oriented: we enable incoming
 * + outgoing message notifications and the state-change notification, nothing
 * that sends.
 */
export async function setWebhookSettings(acc: GreenAccount, webhookUrl: string) {
  return callGreenApi(acc, 'setSettings', {
    webhookUrl,
    webhookUrlToken: acc.webhook_token || '',
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

export interface NormalizedMessage {
  kind: 'message';
  idInstance: string;
  idMessage: string | null;
  chatId: string;
  isGroup: boolean;
  direction: 'incoming' | 'outgoing';
  senderName: string;
  senderPhone: string;
  contactName: string;
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
    default:
      return { type, body: '', mediaUrl: null, fileName: null };
  }
}

function phoneFromChatId(chatId: string): string {
  if (!chatId) return '';
  return chatId.replace(/@c\.us$/, '').replace(/@g\.us$/, '');
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
  const { type, body, mediaUrl, fileName } = extractContent(payload.messageData || {});
  const tsSec = Number(payload.timestamp);
  const timestamp = Number.isFinite(tsSec) && tsSec > 0 ? new Date(tsSec * 1000).toISOString() : null;

  return {
    kind: 'message',
    idInstance,
    idMessage: payload.idMessage ? String(payload.idMessage) : null,
    chatId,
    isGroup: /@g\.us$/.test(chatId),
    direction: isIncoming ? 'incoming' : 'outgoing',
    senderName: sd.senderContactName || sd.senderName || sd.chatName || '',
    senderPhone: phoneFromChatId(sd.sender || chatId),
    contactName: sd.senderContactName || sd.chatName || sd.senderName || '',
    messageType: type,
    body,
    mediaUrl,
    fileName,
    timestamp,
  };
}
