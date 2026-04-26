/**
 * Safe wrapper around date-fns-tz formatInTimeZone.
 */
export { toZonedTime, fromZonedTime } from 'date-fns-tz';

import { formatInTimeZone as _formatInTimeZone } from 'date-fns-tz';

/**
 * Parse a Postgres timestamp into a JS Date.
 *
 * Postgres returns `timestamp with time zone` columns as e.g. `2026-04-23 14:10:52.628994+00`
 * over PostgREST. The space (instead of `T`) and explicit `+HH`/`+HH:MM` offset (no `Z`) trip up
 * `new Date()` in some browsers, and the previous "if no Z, append Z" hack produced strings like
 * `2026-04-23 14:10:52.628994+00Z` which are flatly invalid.
 *
 * This helper:
 *   1. Replaces the date/time space with `T` so Safari/older engines parse it.
 *   2. Detects an existing timezone marker (`Z`, `+HH`, `+HH:MM`, `-HH`, `-HH:MM`) and only
 *      appends `Z` when none is present.
 *
 * Returns null for empty/invalid input.
 */
export function parseDbTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).replace(' ', 'T');
  const hasTimezone = /[Zz]$|[+-]\d{2}(:?\d{2})?$/.test(s);
  const d = new Date(hasTimezone ? s : s + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

export function formatInTimeZone(date, tz, formatStr, options) {
  try {
    const d = date instanceof Date ? date : (parseDbTimestamp(date) ?? new Date(date));
    if (isNaN(d.getTime())) return '-';
    return _formatInTimeZone(d, tz, formatStr, options);
  } catch {
    return '-';
  }
}
