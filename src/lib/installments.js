/**
 * How a card charge splits into instalments.
 *
 * Hyp reports how MANY payments a charge was split into (`hyp_payments_count`)
 * and nothing about their size, so the order screen and the PDF could only say
 * "12 תשלומים" — a number that answers none of the questions a customer asks
 * on the phone. What they want to hear is "₪221 ואז 11 של ₪219".
 *
 * The split is derivable, because Israeli card issuers all round it the same
 * way: every payment after the first is the total floored to whole shekels
 * divided by the count, and the first payment absorbs whatever is left over.
 * Verified against two real charges on this terminal —
 *   ₪2,750 / 12  →  231 + 11 × 229
 *   ₪2,630 / 12  →  221 + 11 × 219
 * — both matching the numbers Hyp itself reported.
 *
 * It is still a derivation, not a quote from the issuer: a plan that puts the
 * remainder on the LAST payment instead of the first would print differently
 * here. If Hyp turns out to send the real figures (see hyp_params on the
 * payment), prefer those and keep this as the fallback.
 */

import { hebrewCount } from '@/lib/hebrewDuration';

/**
 * `{ count, first, rest }` in whole shekels, or null when there is nothing to
 * split — a single payment, an unknown count, or a non-positive amount.
 */
export function splitInstallments(total, count) {
  const n = Math.round(Number(count) || 0);
  const amount = Number(total) || 0;
  if (!Number.isFinite(amount) || amount <= 0 || n < 2) return null;

  const rest = Math.floor(amount / n);
  if (rest <= 0) return null;

  // The first payment carries the remainder, agorot included.
  const first = Math.round((amount - rest * (n - 1)) * 100) / 100;
  return { count: n, first, rest };
}

/** "221 ועוד 11 תשלומים של 219", or '' when there's no split to describe. */
export function formatInstallments(total, count) {
  const split = splitInstallments(total, count);
  if (!split) return '';

  const others = split.count - 1;
  const label = hebrewCount(others, 'תשלום', 'שני תשלומים', 'תשלומים');
  return `${split.first.toLocaleString('he-IL')} ועוד ${label} של ${split.rest.toLocaleString('he-IL')}`;
}
