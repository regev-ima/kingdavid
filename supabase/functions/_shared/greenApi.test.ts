// Behavioural test for normalizeWebhook() in _shared/greenApi.ts.
//
//   deno run --no-remote supabase/functions/_shared/greenApi.test.ts
//
// WHY this exists: the one thing this function must never do is confuse the
// two identities inside a Green API webhook. senderData describes who WROTE
// the message — on an outgoing webhook that is the rep's own WhatsApp profile.
// The chat id describes who the conversation is WITH. Reading the contact out
// of senderData is a bug that looks completely reasonable in review and shows
// up in production as "every conversation in my list is named after me", with
// the CRM context panel silently resolving the rep's own phone number instead
// of the customer's.
//
// The payload shapes below are Green API's documented ones
// (https://green-api.com/en/docs/api/receiving/notifications-format/), with
// the field that matters kept realistic: on outgoing notifications `sender` is
// the instance's own wid and `senderName` is the instance's own profile name.

import { normalizeWebhook, type NormalizedMessage } from './greenApi.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : `  → ${detail}`}`);
  if (!cond) failures++;
}

const REP_WID = '972505721577@c.us';        // the rep's own number
const REP_NAME = 'מתן ישראל 👑 King David'; // the rep's own WhatsApp profile
const CUSTOMER = '972541112222@c.us';
const GROUP = '120363410077585252@g.us';

function textPayload(over: Record<string, unknown>) {
  return {
    typeWebhook: 'incomingMessageReceived',
    instanceData: { idInstance: 1101, wid: REP_WID, typeInstance: 'whatsapp' },
    timestamp: 1_770_000_000,
    idMessage: 'ABC123',
    messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'שלום' } },
    ...over,
  };
}

const asMsg = (p: unknown) => normalizeWebhook(p) as NormalizedMessage;

// ── 1. Incoming: the sender IS the contact ─────────────────────────────────
console.log('\nIncoming');
{
  const n = asMsg(textPayload({
    senderData: {
      chatId: CUSTOMER, chatName: 'אור מאיה',
      sender: CUSTOMER, senderName: 'אור', senderContactName: 'אור מאיה',
    },
  }));
  check('direction', n.direction === 'incoming', n.direction);
  check('contact name is the customer', n.contactName === 'אור מאיה', n.contactName);
  check('contact phone is the customer', n.contactPhone === '972541112222', n.contactPhone);
  check('sender still recorded', n.senderName === 'אור מאיה' && n.senderPhone === '972541112222');
}

// Unsaved contact: Green sends the number as the "name". That is not a name —
// storing it would freeze raw digits into the chat title.
{
  const n = asMsg(textPayload({
    senderData: {
      chatId: CUSTOMER, chatName: '972541112222',
      sender: CUSTOMER, senderName: '972541112222', senderContactName: '',
    },
  }));
  check('bare number is not a name', n.contactName === '', n.contactName);
  check('phone still resolved', n.contactPhone === '972541112222', n.contactPhone);
}

// ── 2. Outgoing: senderData is US — the regression this test exists for ────
console.log('\nOutgoing (rep replies from their own phone)');
{
  // The exact shape behind the bug: the customer isn't a saved contact, so the
  // only human-readable string in the payload is the rep's own profile name.
  const n = asMsg(textPayload({
    typeWebhook: 'outgoingMessageReceived',
    senderData: {
      chatId: CUSTOMER, chatName: '',
      sender: REP_WID, senderName: REP_NAME, senderContactName: '',
    },
  }));
  check('direction', n.direction === 'outgoing', n.direction);
  check("rep's name never becomes the contact", n.contactName === '', n.contactName);
  check("rep's number never becomes the contact", n.contactPhone === '972541112222', n.contactPhone);
  check('the message still knows who wrote it', n.senderName === REP_NAME && n.senderPhone === '972505721577');
}

// Same, via the API (greenApiSend's echo) — same trap, different webhook type.
{
  const n = asMsg(textPayload({
    typeWebhook: 'outgoingAPIMessageReceived',
    senderData: {
      chatId: CUSTOMER, chatName: REP_NAME,
      sender: REP_WID, senderName: REP_NAME, senderContactName: '',
    },
  }));
  check('chatName echoing our own profile is rejected', n.contactName === '', n.contactName);
  check('contact phone from the chat id', n.contactPhone === '972541112222', n.contactPhone);
}

// When Green DOES name the other side on an outgoing message, take it.
{
  const n = asMsg(textPayload({
    typeWebhook: 'outgoingMessageReceived',
    senderData: {
      chatId: CUSTOMER, chatName: 'אור מאיה',
      sender: REP_WID, senderName: REP_NAME, senderContactName: '',
    },
  }));
  check('real chatName is kept', n.contactName === 'אור מאיה', n.contactName);
}

// ── 3. Groups: the chat is the group, not whoever spoke ────────────────────
console.log('\nGroups');
{
  const n = asMsg(textPayload({
    senderData: {
      chatId: GROUP, chatName: 'צוות מכירות',
      sender: CUSTOMER, senderName: 'אור', senderContactName: 'אור מאיה',
    },
  }));
  check('group flagged', n.isGroup === true);
  check('contact is the group', n.contactName === 'צוות מכירות', n.contactName);
  check('a member never becomes the chat phone', n.contactPhone === '', n.contactPhone);
  check('member still recorded on the message', n.senderPhone === '972541112222', n.senderPhone);
}

// ── 4. Non-message webhooks still normalise ────────────────────────────────
console.log('\nOther webhooks');
{
  const state = normalizeWebhook({
    typeWebhook: 'stateInstanceChanged',
    instanceData: { idInstance: 1101 },
    stateInstance: 'notAuthorized',
  });
  check('state webhook', state?.kind === 'state', String(state?.kind));
  const other = normalizeWebhook({
    typeWebhook: 'outgoingMessageStatus',
    instanceData: { idInstance: 1101 },
  });
  check('delivery status is not a message', other?.kind === 'other', String(other?.kind));
  check('garbage in → null out', normalizeWebhook(null) === null);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures) Deno.exit(1);
