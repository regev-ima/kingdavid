// Canonical phone key for lead matching, server side.
//
// Every ingestion path (webhook, sheet import, file upload) used to look for an
// existing lead with `.eq('phone', raw)` — an exact string compare — so the same
// customer arriving as "050-1234567", "0501234567" and "+972501234567" produced
// three leads. Match on the canonical key instead.
//
// Keep in sync with:
//   • normalizeIsraeliPhone() in src/utils/phoneUtils.js  (client)
//   • normalize_il_phone()    in the leads_phone_normalized migration (DB)
// The DB trigger is what actually fills leads.phone_normalized; this module is
// for computing the key to search BY.

export function normalizeIsraeliPhone(phone: unknown): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('05') && digits.length === 10) return '972' + digits.substring(1);
  if (digits.startsWith('9725') && digits.length === 12) return digits;
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) return '972' + digits.substring(1);
  if (digits.startsWith('972') && digits.length >= 11 && digits.length <= 12) return digits;
  return digits;
}

/**
 * Find the existing lead for a phone number, matching on the canonical key.
 *
 * Falls back to the old raw-string compare if `phone_normalized` isn't in the
 * schema yet (function deployed before its migration) — a weaker match is far
 * better than an ingestion endpoint that 400s on every call.
 */
export async function findLeadByPhone(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rawPhone: unknown,
  select = '*',
) {
  const key = normalizeIsraeliPhone(rawPhone);
  if (!key) return null;

  const { data, error } = await supabase
    .from('leads')
    .select(select)
    .eq('phone_normalized', key)
    // Oldest first: the original record is the one that owns the history, so
    // repeat submissions update it instead of the newest copy.
    .order('created_date', { ascending: true, nullsFirst: false })
    .limit(1);

  if (!error) return data?.length ? data[0] : null;

  console.warn('[phone] phone_normalized lookup failed, falling back to raw match:', error.message);
  const { data: raw } = await supabase
    .from('leads')
    .select(select)
    .eq('phone', String(rawPhone))
    .limit(1);
  return raw?.length ? raw[0] : null;
}

/**
 * Canonical keys for a batch of raw phones → the leads that already exist for
 * them, as a Map keyed by the canonical form. One round-trip for a whole import
 * batch instead of a query per row.
 */
export async function fetchLeadsByPhones(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rawPhones: unknown[],
  select = 'id, phone, phone_normalized, notes, unique_id, created_date',
) {
  const keys = [...new Set(rawPhones.map(normalizeIsraeliPhone).filter(Boolean) as string[])];
  const byKey = new Map<string, Record<string, unknown>>();
  if (!keys.length) return byKey;

  // Chunked so a large import doesn't build a URL the gateway rejects.
  const CHUNK = 200;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('leads')
      .select(select)
      .in('phone_normalized', slice)
      .order('created_date', { ascending: true, nullsFirst: false });
    if (error) {
      console.warn('[phone] batch phone_normalized lookup failed:', error.message);
      return byKey; // caller falls back to its own per-row handling
    }
    for (const row of data || []) {
      const k = String((row as { phone_normalized?: string }).phone_normalized || '');
      // First (oldest) wins — see findLeadByPhone.
      if (k && !byKey.has(k)) byKey.set(k, row);
    }
  }
  return byKey;
}
