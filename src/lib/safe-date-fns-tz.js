/**
 * Safe wrapper around date-fns-tz formatInTimeZone.
 */
export { toZonedTime, fromZonedTime } from 'date-fns-tz';

import { formatInTimeZone as _formatInTimeZone } from 'date-fns-tz';

export function formatInTimeZone(date, tz, formatStr, options) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '-';
    return _formatInTimeZone(d, tz, formatStr, options);
  } catch {
    return '-';
  }
}
