import { base44 } from '@/api/base44Client';
import { createAuditLog } from '@/utils/auditLog';

/**
 * Cross-rep attribution policy.
 *
 * When a rep who does NOT own a lead produces a quote or an order for it (the
 * classic "walk-in": the customer shows up at the store and a different rep
 * serves them), the lead's rep assignment is adjusted:
 *
 *   - the lead already has an order  → the acting rep is ADDED as SECONDARY (rep2)
 *     (the original rep's committed sale stands; the newcomer shares credit)
 *   - the lead has NO order          → the acting rep REPLACES the primary (rep1)
 *     (the original rep never closed anything, so the newcomer takes over)
 *
 * Either way the change is written to the lead's activity history.
 *
 * No-ops (returns without touching anything) when:
 *   - ids/actor are missing, or the actor is an admin (admins act on behalf of
 *     reps, they are never assigned as the rep),
 *   - the lead is unassigned (no current rep1), or
 *   - the acting rep already owns the lead (is its rep1 or rep2).
 *
 * @param {Object}  opts
 * @param {string}  opts.leadId
 * @param {Object}  opts.actingUser      effectiveUser: { email, full_name, role }
 * @param {boolean} opts.isAdminActor    true when the acting user is an admin
 * @param {string}  opts.sourceLabel     Hebrew trigger label ('הצעת מחיר' / 'הזמנה')
 * @param {string}  [opts.excludeOrderId] order id to ignore in the "has order"
 *   check — pass the just-created order so creating the FIRST order still counts
 *   as "no prior order".
 * @returns {Promise<{action:'secondary'|'primary'|'none', rep?:string}>}
 */
export async function applyCrossRepReassignment({ leadId, actingUser, isAdminActor, sourceLabel, excludeOrderId = null }) {
  try {
    const actingRep = actingUser?.email;
    if (!leadId || !actingRep || isAdminActor) return { action: 'none' };

    const freshLead = (await base44.entities.Lead.filter({ id: leadId }))[0];
    if (!freshLead) return { action: 'none' };

    const currentRep1 = freshLead.rep1 || null;
    const currentRep2 = freshLead.rep2 || null;

    // Only act when the lead already belongs to *another* rep.
    if (!currentRep1 || actingRep === currentRep1 || actingRep === currentRep2) {
      return { action: 'none' };
    }

    const orders = await base44.entities.Order.filter({ lead_id: leadId }, null, 20);
    const hasPriorOrder = Array.isArray(orders) && orders.some((o) => o && o.id !== excludeOrderId);

    if (hasPriorOrder) {
      await base44.entities.Lead.update(leadId, { rep2: actingRep });
      await createAuditLog({
        leadId,
        actionType: 'rep_assignment',
        description: `${actingUser?.full_name || actingRep} נוסף/ה כנציג משני — ${sourceLabel} חדשה על ליד עם הזמנה קיימת (נציג ראשי: ${currentRep1})`,
        user: actingUser,
        fieldName: 'rep2',
        oldValue: currentRep2,
        newValue: actingRep,
      });
      return { action: 'secondary', rep: actingRep };
    }

    await base44.entities.Lead.update(leadId, { rep1: actingRep });
    await createAuditLog({
      leadId,
      actionType: 'rep_assignment',
      description: `הנציג הראשי הוחלף ל-${actingUser?.full_name || actingRep} — ${sourceLabel} חדשה, ללא הזמנה קיימת (נציג קודם: ${currentRep1})`,
      user: actingUser,
      fieldName: 'rep1',
      oldValue: currentRep1,
      newValue: actingRep,
    });
    return { action: 'primary', rep: actingRep };
  } catch (e) {
    // Never let attribution bookkeeping break the quote/order save.
    console.error('applyCrossRepReassignment failed', e);
    return { action: 'none' };
  }
}
