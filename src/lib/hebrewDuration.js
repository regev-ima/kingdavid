/**
 * Hebrew durations — counting units and saying how long ago something was.
 *
 * Hebrew has a dual form (יומיים, שעתיים, שבועיים), so "2 ימים" is wrong in a
 * way "2 days" never is. Everything on the lead screen that prints an age or
 * an elapsed time goes through here, so the forms stay right in one place
 * instead of being re-derived per card.
 */

import { differenceInDays } from '@/lib/safe-date-fns';

// Hebrew counter with proper singular / dual / plural forms
// (e.g. 1 → "יום", 2 → "יומיים", 3 → "3 ימים").
export function hebrewCount(n, one, two, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${many}`;
}

// Join Hebrew list parts with commas and a final "ו" conjunction:
// ["3 חודשים","2 שבועות","5 ימים"] → "3 חודשים, 2 שבועות ו-5 ימים".
export function joinHebrewParts(parts) {
  if (parts.length === 0) return 'פחות מיום';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const conj = /^\d/.test(last) ? 'ו-' : 'ו'; // "ו-5 ימים" vs "ויומיים"
  return `${parts.slice(0, -1).join(', ')} ${conj}${last}`;
}

// Lead age as a single cascading breakdown that adds back up to the total
// day count — e.g. a 109-day-old lead reads "3 חודשים, 2 שבועות ו-5 ימים",
// NOT three independent totals. Uses round 30-day months / 7-day weeks so
// the parts always sum to the days; zero-valued units are dropped.
export function formatLeadAge(createdDate) {
  const created = createdDate instanceof Date ? createdDate : new Date(createdDate);
  if (isNaN(created.getTime())) return '-';

  let remaining = Math.max(0, differenceInDays(new Date(), created));
  const months = Math.floor(remaining / 30); remaining -= months * 30;
  const weeks = Math.floor(remaining / 7); remaining -= weeks * 7;
  const days = remaining;

  const parts = [];
  if (months > 0) parts.push(hebrewCount(months, 'חודש', 'חודשיים', 'חודשים'));
  if (weeks > 0) parts.push(hebrewCount(weeks, 'שבוע', 'שבועיים', 'שבועות'));
  if (days > 0) parts.push(hebrewCount(days, 'יום', 'יומיים', 'ימים'));
  return joinHebrewParts(parts);
}

/**
 * "לפני כמה זמן" in one short phrase — the coarsest unit that still says
 * something useful, never a breakdown. A timestamp answers "when"; this
 * answers "is that recent?", which is the question a rep actually asks about
 * the last time anyone spoke to a lead.
 */
export function hebrewTimeAgo(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 0) return 'עכשיו'; // clock skew — don't print "לפני -2 דקות"
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `לפני ${hebrewCount(minutes, 'דקה', 'שתי דקות', 'דקות')}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hebrewCount(hours, 'שעה', 'שעתיים', 'שעות')}`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `לפני ${hebrewCount(days, 'יום', 'יומיים', 'ימים')}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `לפני ${hebrewCount(months, 'חודש', 'חודשיים', 'חודשים')}`;

  const years = Math.floor(months / 12);
  return `לפני ${hebrewCount(years, 'שנה', 'שנתיים', 'שנים')}`;
}
