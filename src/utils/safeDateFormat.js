/**
 * Monkey-patch for date-fns format and date-fns-tz formatInTimeZone
 * to prevent RangeError: Invalid time value crashes.
 *
 * Import this once in main.jsx to protect the entire app.
 */
import { format as originalFormat } from 'date-fns';
import { formatInTimeZone as originalFormatInTimeZone } from 'date-fns-tz';

// Override date-fns format to be safe
const safeFormat = (date, formatStr, options) => {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '-';
    return originalFormat(d, formatStr, options);
  } catch {
    return '-';
  }
};

// Override formatInTimeZone to be safe
const safeFormatInTimeZone = (date, tz, formatStr, options) => {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '-';
    return originalFormatInTimeZone(d, tz, formatStr, options);
  } catch {
    return '-';
  }
};

export { safeFormat, safeFormatInTimeZone };
