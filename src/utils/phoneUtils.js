/**
 * Unified Israeli phone number normalization utility.
 * Converts any Israeli phone format to international format (972XXXXXXXXX).
 *
 * Handles:
 * - Local format: 05X-XXXXXXX, 05XXXXXXXX
 * - International: +972-5X-XXXXXXX, 9725XXXXXXXX
 * - With dashes, spaces, parentheses
 */

/**
 * Normalize an Israeli phone number to international format (972XXXXXXXXX).
 * Returns null if the input is empty or invalid.
 */
export function normalizeIsraeliPhone(phone) {
  if (!phone) return null;

  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, '');

  if (!digits) return null;

  // Local Israeli mobile: 05X... (10 digits)
  if (digits.startsWith('05') && digits.length === 10) {
    return '972' + digits.substring(1);
  }

  // International Israeli mobile: 9725X... (12 digits)
  if (digits.startsWith('9725') && digits.length === 12) {
    return digits;
  }

  // Israeli landline: 0X... (9-10 digits)
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
    return '972' + digits.substring(1);
  }

  // Already international without leading 0 (972X...)
  if (digits.startsWith('972') && digits.length >= 11 && digits.length <= 12) {
    return digits;
  }

  // Fallback: return digits as-is
  return digits;
}

/**
 * Get all phone search variants for finding leads.
 * Returns both local (05X) and international (9725X) formats.
 */
export function getPhoneSearchVariants(phone) {
  if (!phone) return [];

  const digits = phone.replace(/\D/g, '');
  if (!digits) return [];

  const variants = new Set();

  if (digits.startsWith('05') && digits.length === 10) {
    variants.add(digits);                          // 05XXXXXXXX
    variants.add('972' + digits.substring(1));     // 9725XXXXXXXX
  } else if (digits.startsWith('9725') && digits.length === 12) {
    variants.add(digits);                          // 9725XXXXXXXX
    variants.add('0' + digits.substring(3));       // 05XXXXXXXX
  } else if (digits.startsWith('0') && digits.length >= 9) {
    variants.add(digits);
    variants.add('972' + digits.substring(1));
  } else if (digits.startsWith('972') && digits.length >= 11) {
    variants.add(digits);
    variants.add('0' + digits.substring(3));
  } else {
    variants.add(digits);
  }

  return [...variants];
}

/**
 * Format phone for WhatsApp link (international without +).
 */
export function formatPhoneForWhatsApp(phone) {
  const normalized = normalizeIsraeliPhone(phone);
  return normalized || '';
}

/**
 * Heuristic: is this search query "phone-shaped"? Used to decide whether
 * a 0-results search should offer a "create new lead with this phone" CTA.
 * 7 digits is the minimum Israeli landline length (03-XXXXXXX).
 */
export function isPhoneShapedQuery(query) {
  if (!query) return false;
  const digits = String(query).replace(/\D/g, '');
  return digits.length >= 7;
}

/**
 * Strict validation of an Israeli phone number. Accepts both local (0...)
 * and international (+972 / 972...) formats, with or without separators.
 *
 * Valid shapes (after stripping non-digits and the country code / leading 0):
 *   - Mobile:   5XXXXXXXX  (9 digits, e.g. 050-1234567)
 *   - VoIP:     7[2-9]XXXXXXX (9 digits, e.g. 077-1234567)
 *   - Landline: [23489]XXXXXXX (8 digits, e.g. 03-1234567)
 */
export function isValidIsraeliPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return false;

  let local;
  if (digits.startsWith('972')) {
    local = digits.substring(3);
  } else if (digits.startsWith('0')) {
    local = digits.substring(1);
  } else {
    return false;
  }

  if (/^5\d{8}$/.test(local)) return true;       // mobile
  if (/^7[2-9]\d{7}$/.test(local)) return true;  // VoIP / virtual
  if (/^[23489]\d{7}$/.test(local)) return true; // landline
  return false;
}

/**
 * Sanitize raw input into a phone-friendly string: keep only digits, "+",
 * spaces and dashes, and cap at a reasonable length so the user can't
 * keep typing past a valid Israeli number. Used as an `onChange` filter
 * on phone inputs across the app.
 */
export function sanitizePhoneInput(raw) {
  if (raw == null) return '';
  const cleaned = String(raw).replace(/[^\d+\-\s]/g, '');
  // 13 covers "+972XXXXXXXXX" plus a separator. Past that the user is
  // typing nonsense — the keystroke is silently dropped.
  return cleaned.slice(0, 16);
}
