/**
 * Israeli phone numbers — THE single source of truth for Edge Functions.
 *
 * Deno cannot import frontend source, so this is a hand-kept mirror of
 * src/utils/phoneUtils.js. Both mirror `public.normalize_il_phone()` in the
 * database (supabase/migrations/20260726000001_lead_import.sql), which is the
 * authority: leads.phone_normalized / customers.phone_normalized are
 * GENERATED from it, so it is what actually decides contact identity.
 *
 * Change one, change all three.
 */

/** Digits only, with WhatsApp chat-id suffixes (@c.us / @g.us) stripped first. */
export function phoneDigits(raw: string | null | undefined): string {
  if (raw == null) return '';
  return String(raw).replace(/@[cg]\.us$/, '').replace(/\D/g, '');
}

/**
 * Normalize to `972XXXXXXXXX`. Returns null for empty input.
 *
 * Foreign or malformed numbers fall through to their bare digits rather than
 * null, so identical inputs still match each other.
 */
export function normalizeIsraeliPhone(phone: string | null | undefined): string | null {
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

/** Normalize to local form `0XXXXXXXXX`. */
export function toLocalIsraeliPhone(phone: string | null | undefined): string {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm) return '';
  return norm.startsWith('972') ? '0' + norm.slice(3) : norm;
}

/** Last N digits of the normalized number — the `ilike` lookup key. */
export function phoneTail(phone: string | null | undefined, n = 9): string {
  const norm = normalizeIsraeliPhone(phone);
  return norm ? norm.slice(-n) : '';
}

/** Green API chat id, or null when the number is too short to be real. */
export function toWhatsAppChatId(phone: string | null | undefined): string | null {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm || norm.length < 11) return null;
  return `${norm}@c.us`;
}

/**
 * Every shape a number might be stored as, for matching against columns that
 * have not been normalized yet (leads.phone predates phone_normalized and
 * still holds whatever each import path happened to write).
 */
export function phoneSearchVariants(phone: string | null | undefined): string[] {
  const norm = normalizeIsraeliPhone(phone);
  if (!norm) return [];
  const variants = new Set<string>([norm]);
  if (norm.startsWith('972')) variants.add('0' + norm.slice(3));
  return [...variants];
}
