import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
} from '@/lib/safe-date-fns';

// Resolve a range key (today/week/month/custom) to concrete { start, end }.
// Extracted from the triple-duplicated switch that previously lived in
// Finance.jsx so KPI/overview, commissions, and the report tab all compute
// bounds the same way. `now` is overridable to make this testable.
export function getDateRange(rangeKey, customStart, customEnd, now = new Date()) {
  switch (rangeKey) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'week':
      return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
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
// and custom ranges shift back by their own length.
export function getPreviousDateRange(rangeKey, customStart, customEnd, now = new Date()) {
  switch (rangeKey) {
    case 'today': {
      const yesterday = subDays(now, 1);
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
    }
    case 'week': {
      const lastWeek = subWeeks(now, 1);
      return { start: startOfWeek(lastWeek, { weekStartsOn: 0 }), end: endOfWeek(lastWeek, { weekStartsOn: 0 }) };
    }
    case 'month': {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
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
