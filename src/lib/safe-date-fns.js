/**
 * Safe re-export of date-fns with format() wrapped to prevent
 * "RangeError: Invalid time value" crashes from bad date data.
 */
export {
  addDays, addHours, addMinutes, addMonths, addWeeks,
  subDays, subMonths, subWeeks,
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear,
  differenceInDays, differenceInHours, differenceInMinutes, differenceInBusinessDays,
  isAfter, isBefore, isValid, isPast, isToday, isSameDay, isWithinInterval,
  parseISO, formatDistanceToNow,
  getDay, getMonth, getYear,
  setHours, setMinutes,
  eachDayOfInterval,
} from 'date-fns';

import { format as _format } from 'date-fns';

export function format(date, formatStr, options) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '-';
    return _format(d, formatStr, options);
  } catch {
    return '-';
  }
}
