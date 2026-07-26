// Which delivery/handling extras (תוספות להובלה) apply to a given order or
// quote — the single source of truth for NewQuote / EditQuote / NewOrder.
//
// The rule is: per PRODUCT CATEGORY, by QUANTITY. A row in `extra_charges`
// carries its own rule:
//
//   applies_to_category  bed | mattress | topper | accessory | any (=null)
//   min_qty / max_qty    the quantity window it prices (max null = open ended)
//   hide_from_quote      never offered on a quote/order (crane, per-floor …)
//
// so "הובלה ל-2 מיטות" is (bed, 2..2) and "הובלה למזרן" is (mattress, 1..1).
// A mixed order therefore offers the bed row that matches the bed count AND the
// mattress row that matches the mattress count — they no longer block each
// other, and a mattress can never be mistaken for a bed.
//
// Rows created before those columns existed have no rule, so their name is
// parsed as a fallback (parseChargeName) — the same heuristic the quote pages
// used inline, kept in ONE place and only as a bridge until the backfill
// migration has run everywhere.
//
// Why this exists: the old inline version counted beds with `hasBedType()`,
// which is TRUE for mattresses too (bed_type is the width family — single /
// double — not the category). One bed + one mattress counted as 2 beds, so the
// only delivery option the screen offered was "הובלה ל-2 מיטות" (₪900) while
// the correct single-bed and single-mattress rows were both hidden.

// Product categories that can carry their own delivery pricing. Labels mirror
// the product catalog (ProductsNew categoryLabels) so the same word the rep
// sees on the item row appears in the delivery hint.
export const DELIVERY_CATEGORIES = [
  { key: 'bed', label: 'מיטה', plural: 'מיטות', one: 'מיטה אחת' },
  { key: 'mattress', label: 'מזרן', plural: 'מזרנים', one: 'מזרן אחד' },
  { key: 'topper', label: 'טופר', plural: 'טופרים', one: 'טופר אחד' },
  { key: 'accessory', label: 'נלווה', plural: 'נלווים', one: 'פריט נלווה אחד' },
];

export const DELIVERY_CATEGORY_KEYS = DELIVERY_CATEGORIES.map((c) => c.key);

const EMPTY_COUNTS = { bed: 0, mattress: 0, topper: 0, accessory: 0, other: 0, total: 0 };

// Legacy rows keep the category under `data` (same shape convention as
// bed_type in utils/bedType.js).
export function getProductCategory(product) {
  return product?.category ?? product?.data?.category ?? null;
}

// Quantity-weighted item count per category. Skips the child lines the quote
// builder inserts for add-ons and bed-configurator choices — they have no
// product_id and are not separate items to load onto a truck.
export function countItemsByCategory(items = [], products = []) {
  const counts = { ...EMPTY_COUNTS };
  for (const item of items || []) {
    if (!item?.product_id) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const category = getProductCategory((products || []).find((p) => p.id === item.product_id));
    if (DELIVERY_CATEGORY_KEYS.includes(category)) counts[category] += qty;
    else counts.other += qty;
    counts.total += qty;
  }
  return counts;
}

// Extras that are priced by the shipper on site or per floor, and so are never
// picked from the quote screen. Matched by name only as a fallback — the
// migration turns these into `hide_from_quote` data.
const HIDDEN_NAME_PATTERNS = [
  (name) => name === 'שירותי מנוף',
  (name) => name.includes('מחויב במנוף'),
  (name) => name.includes('כל מיטה החל מקומה'),
];

function isHiddenCharge(charge) {
  if (typeof charge?.hide_from_quote === 'boolean') return charge.hide_from_quote;
  const name = String(charge?.name || '');
  return HIDDEN_NAME_PATTERNS.some((test) => test(name));
}

// Fallback rule extraction from the Hebrew name, for rows without the
// structured columns. Note the plural forms are tested FIRST: 'טופר' is a
// substring of 'טופרים' (unlike 'מיטה'/'מיטות' and 'מזרן'/'מזרנים', which end
// in a final letter and can't collide), so singular-first would misread it.
export function parseChargeName(rawName) {
  const name = String(rawName || '');
  for (const { key, label, plural } of DELIVERY_CATEGORIES) {
    // "הובלה ל-2 מיטות" / "הובלה ל 3 מזרנים" → an exact quantity.
    const explicit = name.match(new RegExp(`ל[- ]?(\\d+)\\s*${plural}`));
    if (explicit) {
      const n = parseInt(explicit[1], 10);
      return { category: key, min: n, max: n, source: 'name' };
    }
    // Bare plural → two or more.
    if (name.includes(plural)) return { category: key, min: 2, max: null, source: 'name' };
    // Singular (incl. the construct form, e.g. "הובלת מיטת יחיד") → exactly one.
    if (name.includes(label) || (key === 'bed' && name.includes('מיטת'))) {
      return { category: key, min: 1, max: 1, source: 'name' };
    }
  }
  // Not category-specific (floors, elevator, assembly …) → always offered.
  return { category: null, min: 1, max: null, source: 'name' };
}

// The rule a charge row prices: the structured columns when present, otherwise
// parsed from its name.
export function chargeRule(charge) {
  const category = charge?.applies_to_category;
  if (category) {
    const min = charge.min_qty == null ? 1 : Number(charge.min_qty);
    const max = charge.max_qty == null ? null : Number(charge.max_qty);
    return {
      category: category === 'any' ? null : category,
      min: Number.isFinite(min) ? min : 1,
      max: Number.isFinite(max) ? max : null,
      source: 'db',
    };
  }
  return parseChargeName(charge?.name);
}

// Human-readable rule, for the admin table and for tooltips: "2 מיטות",
// "מיטה אחת", "3+ מזרנים", "כל הזמנה".
export function describeChargeRule(charge) {
  const rule = chargeRule(charge);
  if (isHiddenCharge(charge)) return 'לא מוצגת בהצעה/הזמנה';
  if (!rule.category) return 'כל הזמנה';
  const meta = DELIVERY_CATEGORIES.find((c) => c.key === rule.category);
  const plural = meta?.plural || rule.category;
  if (rule.max === 1 && rule.min <= 1) return meta?.one || `${meta?.label || rule.category} אחד`;
  if (rule.max != null && rule.min === rule.max) return `${rule.min} ${plural}`;
  if (rule.max == null) return `${rule.min}+ ${plural}`;
  return `${rule.min}–${rule.max} ${plural}`;
}

export function isChargeApplicable(charge, counts) {
  if (!charge || charge.is_active === false) return false;
  if (isHiddenCharge(charge)) return false;
  const rule = chargeRule(charge);
  if (!rule.category) return true;
  const have = Number(counts?.[rule.category]) || 0;
  if (have < (rule.min ?? 1)) return false;
  if (rule.max != null && have > rule.max) return false;
  return true;
}

// The extras to offer for an order/quote, plus what was left out so the screen
// can explain itself instead of silently showing a short (or empty) list.
//   available            → offer these
//   missingCategories    → categories present in the order with no matching row
//                          (e.g. 3 beds but the price list stops at 2)
export function resolveDeliveryCharges(charges = [], counts = EMPTY_COUNTS) {
  const offerable = (charges || []).filter((c) => c && c.is_active !== false && !isHiddenCharge(c));
  const available = offerable.filter((c) => isChargeApplicable(c, counts));
  const missingCategories = DELIVERY_CATEGORIES
    .filter(({ key }) => (Number(counts?.[key]) || 0) > 0)
    .filter(({ key }) => !available.some((c) => chargeRule(c).category === key))
    .map(({ key, label, plural }) => {
      const count = Number(counts?.[key]) || 0;
      return { key, count, label: count === 1 ? label : plural };
    });
  return { available, offerable, missingCategories };
}

// "1 מיטה, 2 מזרנים" — the order's composition, shown next to the delivery
// picker so a wrong count is visible instead of being inferred from the price.
export function describeCounts(counts) {
  const parts = DELIVERY_CATEGORIES
    .map(({ key, label, plural }) => {
      const n = Number(counts?.[key]) || 0;
      if (n <= 0) return null;
      return `${n} ${n === 1 ? label : plural}`;
    })
    .filter(Boolean);
  const other = Number(counts?.other) || 0;
  if (other > 0) parts.push(`${other} פריטים ללא קטגוריה`);
  return parts.join(', ');
}
