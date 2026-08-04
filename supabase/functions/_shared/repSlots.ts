/**
 * One person, one slot — server side.
 *
 * A lead, a customer and an order each carry a primary rep (`rep1`, or
 * `account_manager` on a customer) and a secondary (`rep2`). The same person
 * must never hold both: two handling slots spent on one rep locks the record to
 * them, and on an order it reads as one rep splitting commission with themselves.
 *
 * The UI pickers enforce it (see src/lib/repSlots.js, which this mirrors), but
 * two server paths write rep fields without ever passing through a picker:
 *
 *   • processTransferBatch — moves one rep's whole book to another by rewriting
 *     every rep field from the old email to the new one. Transferring A → B
 *     over a record with rep1=A, rep2=B produced the duplicate silently, in
 *     bulk. This is the path that made it a real problem rather than a mis-click.
 *   • processBulkUpdateBatch — writes the same value to a column across many
 *     rows, so one "set rep2" run can collide with whatever each row's primary
 *     happens to be.
 *
 * Change this file and src/lib/repSlots.js together.
 */

const norm = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** True when both values name the same rep. Empty never matches empty. */
export function isSameRep(a: unknown, b: unknown): boolean {
  const left = norm(a);
  return !!left && left === norm(b);
}

export interface RepSlotFields {
  primaryField?: string;
  secondaryField?: string;
}

export interface ReconcileResult {
  patch: Record<string, unknown>;
  rejectedSecondary: boolean;
  clearedSecondary: boolean;
}

/**
 * Fold a pending change into a patch that cannot leave one person in both slots.
 *
 *   • a secondary that would duplicate the primary is dropped from the patch —
 *     the slot keeps whoever is in it, because overwriting a real second rep
 *     with a copy of the first would lose a person;
 *   • whatever remains in the slot is cleared when it equals the primary, which
 *     is the "the secondary was just promoted" case.
 */
export function reconcileRepSlots(
  current: Record<string, unknown> = {},
  patch: Record<string, unknown> = {},
  fields: RepSlotFields = {},
): ReconcileResult {
  const { primaryField = 'rep1', secondaryField = 'rep2' } = fields;
  const next: Record<string, unknown> = { ...patch };

  const primary = primaryField in next ? next[primaryField] : current?.[primaryField];

  const rejectedSecondary = secondaryField in next && isSameRep(primary, next[secondaryField]);
  if (rejectedSecondary) delete next[secondaryField];

  const secondary = secondaryField in next ? next[secondaryField] : current?.[secondaryField];
  const clearedSecondary = isSameRep(primary, secondary);
  if (clearedSecondary) next[secondaryField] = '';

  return { patch: next, rejectedSecondary, clearedSecondary };
}

/**
 * Which pair of columns holds the rep slots for a table, or null for tables
 * where the rule doesn't apply. `sales_tasks` carries rep1/rep2 too, but there
 * they mean "who this task is for" rather than ownership of a record, so a task
 * naming the same rep twice is harmless and left alone.
 */
export function repSlotFieldsForTable(tableName: string): RepSlotFields | null {
  switch (tableName) {
    case 'leads':
    case 'orders':
      return { primaryField: 'rep1', secondaryField: 'rep2' };
    case 'customers':
      return { primaryField: 'account_manager', secondaryField: 'rep2' };
    default:
      return null;
  }
}
