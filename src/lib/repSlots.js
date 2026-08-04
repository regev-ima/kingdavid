/**
 * One person, one slot.
 *
 * A lead, a customer and an order each carry two rep slots: the primary — the
 * ownership assignment (`rep1`, or `account_manager` on a customer) — and the
 * secondary (`rep2`), for a colleague who shares the handling. Nothing used to
 * stop the same person from occupying both, and when that happens the record is
 * effectively locked: both handling slots are spent on one rep, so nobody else
 * can be added, and on an order it also reads as one rep splitting commission
 * with themselves.
 *
 * It isn't only a mis-click, either. Transferring one rep's book to another
 * (processTransferBatch) rewrites every rep field from the old email to the new
 * one — so transferring A → B over a record with rep1=A, rep2=B produced
 * exactly this state, silently, in bulk.
 *
 * MIRRORED IN supabase/functions/_shared/repSlots.ts, which enforces the same
 * rule on the server side (bulk update + rep transfer) where this module can't
 * reach. Change one, change the other.
 */

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** True when both values name the same rep. Empty never matches empty. */
export function isSameRep(a, b) {
  const left = norm(a);
  return !!left && left === norm(b);
}

/**
 * Options for a secondary-rep picker: everyone except the primary. Filtering
 * the list is the first line of defence — the choice that breaks the rule is
 * simply not offered, so the guards below only ever fire for the paths that
 * don't go through a picker.
 */
export function repsExcludingPrimary(reps = [], primaryEmail) {
  if (!primaryEmail) return reps;
  return reps.filter((rep) => !isSameRep(rep?.email, primaryEmail));
}

/**
 * Fold a pending change into a patch that cannot leave one person in both slots.
 *
 * @param {Object} current  the record as it is now
 * @param {Object} patch    the fields about to be written
 * @param {Object} [opts]   field names, for customers: { primaryField: 'account_manager' }
 * @returns {{patch: Object, rejectedSecondary: boolean, clearedSecondary: boolean}}
 */
export function reconcileRepSlots(current = {}, patch = {}, opts = {}) {
  const { primaryField = 'rep1', secondaryField = 'rep2' } = opts;
  const next = { ...patch };

  const primary = primaryField in next ? next[primaryField] : current?.[primaryField];

  // 1. A secondary that would duplicate the primary is never written, and the
  //    slot keeps whoever is already in it: overwriting a real second rep with
  //    a copy of the first would lose a person on top of breaking the rule.
  const rejectedSecondary = secondaryField in next && isSameRep(primary, next[secondaryField]);
  if (rejectedSecondary) delete next[secondaryField];

  // 2. Whatever remains in the slot still must not be the primary. This is the
  //    "promoted the secondary to primary" case — they own the record now, so
  //    the secondary slot frees up for someone else.
  const secondary = secondaryField in next ? next[secondaryField] : current?.[secondaryField];
  const clearedSecondary = isSameRep(primary, secondary);
  if (clearedSecondary) next[secondaryField] = '';

  return { patch: next, rejectedSecondary, clearedSecondary };
}
