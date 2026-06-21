/**
 * Company "closed days" policy — pure logic, no React.
 *
 * The admin defines, in Settings → "ימי סגירה", when the company is closed so
 * reps can't schedule a task / follow-up on a day the office is shut. Three
 * layers feed the decision:
 *
 *   1. weekly_closed_days — recurring weekdays (e.g. שבת). 0=ראשון … 6=שבת.
 *   2. holidays — pulled live from Hebcal (see useIsraeliHolidays). By default
 *      we're closed on a יום טוב and open חצי-יום on ערב חג until `erev_until`.
 *      A per-date entry in `holiday_overrides` can force open / closed /
 *      half-day for a specific holiday instance.
 *   3. custom_closures — ad-hoc dates the admin adds with a mandatory reason
 *      (יום כיף חברה וכו'). Always closed (or half-day), never "open".
 *
 * `evaluateDate` collapses all three into a single verdict the UI can act on.
 */
import { format, getDay } from '@/lib/safe-date-fns';

// Indexed by getDay() — Sunday is 0, Saturday is 6.
export const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const DEFAULT_CLOSURES = {
  weekly_closed_days: [6], // שבת closed by default
  close_on_holidays: true,
  erev_half_day: true,
  erev_until: '13:00',
  holiday_overrides: {},
  custom_closures: [],
};

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Coerce a raw DB row (or null/undefined) into a safe, fully-populated config
 * object so callers never have to null-check individual fields.
 */
export function normalizeClosures(row) {
  if (!row || typeof row !== 'object') return { ...DEFAULT_CLOSURES, holiday_overrides: {}, custom_closures: [] };
  return {
    weekly_closed_days: Array.isArray(row.weekly_closed_days)
      ? [...new Set(row.weekly_closed_days.map(Number).filter((n) => n >= 0 && n <= 6))]
      : [...DEFAULT_CLOSURES.weekly_closed_days],
    close_on_holidays: row.close_on_holidays !== false,
    erev_half_day: row.erev_half_day !== false,
    erev_until: typeof row.erev_until === 'string' && TIME_RE.test(row.erev_until)
      ? row.erev_until
      : DEFAULT_CLOSURES.erev_until,
    holiday_overrides:
      row.holiday_overrides && typeof row.holiday_overrides === 'object' && !Array.isArray(row.holiday_overrides)
        ? row.holiday_overrides
        : {},
    custom_closures: Array.isArray(row.custom_closures) ? row.custom_closures.filter(Boolean) : [],
  };
}

/** 'yyyy-MM-dd' key for a Date | ISO string. Matches Hebcal's date keys. */
export function dateKey(date) {
  return format(date instanceof Date ? date : new Date(date), 'yyyy-MM-dd');
}

/** 'HH:mm' → minutes since midnight, or null if unparseable. */
export function parseTimeToMinutes(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * The "default" holiday verdict before any per-date override — derived purely
 * from the calendar entries + the two global toggles. Used both by the
 * Settings UI (to know whether a control sits at its default) and by
 * evaluateDate.
 */
export function holidayDefaultStatus(items, config) {
  const cfg = config || DEFAULT_CLOSURES;
  const list = Array.isArray(items) ? items : [];
  const yomTov = list.find((h) => h && h.isYomTov);
  const erev = list.find((h) => h && h.isErev);
  if (yomTov && cfg.close_on_holidays) return { status: 'closed', until: null, holiday: yomTov };
  if (erev && cfg.erev_half_day) return { status: 'half_day', until: cfg.erev_until, holiday: erev };
  return { status: 'open', until: null, holiday: list[0] || null };
}

/**
 * Single source of truth: is `date` open, closed, or a half day?
 * Returns { status: 'open'|'closed'|'half_day', until, reason, label }.
 *
 * Precedence: custom closure → holiday override → holiday default →
 * weekly recurring → open.
 */
export function evaluateDate(date, config, holidaysByDate = {}) {
  const cfg = config || DEFAULT_CLOSURES;
  const d = date instanceof Date ? date : new Date(date);
  const key = dateKey(d);
  const dow = getDay(d);

  // 1. Ad-hoc closure the admin added (always carries a reason).
  const custom = (cfg.custom_closures || []).find((c) => c && c.date === key);
  if (custom) {
    if (custom.type === 'half_day') {
      return {
        status: 'half_day',
        until: custom.until || cfg.erev_until,
        reason: custom.reason || '',
        label: custom.reason || 'חצי יום',
      };
    }
    return { status: 'closed', until: null, reason: custom.reason || '', label: custom.reason || 'סגור' };
  }

  const holidayItems = holidaysByDate[key] || [];
  const holidayName = holidayItems.length ? holidayItems[0].hebrew || holidayItems[0].title : '';

  // 2. Explicit per-holiday override for this exact date.
  const override = cfg.holiday_overrides ? cfg.holiday_overrides[key] : null;
  if (override && override.status) {
    if (override.status === 'open') return { status: 'open', until: null, reason: null, label: holidayName };
    if (override.status === 'half_day') {
      return { status: 'half_day', until: override.until || cfg.erev_until, reason: holidayName, label: holidayName };
    }
    return { status: 'closed', until: null, reason: holidayName, label: holidayName };
  }

  // 3. Holiday defaults from the calendar.
  if (holidayItems.length) {
    const def = holidayDefaultStatus(holidayItems, cfg);
    if (def.status !== 'open') {
      const name = def.holiday?.hebrew || def.holiday?.title || holidayName;
      return { status: def.status, until: def.until, reason: name, label: name };
    }
  }

  // 4. Weekly recurring closed day (e.g. שבת).
  if ((cfg.weekly_closed_days || []).includes(dow)) {
    return { status: 'closed', until: null, reason: `סגור בימי ${WEEKDAY_LABELS[dow]}`, label: WEEKDAY_LABELS[dow] };
  }

  return { status: 'open', until: null, reason: null, label: holidayName };
}

/** Convenience: is the whole day blocked for scheduling? */
export function isDateClosed(date, config, holidaysByDate) {
  return evaluateDate(date, config, holidaysByDate).status === 'closed';
}

/**
 * Is a specific time blocked? Closed days block everything; half days block
 * any time at/after the cutoff.
 */
export function isDateTimeBlocked(date, hour, minute, config, holidaysByDate) {
  const ev = evaluateDate(date, config, holidaysByDate);
  if (ev.status === 'closed') return true;
  if (ev.status === 'half_day' && ev.until) {
    const cutoff = parseTimeToMinutes(ev.until);
    if (cutoff != null && hour * 60 + (minute || 0) >= cutoff) return true;
  }
  return false;
}
