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
