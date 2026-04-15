/**
 * bed_type normalization helpers.
 *
 * Products store bed_type as an array (e.g. ['single'], ['double'],
 * ['single','double']) to allow a single product to support multiple bed
 * widths. Some legacy rows may still have it as a plain string.
 *
 * Use these helpers anywhere you need to reason about bed_type to avoid
 * bugs like `['single'] === 'single'` which always evaluates false.
 */

/** Normalize bed_type into an array of strings ('single' | 'double'). */
export function getBedTypes(product) {
  const raw = product?.bed_type ?? product?.data?.bed_type;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw) return [raw];
  return [];
}

/** Does this product support the given bed type? */
export function productMatchesBedType(product, target) {
  if (!target) return true;
  return getBedTypes(product).includes(target);
}

/** Does this product have ANY bed_type set? (replaces `product.bed_type` truthiness.) */
export function hasBedType(product) {
  return getBedTypes(product).length > 0;
}

/** First bed_type (for badge display when a single one must be chosen). */
export function getPrimaryBedType(product) {
  return getBedTypes(product)[0] || null;
}
