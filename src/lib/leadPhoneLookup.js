// Finding a lead by phone number — one implementation, used by every screen.
//
// Before this, each caller rolled its own: the lookup panel matched
// `phone ILIKE '%<all digits>%'`, NewQuote/NewOrder matched on the last 9 digits,
// the bulk upload compared the raw string, and NewLead didn't check at all. All
// of them are format-sensitive: a lead stored as "050-1234567" doesn't contain
// the substring "501234567" (the separators break the run), and one stored as
// "972501234567" doesn't contain "0501234567".
//
// leads.phone_normalized (972XXXXXXXXX, maintained by a DB trigger) makes this
// exact and cheap. The raw-digit search is kept only as a fallback for an
// environment where the migration hasn't run yet — losing a match is bad, but a
// screen that throws on every phone lookup is worse.

import { normalizeIsraeliPhone } from '@/utils/phoneUtils';

export const LEAD_PHONE_COLUMN = 'phone_normalized';

// Last N digits — format-independent enough to be a usable fallback.
export function phoneTail(phone, n = 9) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-Math.min(n, digits.length));
}

const DEFAULT_SELECT = 'id, full_name, phone, email, status, source, rep1, rep2, pending_rep_email, created_date, effective_sort_date';

/**
 * Every lead whose phone is the same number as `phone`, oldest first (the
 * original record — the one holding the history — comes first).
 * Returns [] for an unusable phone rather than throwing.
 */
export async function findLeadsByPhone(
  supabase,
  phone,
  { select = DEFAULT_SELECT, limit = 20, orderBy = 'created_date', ascending = true } = {},
) {
  const key = normalizeIsraeliPhone(phone);
  if (!key) return [];
  const order = (q) => q.order(orderBy, { ascending, nullsFirst: false }).limit(limit);

  const { data, error } = await order(
    supabase.from('leads').select(select).eq(LEAD_PHONE_COLUMN, key),
  );
  if (!error) return data || [];

  // Pre-migration environment: fall back to the old substring search rather
  // than leaving the caller with an error it has no way to recover from.
  console.warn(`[leadPhoneLookup] ${LEAD_PHONE_COLUMN} unavailable, falling back to digit search:`, error.message);
  const tail = phoneTail(phone);
  if (tail.length < 7) return [];
  const { data: fallback } = await order(
    supabase.from('leads').select(select).ilike('phone', `%${tail}%`),
  );
  return fallback || [];
}

/** The lead a repeat submission of this number should land on, or null. */
export async function findLeadByPhone(supabase, phone, options) {
  const rows = await findLeadsByPhone(supabase, phone, { ...options, limit: 1 });
  return rows[0] || null;
}

/** Did normalization produce a real canonical key (not just bare digits)? */
export function canonicalPhoneKey(text) {
  const key = normalizeIsraeliPhone(text);
  return key && key.startsWith('972') && key.length >= 11 ? key : null;
}

/**
 * Filter fragment for a phone search inside an existing query object
 * (LeadManagement's buildLeadsQuery shape). Matches the canonical key when the
 * text is a complete Israeli number, and otherwise falls back to a substring
 * match on the raw column so partial input ("054") still searches.
 *
 * `canonical: false` forces the raw form — for an environment where the
 * phone_normalized migration hasn't run yet, since a filter on a column that
 * doesn't exist fails the whole request.
 */
export function leadPhoneFilter(text, { canonical = true } = {}) {
  const key = canonical ? canonicalPhoneKey(text) : null;
  if (key) return { [LEAD_PHONE_COLUMN]: key };
  const digits = String(text || '').replace(/\D/g, '');
  return { phone: { $regex: digits || String(text || ''), $options: 'i' } };
}

/**
 * Is `phone_normalized` present in this environment's schema? Cached for the
 * page's lifetime — it only changes when a migration runs.
 */
export async function probeLeadPhoneKey(supabase) {
  const { error } = await supabase.from('leads').select('id').not(LEAD_PHONE_COLUMN, 'is', null).limit(1);
  if (!error) return true;
  console.warn(`[leadPhoneLookup] ${LEAD_PHONE_COLUMN} unavailable:`, error.message);
  return false;
}
