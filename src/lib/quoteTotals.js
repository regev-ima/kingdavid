/**
 * The one place a quote's / order's money is worked out.
 *
 * NewQuote, NewOrder and EditQuote each used to carry their own copy of this
 * arithmetic, and QuoteTotalsSummary a fourth for the on-screen breakdown — so
 * the number the rep read in the dialog and the number stored on the document
 * were two separate calculations that only usually agreed. They now come from
 * here, which makes "what the rep saw" and "what the customer is billed" the
 * same number by construction.
 *
 * House rules, unchanged:
 *   • Line prices are stored PRE-VAT; discounts are a per-line percent.
 *   • Extras (תוספות — הובלה / הרכבה) are stored VAT-INCLUSIVE, so VAT is
 *     never recomputed on top of them.
 *   • Everything rounds to agorot, and only where a person will read it.
 */

export const VAT_RATE = 0.18;
export const VAT_MULTIPLIER = 1 + VAT_RATE;

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A line's list price before its discount, pre-VAT (add-ons included).
 * A line with no quantity bills as one, which is what its row already shows —
 * better than silently billing nothing, and better than the NaN the totals
 * used to produce.
 */
export function lineGrossPreVat(item) {
  const addons = (item?.selected_addons || []).reduce((sum, a) => sum + (a?.price || 0), 0);
  return (item?.quantity || 1) * ((item?.unit_price || 0) + addons);
}

/** What the line's discount percent takes off it, pre-VAT. Not rounded. */
export function lineDiscountPreVat(item) {
  return lineGrossPreVat(item) * ((item?.discount_percent || 0) / 100);
}

/**
 * The four rounded figures every other number here is built from. One helper,
 * so the stored total and the on-screen breakdown can't split VAT differently
 * and land an agora apart: `g + round2(g × 18%)` and `round2(g × 1.18)` are
 * not the same number when g × 18% falls on a half-agora (₪33,240.25 gives
 * ₪39,223.50 one way and ₪39,223.49 the other). The screen's way wins — its
 * rows have to visibly add up.
 */
function documentAnchors(items = [], extras = []) {
  const itemsGrossPreVat = round2((items || []).reduce((sum, item) => sum + lineGrossPreVat(item), 0));
  // Left unrounded: it is only ever used inside a rounding, and rounding it
  // early is what shaved the agorot off in the first place.
  const itemsDiscountPreVat = (items || []).reduce((sum, item) => sum + lineDiscountPreVat(item), 0);
  const extrasIncl = round2((extras || []).reduce((sum, extra) => sum + (extra?.cost || 0), 0));

  const grossVat = round2(itemsGrossPreVat * VAT_RATE);
  const itemsGrossInclVat = round2(itemsGrossPreVat + grossVat);
  const discountInclVat = round2(itemsDiscountPreVat * VAT_MULTIPLIER);

  return { itemsGrossPreVat, itemsDiscountPreVat, extrasIncl, grossVat, itemsGrossInclVat, discountInclVat };
}

/**
 * Grand totals for a document, as stored on the Quote / Order row.
 *
 * The total is built the way the rep states the deal — list price including
 * VAT, minus the discount including VAT — with each of those two rounded to
 * agorot first. Both are then whole agorot, so subtracting them is exact, and
 * a rep who takes ₪480 off a ₪5,480 bed gets ₪5,000.00 rather than ₪4,999.95.
 *
 * Deriving it any other way puts the agora back. `round2(subtotal) +
 * round2(vat)` let both halves round up on the same document (₪2,500 off a
 * ₪10,000 bed billed ₪7,500.01 while every screen said ₪7,500.00); rounding
 * the net just once, at the end, instead leaves the discount itself a hair off
 * whenever the exact figure lands on a half-agora boundary.
 *
 * The pre-VAT subtotal is reported as-is and VAT as the remainder, so the
 * printed subtotal + VAT lines still add up to exactly the total.
 */
export function calculateDocumentTotals(items = [], extras = []) {
  const a = documentAnchors(items, extras);

  const total = round2(a.itemsGrossInclVat - a.discountInclVat + a.extrasIncl);
  const subtotal = round2(a.itemsGrossPreVat - a.itemsDiscountPreVat + a.extrasIncl);
  const vat_amount = round2(total - subtotal);

  return { subtotal, discount_total: round2(a.itemsDiscountPreVat), vat_amount, total };
}

/**
 * The rows of the on-screen breakdown, in display order:
 *   סכום לפני מע״מ → מע״מ → סה״כ כולל מע״מ → הנחה כולל מע״מ → סכום לתשלום
 * i.e. the LIST price first, then the discount as a visible subtraction down to
 * what is actually due.
 *
 * `toPay` is the document's own stored total when it has one, so the breakdown
 * always agrees with the figure the customer is billed and the payments are
 * balanced against — including on documents saved before this file existed.
 * The discount is then the gap between list and due, which is exactly what it
 * is, so no row can drift away from the others.
 */
export function summaryRows(items = [], extras = [], storedTotal) {
  const a = documentAnchors(items, extras);

  const grossInclVat = round2(a.itemsGrossInclVat + a.extrasIncl);
  const toPay = Number.isFinite(Number(storedTotal))
    ? round2(storedTotal)
    : calculateDocumentTotals(items, extras).total;
  const discInclVat = round2(grossInclVat - toPay);

  return { itemsGrossPreVat: a.itemsGrossPreVat, grossVat: a.grossVat, grossInclVat, discInclVat, toPay };
}
