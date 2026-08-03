/**
 * Cancelling an order — the non-destructive counterpart to deleteOrder.
 *
 * Delete is for test data: it erases the order and everything hanging off it.
 * Cancel is for a real sale that fell through. The order stays, tagged "בוטל",
 * because history and reporting still need to know it existed — what changes is
 * that it stops counting as money:
 *
 *   • the commission moves to 'cancelled', so the rep is not paid for it,
 *   • the customer's total_orders / lifetime_value give the money back,
 *   • the shipment is cancelled so logistics stops scheduling it.
 *
 * The order row itself is never touched beyond the three cancellation columns —
 * payment / production / delivery statuses stay exactly as they were, because
 * "we cancelled after it was already paid and built" is a real and important
 * thing for the record to still say.
 */

import { base44 } from '@/api/base44Client';

/** True for an order that has been cancelled. NULL cancelled_at = live. */
export function isCancelledOrder(order) {
  return Boolean(order?.cancelled_at);
}

/** Drop cancelled orders from a list before summing money. */
export function excludeCancelled(orders = []) {
  return orders.filter((o) => !isCancelledOrder(o));
}

/**
 * Cancel an order. `reason` is free text from the dialog (optional).
 *
 * Order of operations mirrors deleteOrder: the dependents first, the order row
 * last. If a dependent write fails the order is still live and the admin can
 * retry, rather than being left with a cancelled order whose commission is
 * quietly still payable.
 */
export async function cancelOrder(order, { reason = '', cancelledBy = null } = {}) {
  if (!order?.id) throw new Error('לא נמצאה הזמנה לביטול');
  if (isCancelledOrder(order)) throw new Error('ההזמנה כבר מבוטלת');

  // Commission — stop it being payable. StatusBadge already renders
  // 'cancelled' as "בוטל", so Finance shows it correctly with no extra work.
  const commissions = await base44.entities.Commission.filter({ order_id: order.id });
  for (const commission of commissions || []) {
    await base44.entities.Commission.update(commission.id, { status: 'cancelled' });
  }

  // Shipment — take it out of the logistics queue.
  const shipments = await base44.entities.DeliveryShipment.filter({ order_id: order.id });
  for (const shipment of shipments || []) {
    await base44.entities.DeliveryShipment.update(shipment.id, { status: 'cancelled' });
  }

  // Customer rollup — give back the order's contribution. Never below zero: an
  // imported or hand-edited customer can already be out of step with its orders.
  if (order.customer_id) {
    try {
      const [customer] = await base44.entities.Customer.filter({ id: order.customer_id });
      if (customer) {
        await base44.entities.Customer.update(customer.id, {
          total_orders: Math.max(0, (customer.total_orders || 0) - 1),
          lifetime_value: Math.max(0, (customer.lifetime_value || 0) - (order.total || 0)),
        });
      }
    } catch (err) {
      // A stale counter is a smaller problem than a half-cancelled order, and
      // it is visible and fixable on the customer card.
      console.warn('[cancelOrder] customer rollback failed:', err?.message || err);
    }
  }

  await base44.entities.Order.update(order.id, {
    cancelled_at: new Date().toISOString(),
    cancelled_by: cancelledBy || null,
    cancel_reason: reason.trim() || null,
  });
}

/** Undo a cancellation — puts the order back the way it was. */
export async function reactivateOrder(order) {
  if (!order?.id) throw new Error('לא נמצאה הזמנה');

  const commissions = await base44.entities.Commission.filter({ order_id: order.id });
  for (const commission of commissions || []) {
    if (commission.status === 'cancelled') {
      // Back to pending, not to approved: whether it earns is decided by the
      // payment state again, the same way a fresh order decides it.
      await base44.entities.Commission.update(commission.id, { status: 'pending' });
    }
  }

  const shipments = await base44.entities.DeliveryShipment.filter({ order_id: order.id });
  for (const shipment of shipments || []) {
    if (shipment.status === 'cancelled') {
      await base44.entities.DeliveryShipment.update(shipment.id, { status: 'need_scheduling' });
    }
  }

  if (order.customer_id) {
    try {
      const [customer] = await base44.entities.Customer.filter({ id: order.customer_id });
      if (customer) {
        await base44.entities.Customer.update(customer.id, {
          total_orders: (customer.total_orders || 0) + 1,
          lifetime_value: (customer.lifetime_value || 0) + (order.total || 0),
        });
      }
    } catch (err) {
      console.warn('[reactivateOrder] customer rollback failed:', err?.message || err);
    }
  }

  await base44.entities.Order.update(order.id, {
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
  });
}
