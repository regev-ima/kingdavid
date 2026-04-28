import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';

// A re-submission of an existing lead bumps `effective_sort_date` to "now"
// (see supabase/functions/upsertLead and friends). When that happens we want:
//   1. The SLA timer to restart from the latest touch — a 528-day-old lead
//      that came back this morning should display "5 דקות", not "528 ימים".
//   2. A visible "🔁 פניה חוזרת" indicator so reps can tell at a glance that
//      this isn't a brand-new lead — it's an old one that re-engaged.
//
// Threshold for "this lead returned" is 24h: anything shorter is the same
// initial-creation flow with minor late updates and shouldn't count.
const RETURN_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * The timestamp the SLA clock should anchor to. For a fresh lead this is
 * just `created_date`; for a returning lead it's the bumped
 * `effective_sort_date`.
 */
export function getLeadSlaAnchor(lead) {
  const effective = parseDbTimestamp(lead?.effective_sort_date);
  const created = parseDbTimestamp(lead?.created_date);
  if (effective && created) return effective > created ? effective : created;
  return effective || created || null;
}

/**
 * True when the lead's `effective_sort_date` is meaningfully later than its
 * `created_date` — i.e. it was re-submitted / re-engaged after creation.
 */
export function isReturningLead(lead) {
  const effective = parseDbTimestamp(lead?.effective_sort_date);
  const created = parseDbTimestamp(lead?.created_date);
  if (!effective || !created) return false;
  return effective.getTime() - created.getTime() > RETURN_GAP_MS;
}

/**
 * True when the rep already acted on the lead AT OR AFTER the most recent
 * touch. A returning lead therefore stops counting as "handled" until the
 * rep re-engages — that's the whole point of resetting the SLA on return.
 */
export function isLeadHandled(lead) {
  const handled = parseDbTimestamp(lead?.first_action_at);
  if (!handled) return false;
  const lastTouch = getLeadSlaAnchor(lead);
  if (!lastTouch) return true;
  return handled.getTime() >= lastTouch.getTime();
}
