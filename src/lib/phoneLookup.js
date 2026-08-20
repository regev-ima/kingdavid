// Finding a lead or a customer by phone number — one implementation, used by
// every screen.
//
// Before this, each caller rolled its own: the lookup panel matched
// `phone ILIKE '%<all digits>%'`, NewQuote/NewOrder matched on the last 9 digits,
// the bulk upload and the convert-to-customer flow compared the raw string, and
// NewLead didn't check at all. All of them are format-sensitive: a row stored as
// "050-1234567" does not contain the substring "501234567" (the separators break
// the run), and one stored as "972501234567" does not contain "0501234567".
//
// `phone_normalized` (972XXXXXXXXX, maintained by a DB trigger on both leads and
// customers) makes the match exact and cheap. The raw-digit search is kept only
// as a fallback for an environment where the migration hasn't run yet — losing a
// match is bad, but a screen that throws on every phone lookup is worse.

import { normalizeIsraeliPhone } from '@/utils/phoneUtils';

export const PHONE_KEY_COLUMN = 'phone_normalized';

// Last N digits — format-independent enough to be a usable fallback.
export function phoneTail(phone, n = 9) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-Math.min(n, digits.length));
}

/** Did normalization produce a real canonical key (not just bare digits)? */
export function canonicalPhoneKey(text) {
  const key = normalizeIsraeliPhone(text);
  return key && key.startsWith('972') && key.length >= 11 ? key : null;
}

const DEFAULT_SELECT = {
  leads: 'id, full_name, phone, email, status, source, rep1, rep2, pending_rep_email, created_date, effective_sort_date',
  customers: 'id, full_name, phone, email, address, city, total_orders, lifetime_value, created_date',
};

/**
 * Every row in `table` whose phone is the same number as `phone`, oldest first
 * (the original record — the one holding the history — comes first).
 * Returns [] for an unusable phone rather than throwing.
 */
async function findByPhone(supabase, table, phone, {
  select = DEFAULT_SELECT[table] || '*',
  limit = 20,
  orderBy = 'created_date',
  ascending = true,
} = {}) {
  const key = normalizeIsraeliPhone(phone);
  if (!key) return [];
  const order = (q) => q.order(orderBy, { ascending, nullsFirst: false }).limit(limit);

  const { data, error } = await order(
    supabase.from(table).select(select).eq(PHONE_KEY_COLUMN, key),
  );
  if (!error) return data || [];

  // Pre-migration environment: fall back to the old substring search rather
  // than leaving the caller with an error it has no way to recover from.
  console.warn(`[phoneLookup] ${table}.${PHONE_KEY_COLUMN} unavailable, falling back to digit search:`, error.message);
  const tail = phoneTail(phone);
  if (tail.length < 7) return [];
  const { data: fallback } = await order(
    supabase.from(table).select(select).ilike('phone', `%${tail}%`),
  );
  return fallback || [];
}

/**
 * Rows in `table` whose FIRST **or SECOND** phone contains the tail of `phone`.
 *
 * Two queries rather than one `phone.ilike.x,phone_2.ilike.x` OR, and that is
 * not a style choice. An unsorted LIMIT lets the planner bet it will find
 * enough matches early and walk the table instead of the index — measured on
 * 125k leads, `phone OR phone_2 … LIMIT 5` came back as a Seq Scan removing
 * 125,602 rows in 75 ms, while the same two conditions asked separately each
 * used their trigram index and answered in 3 ms and 0.06 ms. A single-column
 * condition gives the planner nothing to be clever about.
 *
 * (Searches that sort before they limit are safe with an OR: the sort has to
 * see every match, so the early-exit shortcut is not available and the planner
 * builds a BitmapOr. Those callers keep using `.or()`.)
 *
 * The second-phone query is allowed to fail: in an environment where
 * 20260804000003 hasn't run there is no phone_2 column, and half a result is
 * better than a lookup that throws.
 */
export async function findByPhoneSubstring(supabase, table, phone, {
  select = DEFAULT_SELECT[table] || '*',
  limit = 5,
  secondColumn = 'phone_2',
} = {}) {
  const tail = phoneTail(phone);
  if (!tail) return [];
  const pattern = `%${tail}%`;

  const [primary, secondary] = await Promise.all([
    supabase.from(table).select(select).ilike('phone', pattern).limit(limit),
    supabase.from(table).select(select).ilike(secondColumn, pattern).limit(limit),
  ]);
  if (primary.error) throw primary.error;
  if (secondary.error) {
    console.warn(`[phoneLookup] ${table}.${secondColumn} unavailable:`, secondary.error.message);
  }

  // The same person can hold the number in both fields; the first hit wins so
  // a duplicate never reaches the screen as two results.
  const seen = new Set();
  const merged = [];
  for (const row of [...(primary.data || []), ...(secondary.data || [])]) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged.slice(0, limit);
}

export function findLeadsByPhone(supabase, phone, options) {
  return findByPhone(supabase, 'leads', phone, options);
}

export function findCustomersByPhone(supabase, phone, options) {
  return findByPhone(supabase, 'customers', phone, options);
}

/** The single lead/customer a repeat submission of this number should land on. */
export async function findLeadByPhone(supabase, phone, options) {
  const rows = await findLeadsByPhone(supabase, phone, { ...options, limit: 1 });
  return rows[0] || null;
}

export async function findCustomerByPhone(supabase, phone, options) {
  const rows = await findCustomersByPhone(supabase, phone, { ...options, limit: 1 });
  return rows[0] || null;
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
  if (key) return { [PHONE_KEY_COLUMN]: key };
  const digits = String(text || '').replace(/\D/g, '');
  return { phone: { $regex: digits || String(text || ''), $options: 'i' } };
}

/**
 * Is `phone_normalized` present on this table in this environment's schema?
 * Cached by the caller (it only changes when a migration runs).
 */
export async function probePhoneKey(supabase, table = 'leads') {
  const { error } = await supabase.from(table).select('id').not(PHONE_KEY_COLUMN, 'is', null).limit(1);
  if (!error) return true;
  console.warn(`[phoneLookup] ${table}.${PHONE_KEY_COLUMN} unavailable:`, error.message);
  return false;
}
