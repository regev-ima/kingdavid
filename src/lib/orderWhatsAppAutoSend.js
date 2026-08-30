// Sending a new order to the customer on WhatsApp, by itself.
//
// The rep used to press "שלח בוואטסאפ" on the order screen, confirm a dialog,
// and wait. Every order goes to the customer anyway, so the confirmation was a
// step that only ever had one answer. Creating the order now sends it.
//
// Two things this deliberately is NOT:
//
//   • Not silent. The send happens after the order is safely saved, and it
//     reports itself with a toast either way. A rep who believes the customer
//     got the order when Green API was disconnected is worse off than one who
//     was never promised anything, so a failure says so and points at the
//     manual button.
//   • Not unstoppable. `order_whatsapp_autosend` in app_settings turns it off
//     for the whole company without a deploy — it messages real customers, and
//     that needs a switch someone can reach.
//
// Only orders money has changed hands on go out by themselves — paid in full
// or a deposit. An order written with nothing collected yet is not a document
// the customer is waiting for.
//
// A card order is unpaid at the moment it is created — Hyp clears afterwards —
// so it isn't sent then. It is sent when the charge goes through: the same
// send runs from the Hyp dialog's onPaid, which fires only after hyp-verify
// confirmed the transaction with Hyp and recorded it. Paying by card is still
// paying, and the customer should not be the one waiting for a rep to notice.
//
// The message is a template from the 'orders' category, so the wording is the
// company's and identical for every rep, with {{נציג}} resolving to whoever
// the message is sent FROM.

import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { resolveTemplate } from '@/components/whatsapp/whatsappHelpers';
import { phoneTail } from '@/components/whatsapp/useWhatsAppContext';

export const ORDER_AUTOSEND_SETTING_KEY = 'order_whatsapp_autosend';
export const ORDER_AUTOSEND_QUERY_KEY = ['app-settings', ORDER_AUTOSEND_SETTING_KEY];

// Off unless the row says otherwise: a company that never opened the setting
// should not discover it by way of a message its customers received.
export const ORDER_AUTOSEND_DEFAULT = false;

function findRow() {
  return base44.entities.AppSettings.filter({ key: ORDER_AUTOSEND_SETTING_KEY }, null, 1);
}

// `value` is jsonb; a hand-written row may hold a JSON string. Accept both.
function parseEnabled(value) {
  if (value == null) return null;
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (typeof parsed === 'boolean') return parsed;
  if (parsed && typeof parsed === 'object' && typeof parsed.enabled === 'boolean') return parsed.enabled;
  return null;
}

/**
 * Is auto-send on? Never throws — the table may not be migrated yet, and a
 * read failure must not stop an order from being created.
 * @returns {Promise<boolean>}
 */
export async function fetchOrderAutoSendSetting() {
  try {
    const rows = await findRow();
    const enabled = parseEnabled(rows?.[0]?.value);
    return enabled == null ? ORDER_AUTOSEND_DEFAULT : enabled;
  } catch (err) {
    console.warn('[orderAutoSend] app_settings unavailable — treating as off', err?.message);
    return ORDER_AUTOSEND_DEFAULT;
  }
}

/** Upsert the flag. Errors surface — an admin pressing the switch must be told. */
export async function saveOrderAutoSendSetting(enabled, updatedBy) {
  const rows = await findRow();
  const existing = rows?.[0];
  const payload = { value: { enabled: !!enabled }, updated_by: updatedBy || null };
  if (existing?.id) return base44.entities.AppSettings.update(existing.id, payload);
  return base44.entities.AppSettings.create({ key: ORDER_AUTOSEND_SETTING_KEY, ...payload });
}

// Money changed hands: paid in full, or a deposit. A card order reaches this
// as 'unpaid' at creation and as 'paid' after clearing, which is exactly the
// behaviour wanted from one rule.
export function orderIsPaidEnoughToSend(order) {
  return order?.payment_status === 'paid' || order?.payment_status === 'deposit_paid';
}

// Re-read an order, once, and once more after a beat. hyp-verify writes the
// payment row before onPaid fires, but hyp-notify — the server-to-server
// callback — can be the one that lands the status, so a single read can catch
// the row mid-flight. One retry is the difference between "sent" and "the rep
// has to notice and send it".
async function refetchOrder(orderId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = await base44.entities.Order.filter({ id: orderId }, null, 1).catch(() => []);
    const row = rows?.[0];
    if (row && orderIsPaidEnoughToSend(row)) return row;
    if (row && attempt) return row;
  }
  return null;
}

function fallbackCaption(firstName) {
  return `היי${firstName ? ` ${firstName}` : ''}, מצורפת ההזמנה שלך מקינג דוד 🙏`;
}

/**
 * Send an order's PDF to its customer on WhatsApp.
 *
 * Resolves the same way the manual button does — an existing conversation wins
 * over a bare phone number, so the file lands in the thread the customer is
 * already talking in and goes out from that thread's owner. Failing that, the
 * order's own rep.
 *
 * Resolves `{ sent: true }` or `{ sent: false, reason }`. It never throws: the
 * order is already saved by the time this runs, and nothing here is worth
 * turning a successful sale into an error message.
 */
export async function sendOrderToCustomerWhatsApp(order, { currentUser, isAdmin = false, refreshFirst = false } = {}) {
  if (!order?.id) return { sent: false, reason: 'no_order' };

  // After a card payment the caller holds the order as it was BEFORE the
  // charge — hyp-verify wrote the new status server-side. Re-read it so the
  // paid check is made against the truth and not against a stale object.
  if (refreshFirst) {
    const fresh = await refetchOrder(order.id);
    if (fresh) order = fresh;
  }
  if (!orderIsPaidEnoughToSend(order)) return { sent: false, reason: 'not_paid' };

  const tail = phoneTail(order.customer_phone);
  if (!tail) return { sent: false, reason: 'no_phone' };

  try {
    // The thread this customer already has, if any.
    const chats = await base44.entities.WhatsAppChat
      .filter({ chat_id: { $regex: tail } }, '-last_message_at', 1)
      .catch(() => []);
    const existingChat = chats?.[0] || null;

    // Who it goes out as — the chat's owner, else the order's rep.
    let sender = currentUser;
    const ownerId = existingChat?.user_id || null;
    let asUserId = null;
    if (!existingChat && order.rep1 && currentUser?.email
        && String(order.rep1).toLowerCase() !== String(currentUser.email).toLowerCase()) {
      const reps = await base44.entities.User.filter({ email: order.rep1 }, null, 1).catch(() => []);
      if (reps?.[0]) {
        sender = reps[0];
        if (isAdmin) asUserId = reps[0].id;
      }
    } else if (existingChat && ownerId && ownerId !== currentUser?.id) {
      const owners = await base44.entities.User.filter({ id: ownerId }, null, 1).catch(() => []);
      if (owners?.[0]) sender = owners[0];
    }

    const templates = await base44.entities.WhatsAppTemplate
      .filter({ category: 'orders', is_active: true }, 'sort_order')
      .catch(() => []);
    const firstName = (order.customer_name || '').trim().split(/\s+/)[0] || '';
    const template = templates?.[0];
    const message = template
      ? resolveTemplate(template.body, {
          contactName: order.customer_name,
          repName: sender?.full_name || '',
          repPhone: sender?.phone || '',
        })
      : fallbackCaption(firstName);

    // The PDF is built and uploaded here rather than beforehand, so a failure
    // to render never blocks the order from being created.
    const { default: OrderPdfGenerator } = await import('@/components/orders/OrderPdfGenerator');
    const fileUrl = await OrderPdfGenerator(order);
    if (!fileUrl) return { sent: false, reason: 'pdf_failed' };

    const payload = existingChat
      ? { action: 'file', chat_ref: existingChat.id, file_url: fileUrl, file_name: `הזמנה-${order.order_number}.pdf`, message }
      : {
          action: 'file', phone: order.customer_phone, file_url: fileUrl,
          file_name: `הזמנה-${order.order_number}.pdf`, message,
          ...(asUserId ? { as_user_id: asUserId } : {}),
        };
    const res = await base44.functions.invoke('greenApiSend', payload);
    if (!res?.ok) return { sent: false, reason: res?.error || 'send_failed' };
    return { sent: true, chatRef: res.chat_ref || existingChat?.id || null };
  } catch (err) {
    console.error('[orderAutoSend] send failed', err);
    return { sent: false, reason: err?.message || 'send_failed' };
  }
}

/**
 * The send, with the toasts that make it honest. Every surface that triggers an
 * automatic send calls this so a rep sees the same three outcomes wherever the
 * order was paid — the screen it was created on, or the Hyp dialog days later.
 *
 * Silent for an order nothing was collected on: the rep knows they took no
 * payment, and a toast per order explaining that is noise.
 */
export function autoSendOrderWithToast(order, { currentUser, isAdmin = false, refreshFirst = false } = {}) {
  const toastId = toast.loading('שולח את ההזמנה ללקוח בוואטסאפ...');
  return sendOrderToCustomerWhatsApp(order, { currentUser, isAdmin, refreshFirst })
    .then((result) => {
      if (result.sent) {
        toast.success('ההזמנה נשלחה ללקוח בוואטסאפ ✓', { id: toastId });
      } else if (result.reason === 'not_paid') {
        toast.dismiss(toastId);
      } else if (result.reason === 'no_phone') {
        toast.warning('אין מספר טלפון ללקוח — ההזמנה לא נשלחה בוואטסאפ', { id: toastId });
      } else {
        // Named, not swallowed: the rep has to know the customer is still
        // waiting, and where the manual button is.
        toast.error('שליחת ההזמנה בוואטסאפ נכשלה — אפשר לשלוח ידנית ממסך ההזמנה', {
          id: toastId,
          duration: 10000,
        });
      }
      return result;
    });
}
