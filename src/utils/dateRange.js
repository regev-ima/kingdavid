import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  subDays,
  subWeeks,
  subMonths,
} from '@/lib/safe-date-fns';

// Resolve a range key to concrete { start, end }.
// Extracted from the triple-duplicated switch that previously lived in
// Finance.jsx so KPI/overview, commissions, and the report tab all compute
// bounds the same way. `now` is overridable to make this testable.
// Supports: today, yesterday, week, month, 90days, year, custom.
export function getDateRange(rangeKey, customStart, customEnd, now = new Date()) {
  switch (rangeKey) {
    case 'all':
      // Everything up to now — lets the Orders page default to the full
      // (non-empty) list while still flowing through the same range plumbing.
      return { start: new Date(0), end: endOfDay(now) };
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'yesterday': {
      const y = subDays(now, 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case 'week':
      return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case '90days':
      return { start: startOfDay(subDays(now, 89)), end: endOfDay(now) };
    case 'year':
      return { start: startOfYear(now), end: endOfDay(now) };
    case 'custom':
      return {
        start: customStart ? new Date(customStart) : startOfMonth(now),
        end: customEnd ? new Date(customEnd) : endOfMonth(now),
      };
    default:
      return { start: startOfMonth(now), end: endOfMonth(now) };
  }
}

// Mirror the current period one step into the past so KPI cards can show a
// like-for-like delta. today→yesterday, week→last week, month→last month,
// year→year-to-date one year ago. Sliding ranges (90days, custom) shift
// back by their own length.
export function getPreviousDateRange(rangeKey, customStart, customEnd, now = new Date()) {
  switch (rangeKey) {
    case 'today': {
      const yesterday = subDays(now, 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    }
    case 'yesterday': {
      const dayBeforeYesterday = subDays(now, 2);
      return { start: startOfDay(dayBeforeYesterday), end: endOfDay(dayBeforeYesterday) };
    }
    case 'week': {
      const lastWeek = subWeeks(now, 1);
      return { start: startOfWeek(lastWeek, { weekStartsOn: 0 }), end: endOfWeek(lastWeek, { weekStartsOn: 0 }) };
    }
    case 'month': {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case '90days': {
      const current = getDateRange('90days', null, null, now);
      const length = current.end.getTime() - current.start.getTime();
      const prevEnd = new Date(current.start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - length);
      return { start: prevStart, end: prevEnd };
    }
    case 'year': {
      // Year-to-date last year: same length back, ending at start - 1ms.
      const current = getDateRange('year', null, null, now);
      const length = current.end.getTime() - current.start.getTime();
      const prevEnd = new Date(current.start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - length);
      return { start: prevStart, end: prevEnd };
    }
    case 'custom': {
      const current = getDateRange('custom', customStart, customEnd, now);
      const length = current.end.getTime() - current.start.getTime();
      const prevEnd = new Date(current.start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - length);
      return { start: prevStart, end: prevEnd };
    }
    default: {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
  }
}
