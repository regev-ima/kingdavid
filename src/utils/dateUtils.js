import { formatInTimeZone } from 'date-fns-tz';

/**
 * Safely parse a date value. Returns null if invalid.
 */
export function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Safe formatInTimeZone - returns fallback string if date is invalid.
 */
export function safeDateFormat(value, format = 'dd/MM/yyyy', fallback = '-') {
  const d = safeDate(value);
  if (!d) return fallback;
  try {
    return formatInTimeZone(d, 'Asia/Jerusalem', format);
  } catch {
    return fallback;
  }
}

/**
 * Safe toLocaleString for dates.
 */
export function safeDateLocale(value, options = {}, fallback = '-') {
  const d = safeDate(value);
  if (!d) return fallback;
  try {
    return d.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', ...options });
  } catch {
    return fallback;
  }
}
