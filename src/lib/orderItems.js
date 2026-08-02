/**
 * Shared item-list rules for the quote / order forms.
 *
 * Since "פריט כללי" (a free-text line the rep names and prices themselves) a
 * line without a `product_id` is no longer automatically a catalog add-on
 * sub-row — it may be a custom line, marked `is_custom`. These helpers keep the
 * three call sites (NewOrder, NewQuote, and their step gating) agreeing on what
 * counts as a real item and what blocks a save.
 */

/** A line the customer is actually being charged for (catalog or custom). */
export function isSellableItem(item) {
  if (!item) return false;
  if (item.is_custom) return Boolean((item.name || '').trim());
  return Boolean(item.product_id);
}

/** Does the list have at least one real item? Gates the "המשך" / save buttons. */
export function hasSellableItem(items = []) {
  return items.some(isSellableItem);
}

/**
 * Drop lines that carry nothing at all — an untouched custom row the rep added
 * and then abandoned, or a blank line left over from an older form. Add-on and
 * bed-configurator sub-rows have no product_id but do have a name, so they
 * survive this filter.
 */
export function cleanOrderItems(items = []) {
  return items.filter((item) => {
    if (!item) return false;
    if (item.product_id) return true;
    const named = Boolean((item.name || '').trim());
    if (item.is_custom) return named || Number(item.unit_price) > 0;
    return named;
  });
}

/**
 * Validation message for the save handler, or null when the list is fine.
 * Run it on the CLEANED list — an abandoned blank custom row is filtered out,
 * not an error, but a priced one with no name is.
 */
export function validateOrderItems(items = []) {
  if (items.some((item) => item?.is_custom && !(item.name || '').trim())) {
    return 'יש להזין שם לכל פריט כללי (או למחוק את השורה הריקה)';
  }
  if (!hasSellableItem(items)) return 'יש להוסיף לפחות פריט אחד להזמנה';
  return null;
}
