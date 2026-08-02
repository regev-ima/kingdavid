/**
 * Deleting an order — and everything hanging off it.
 *
 * An order is the parent of four child records, each keyed by `order_id`:
 * the delivery shipment, the sales commission, any return requests and any
 * service tickets. Deleting only the order row leaves those orphaned (and a
 * foreign key may refuse the delete outright), so removal is always the whole
 * set. The customer's rollup counters are wound back too, otherwise a deleted
 * test order keeps inflating that customer's לקוח LTV forever.
 *
 * Admin-only — enforced in the UI and by the `auth_delete_*` RLS policies
 * (20240202000001), which require users.role = 'admin'.
 */

import { base44 } from '@/api/base44Client';

// table label ↔ entity, in the order they must be removed (children first).
const CHILDREN = [
  { key: 'shipments', label: 'משלוחים', entity: 'DeliveryShipment' },
  { key: 'commissions', label: 'עמלות', entity: 'Commission' },
  { key: 'returns', label: 'בקשות החזרה', entity: 'ReturnRequest' },
  { key: 'tickets', label: 'קריאות שירות', entity: 'SupportTicket' },
];

/**
 * What would be removed along with this order. Drives the confirmation dialog
 * so the admin sees the real blast radius before clicking.
 * Returns `{ counts: {key: n}, rows: {key: [...]}, total }`.
 */
export async function collectOrderDependents(orderId) {
  const results = await Promise.all(
    CHILDREN.map(async (child) => {
      try {
        const rows = await base44.entities[child.entity].filter({ order_id: orderId });
        return [child.key, rows || []];
      } catch (err) {
        // A missing table/column must not block the count — report zero and
        // let the delete itself surface any real error.
        console.warn(`[deleteOrder] could not count ${child.entity}:`, err?.message || err);
        return [child.key, []];
      }
    }),
  );
  const rows = Object.fromEntries(results);
  const counts = Object.fromEntries(results.map(([key, list]) => [key, list.length]));
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { counts, rows, total };
}

/** Human-readable labels for the dependent groups, for the dialog. */
export const DEPENDENT_LABELS = CHILDREN.reduce((acc, c) => ({ ...acc, [c.key]: c.label }), {});

/**
 * Hard-delete an order: children first, then the customer rollback, then the
 * order row itself. The order goes last on purpose — if a child delete fails
 * (RLS, a foreign key we don't know about), the order is still there and the
 * admin can retry, instead of being left with orphans and no parent.
 */
export async function deleteOrderCascade(order) {
  if (!order?.id) throw new Error('לא נמצאה הזמנה למחיקה');

  const { rows } = await collectOrderDependents(order.id);
  for (const child of CHILDREN) {
    for (const row of rows[child.key] || []) {
      await base44.entities[child.entity].delete(row.id);
    }
  }

  // Wind back the customer's rollup counters. Never below zero — an imported
  // or manually-edited customer can already be out of step with its orders.
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
      // The order still has to go — a stale counter is a smaller problem than
      // a half-deleted order, and it's visible/fixable on the customer card.
      console.warn('[deleteOrder] customer rollback failed:', err?.message || err);
    }
  }

  await base44.entities.Order.delete(order.id);
}
