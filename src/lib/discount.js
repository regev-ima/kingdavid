/**
 * Per-line discounts on quotes and orders.
 *
 * A line stores its discount as `discount_percent`, but reps mostly think in
 * shekels — "take ₪480 off this bed". Converting ₪ → % and then rounding that
 * percent to two decimals is what used to eat the agorot: ₪480 off a ₪5,480
 * bed became 8.76%, which is ₪480.05, so an order that should have read
 * ₪5,000.00 read ₪4,999.95 instead.
 *
 * So the percent is kept at working precision — nine decimals, exact to the
 * agora far past any price we sell — and is rounded only on its way to the
 * screen. The shekel figure the rep typed is the shekel figure that comes off.
 */

const PERCENT_PRECISION = 1e9; // nine decimals
const AGOROT = 100;

/** Store a discount percent without throwing away the agorot it stands for. */
export function roundDiscountPercent(percent) {
  const n = Number(percent) || 0;
  if (n <= 0) return 0;
  return Math.round(Math.min(n, 100) * PERCENT_PRECISION) / PERCENT_PRECISION;
}

/** The percent that takes exactly `amount` off `base`. */
export function discountPercentFromAmount(amount, base) {
  const total = Number(base) || 0;
  if (total <= 0) return 0;
  const clamped = Math.min(Math.max(Number(amount) || 0, 0), total);
  return roundDiscountPercent((clamped / total) * 100);
}

/** What a stored percent actually takes off `base`, to the agora. */
export function discountAmountOf(percent, base) {
  const amount = ((Number(base) || 0) * (Number(percent) || 0)) / 100;
  return Math.round(amount * AGOROT) / AGOROT;
}

/**
 * Percent for display: two decimals at most, trailing zeros trimmed, so a
 * ₪480-off line reads "8.76%" and not "8.759124088%".
 */
export function formatDiscountPercent(percent) {
  return `${Number((Number(percent) || 0).toFixed(2))}%`;
}

/**
 * Is this a percent a rep could have typed (two decimals or fewer)? A derived
 * one — the leftover of a ₪-amount or final-price entry — is not, and the
 * discount popover reopens on the shekel tab for those, so pressing "החל"
 * again re-applies the same discount instead of a re-rounded one.
 */
export function isTypedPercent(percent) {
  const n = Number(percent) || 0;
  return Math.abs(n - Number(n.toFixed(2))) < 1e-9;
}
