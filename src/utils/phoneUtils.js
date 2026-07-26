/**
 * Israeli phone numbers — THE single source of truth for the browser.
 *
 * Import from here. Do not hand-roll `.replace(/\D/g, '')` in a component:
 * this logic used to exist in a dozen near-identical copies scattered across
 * the app, each subtly different, which is exactly how one person ends up
 * stored as several contacts.
 *
 * Canonical form is bare international — `972XXXXXXXXX`. It matches what the
 * Green API chat_id and the 019 SMS gateway already use, and it is the same
 * rule as `public.normalize_il_phone()` in the database
 * (supabase/migrations/20260726000001_lead_import.sql).
 *
 * THREE mirrors of this logic exist and must stay in step, because Edge
 * Functions cannot import frontend source and SQL cannot import either:
 *   1. this file                              — browser
 *   2. supabase/functions/_shared/phone.ts    — Edge Functions (Deno)
 *   3. public.normalize_il_phone()            — database, and the authority:
 *      leads.phone_normalized / customers.phone_normalized are GENERATED from
 *      it, so it decides identity. 1 and 2 only need to agree with it.
 */

/** Digits only, with WhatsApp chat-id suffixes (@c.us / @g.us) stripped first. */
export function phoneDigits(raw) {
  if (raw == null) return '';
  return String(raw).replace(/@[cg]\.us$/, '').replace(/\D/g, '');
}

/**
 * Normalize to `972XXXXXXXXX`. Returns null for empty input.
 *
 * Foreign or malformed numbers fall through to their bare digits rather than
 * null, so identical inputs still match each other instead of every one of
 * them collapsing into a single "unknown" bucket.
 */
export function normalizeIsraeliPhone(phone) {
  let digits = phoneDigits(phone);
  if (!digits) return null;

  // 00972… → 972…
  if (digits.startsWith('00972')) digits = digits.slice(2);

  // Local with a leading zero: 0501234567 / 031234567
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 10) {
    return '972' + digits.slice(1);
  }

  // Already international
  if (digits.startsWith('972') && digits.length >= 11 && digits.length <= 12) {
    return digits;
  }

  // Bare local without the leading zero: 501234567 / 721234567
  if (digits.length === 9 && (digits[0] === '5' || digits[0] === '7')) {
    return '972' + digits;
  }

  return digits;
}

/** Normalize to local form `0XXXXXXXXX` (what people read and dial). */
export function toLocalIsraeliPhone(phone) {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm) return '';
  return norm.startsWith('972') ? '0' + norm.slice(3) : norm;
}

/**
 * Last N digits of the normalized number — the substring every `ilike` lookup
 * matches on, so a query finds the row whichever format it happens to be
 * stored in ("0507864614", "050-786-4614", "+972507864614", "972507864614").
 */
export function phoneTail(phone, n = 9) {
  const norm = normalizeIsraeliPhone(phone);
  return norm ? norm.slice(-n) : '';
}

/**
 * Every shape a number might be stored as, for building an `$or` filter
 * against columns that have not been normalized yet.
 */
export function getPhoneSearchVariants(phone) {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm) return [];
  const variants = new Set([norm]);
  if (norm.startsWith('972')) variants.add('0' + norm.slice(3));
  return [...variants];
}

/** International without the plus — what wa.me and the 019 gateway want. */
export function formatPhoneForWhatsApp(phone) {
  return normalizeIsraeliPhone(phone) || '';
}

/** Green API chat id, or null when the number is too short to be real. */
export function toWhatsAppChatId(phone) {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm || norm.length < 11) return null;
  return `${norm}@c.us`;
}

/** Display form: `050-123-4567`. Falls back to the raw input when unsure. */
export function formatIsraeliPhone(phone) {
  const local = toLocalIsraeliPhone(phone);
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  if (local.length === 9)  return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  return phone == null ? '' : String(phone);
}

/**
 * Is this search query phone-shaped? Decides whether to search the phone
 * column or the name/email ones, and whether a 0-result search should offer
 * "create a new lead with this number".
 *
 * `minDigits` defaults to 7, the shortest Israeli landline (03-XXXXXXX).
 * Lookup screens that match on a partial number pass a lower bound.
 */
export function isPhoneShapedQuery(query, minDigits = 7) {
  return phoneDigits(query).length >= minDigits;
}

/**
 * Strict validation. Accepts local and international, with or without
 * separators:
 *   - Mobile:   5XXXXXXXX      (050-1234567)
 *   - VoIP:     7[2-9]XXXXXXX  (077-1234567)
 *   - Landline: [23489]XXXXXXX (03-1234567)
 */
export function isValidIsraeliPhone(phone) {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm || !norm.startsWith('972')) return false;
  const local = norm.slice(3);
  return /^5\d{8}$/.test(local)        // mobile
      || /^7[2-9]\d{7}$/.test(local)   // VoIP / virtual
      || /^[23489]\d{7}$/.test(local); // landline
}

/**
 * `onChange` filter for phone inputs: keep only digits, "+", spaces and
 * dashes, and hard-cap at 12 digits (the longest valid shape, 9725XXXXXXXX)
 * so the field simply refuses keystrokes past a complete number.
 */
export function sanitizePhoneInput(raw) {
  if (raw == null) return '';
  const cleaned = String(raw).replace(/[^\d+\-\s]/g, '');

  let digitCount = 0;
  let out = '';
  for (const c of cleaned) {
    if (/\d/.test(c)) {
      if (digitCount >= 12) continue;
      digitCount++;
    }
    out += c;
  }
  return out;
}
