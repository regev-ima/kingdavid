/**
 * Delivery / assembly extras — matching an order's contents to the right
 * `extra_charges` row.
 *
 * The catalog has no structured "this row is the delivery fee for 2 beds"
 * field: the whole contract lives in the Hebrew NAME ("הובלה והרכבה ל-2 מיטות",
 * "הובלה למזרן", "שירותי מנוף", "כל מיטה החל מקומה 3"). So every rule here is a
 * name rule, and the screens share this module instead of each re-deriving them.
 *
 * ── Hebrew final letters ──────────────────────────────────────────────────
 * A plain /מזרן/ does NOT match "מזרנים": the singular ends in ן (final nun),
 * the plural in נ. Same trap for מנוף/מנופים and קומה/קומות. Every pattern here
 * therefore spells the ending as a character class — /מזר[נן]/, /מנו[פף]/,
 * /קומ[הות]/ — which is exactly the bug that made the first version of the
 * matcher silently find nothing.
 */

import { getBedTypes } from '@/utils/bedType';

// A bed wider than this is a double when the product itself supports both
// widths and can't tell us which one was sold.
const DOUBLE_BED_MIN_WIDTH_CM = 140;

const RE_DELIVERY = /הובל|הרכב|משלוח/;
const RE_BED = /מיט[הות]/;
const RE_MATTRESS = /מזר[נן]/;
const RE_CRANE = /מנו[פף]/;
const RE_FLOOR = /קומ[הות]/;

/** Crane + per-floor charges are quoted against the building, never guessed. */
export function isManualOnlyExtra(name) {
  return RE_CRANE.test(name || '') || RE_FLOOR.test(name || '');
}

/**
 * Anything that only makes sense when WE bring the goods — the delivery and
 * assembly rows plus the crane/per-floor surcharges that hang off them.
 * A self-pickup order may carry other extras (a protector, a warranty), just
 * none of these.
 */
export function isDeliveryRelatedExtra(name) {
  const value = name || '';
  return RE_DELIVERY.test(value) || RE_CRANE.test(value) || RE_FLOOR.test(value);
}

/** First number appearing in an extra's name ("ל-2 מיטות" → 2), or null. */
function numberInName(name) {
  const m = /(\d+)/.exec(name || '');
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Count what's actually on the order: beds, mattresses, and the single/double
 * split that decides between "הובלה למיטה יחידה" and "...זוגית".
 * Custom free-text lines (`is_custom`) carry no product and are never counted.
 */
export function summarizeItems(items = [], products = []) {
  const byId = new Map(products.map((p) => [p.id, p]));
  let bedCount = 0;
  let mattressCount = 0;
  let singleBeds = 0;
  let doubleBeds = 0;

  for (const item of items) {
    if (!item || item.is_custom || !item.product_id) continue;
    const product = byId.get(item.product_id);
    if (!product) continue;
    const qty = Number(item.quantity) || 0;
    if (product.category === 'mattress') {
      mattressCount += qty;
      continue;
    }
    // A bed is anything the catalog files under `bed`; older rows may only
    // carry a bed_type, so accept that as the marker too.
    const types = getBedTypes(product);
    if (product.category !== 'bed' && types.length === 0) continue;
    bedCount += qty;
    const isDouble = types.length === 1
      ? types[0] === 'double'
      : Number(item.width_cm || 0) >= DOUBLE_BED_MIN_WIDTH_CM;
    if (isDouble) doubleBeds += qty; else singleBeds += qty;
  }

  return { bedCount, mattressCount, singleBeds, doubleBeds };
}

/**
 * The extras a rep should even SEE for this order — the rules the quote screen
 * has always applied, now in one place.
 *
 * Hidden: crane services, the "charged separately" notes, bed rows whose count
 * doesn't match, and mattress rows for a mattress count the order doesn't have.
 */
export function filterDeliveryExtras(
  extraCharges = [],
  { bedCount = 0, mattressCount = 0, selfPickup = false } = {},
) {
  return extraCharges.filter((ec) => {
    const name = ec?.name || '';
    // Nothing delivery-shaped is offered once the customer collects it himself.
    if (selfPickup && isDeliveryRelatedExtra(name)) return false;
    if (name === 'שירותי מנוף') return false;
    if (name.includes('מחויב במנוף') || name.includes('כל מיטה החל מקומה')) return false;

    // Bed-count gating. Order matters: the explicit count wins, then the
    // plural/singular heuristic. "מיטה" is not a substring of "מיטות" (ה vs ת),
    // so the singular test can't accidentally catch the plural.
    const multiBed = name.match(/ל[- ]?(\d+) מיטות/);
    if (multiBed) return bedCount === parseInt(multiBed[1], 10);
    if (name.includes('מיטות')) return bedCount >= 2;
    if (name.includes('מיטה')) return bedCount === 1;

    // Mattress-count gating.
    const multiMattress = name.match(/הובלה ל[- ]?(\d+) מזרנים/);
    if (multiMattress) return mattressCount === parseInt(multiMattress[1], 10);
    if (name === 'הובלה למזרן' || name === 'הובלה מזרן') {
      // The singular row is for a lone mattress — with beds on the order their
      // delivery row already covers it, and 2+ mattresses have their own row.
      return mattressCount === 1 && bedCount === 0;
    }
    return true;
  });
}

/**
 * Pick one row out of a family's candidates:
 *   1. a row whose name states exactly this count ("ל-2 מיטות" for 2 beds),
 *   2. otherwise a generic row with no number in it — and when several are
 *      generic, the one matching the order's single/double makeup,
 *   3. otherwise simply the cheapest candidate.
 * Returns null when the family has no candidates at all.
 */
function pickForFamily(candidates, { count, singles = 0, doubles = 0 }) {
  if (!candidates.length) return null;
  const byCost = (a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0);

  const exact = candidates.filter((ec) => numberInName(ec.name) === count);
  if (exact.length) return [...exact].sort(byCost)[0];

  const generic = candidates.filter((ec) => numberInName(ec.name) == null);
  if (generic.length) {
    if (generic.length > 1 && (singles || doubles)) {
      const wanted = doubles > singles ? 'זוגי' : 'יחיד';
      const preferred = generic.filter((ec) => (ec.name || '').includes(wanted));
      if (preferred.length) return [...preferred].sort(byCost)[0];
    }
    return [...generic].sort(byCost)[0];
  }

  return [...candidates].sort(byCost)[0];
}

/**
 * Recommend the delivery/assembly extras for an order.
 *
 * Returns `{ extras, fallbackUsed }` — at most one row per family (beds,
 * mattresses). Crane and per-floor charges are deliberately never returned:
 * they depend on the building and have to be agreed with the customer.
 *
 * When nothing in the catalog matches but the order does carry beds or
 * mattresses, we fall back to the catalog's single generic delivery row — and
 * only if it IS single. Two candidates means we don't know, so we don't guess
 * (the caller shows "בחר ידנית" instead).
 */
export function recommendDeliveryExtras(extraCharges = [], profile = {}, { selfPickup = false } = {}) {
  const { bedCount = 0, mattressCount = 0, singleBeds = 0, doubleBeds = 0 } = profile;
  // Self pickup: there is no delivery to recommend, whatever the order holds.
  if (selfPickup) return { extras: [], fallbackUsed: false };
  if (bedCount <= 0 && mattressCount <= 0) return { extras: [], fallbackUsed: false };

  const visible = filterDeliveryExtras(extraCharges, { bedCount, mattressCount })
    .filter((ec) => !isManualOnlyExtra(ec?.name));

  const extras = [];
  if (bedCount > 0) {
    const beds = visible.filter((ec) => RE_DELIVERY.test(ec.name || '') && RE_BED.test(ec.name || ''));
    const pick = pickForFamily(beds, { count: bedCount, singles: singleBeds, doubles: doubleBeds });
    if (pick) extras.push(pick);
  }
  if (mattressCount > 0) {
    const mattresses = visible.filter((ec) => RE_DELIVERY.test(ec.name || '') && RE_MATTRESS.test(ec.name || ''));
    const pick = pickForFamily(mattresses, { count: mattressCount });
    if (pick && !extras.some((e) => e.id === pick.id)) extras.push(pick);
  }

  if (extras.length) return { extras, fallbackUsed: false };

  // Nothing named for beds/mattresses — is there exactly one plain delivery row?
  const generic = visible.filter((ec) =>
    RE_DELIVERY.test(ec.name || '') && !RE_BED.test(ec.name || '') && !RE_MATTRESS.test(ec.name || ''),
  );
  if (generic.length === 1) return { extras: generic, fallbackUsed: true };

  return { extras: [], fallbackUsed: false };
}
