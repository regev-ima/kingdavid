// ─────────────────────────────────────────────────────────────────────────────
// Kaveret's TASK export, mapped once.
//
// The lead export names a lead's open tasks in one cell and nothing more. The
// task export is one row per task and carries what a task is:
//
//   תאריך יצירה | תאריך תחילת עבודה | מנהל תיק | סטטוס כרטיס | סטטוס משימה |
//   טלפון | טלפון ראשי | משימה - ליד | שם לקוח | תוכן משימה | ליד id
//
// The judgement calls, so nobody re-derives them per import:
//   • "תאריך תחילת עבודה" is Kaveret's name for WHEN TO DO IT — the task's
//     due date — not when work began. "תאריך יצירה" is the creation stamp.
//   • "טלפון ראשי" is the number that is actually filled; "טלפון" is usually
//     empty, so it is the fallback, not the primary.
//   • "מנהל תיק" is the same rendered blob as on the lead export
//     ("י yonikd01@gmail.com 0502628991 שלוחה xEyIGGq9"); only the address is
//     kept (lib/repEmailExtract.js).
//   • "סטטוס כרטיס" is the LEAD's status at the time, in Kaveret's Hebrew;
//     lib/leadStatusMatch.js turns it into a CRM status key.
//   • "ליד id" exists as a column and is empty in every export seen, which is
//     why the import matches the lead by phone. It is still mapped: a file
//     that fills it gets the stronger match for free.
//   • A task's identity on re-import is its lead + "תאריך יצירה" (to the
//     minute) — the one stamp Kaveret never changes. Text and due date are
//     what a re-run updates, not what it matches on (process_task_import).
//
// A PRESET, not a lock — it fills the dropdowns and the user can still change
// anything before importing.
// ─────────────────────────────────────────────────────────────────────────────

const SIGNATURE_REQUIRED = ['תוכן משימה', 'סטטוס משימה'];
const SIGNATURE_ANY = ['תאריך תחילת עבודה', 'סטטוס כרטיס', 'ליד id', 'משימה - ליד'];

// target field ← exact Kaveret column header
const KAVERET_TASK_COLUMNS = {
  created_at:       'תאריך יצירה',
  due_at:           'תאריך תחילת עבודה',
  rep1:             'מנהל תיק',
  status:           'סטטוס כרטיס',
  task_status:      'סטטוס משימה',
  phone:            'טלפון ראשי',
  phone_alt:        'טלפון',
  full_name:        'שם לקוח',
  summary:          'תוכן משימה',
  external_lead_id: 'ליד id',
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** True when these headers look like a Kaveret task export. */
export function isKaveretTaskExport(headers) {
  const set = new Set(headers.map(norm));
  if (!SIGNATURE_REQUIRED.every((c) => set.has(norm(c)))) return false;
  return SIGNATURE_ANY.some((c) => set.has(norm(c)));
}

/** field key → column index, for the columns this file actually has. */
export function kaveretTaskMapping(headers) {
  const index = new Map();
  headers.forEach((h, i) => {
    const k = norm(h);
    if (!index.has(k)) index.set(k, i);
  });
  const mapping = {};
  for (const [field, column] of Object.entries(KAVERET_TASK_COLUMNS)) {
    const i = index.get(norm(column));
    if (i !== undefined) mapping[field] = i;
  }
  return mapping;
}

/**
 * Kaveret's task-status label → sales_tasks.task_status.
 *
 * Closed: "בוצעה" / "הושלמה", and "לא ניתנת להשלמה" / "בוטלה" — a task Kaveret
 * gave up on is not a to-do, and this CRM has no third state for it.
 * Open: "לא הושלמה", "בביצוע", "מושהית", and anything else.
 */
export function kaveretTaskStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'not_completed';
  if (/^(completed|done|cancelled|canceled)$/i.test(s)) return 'completed';
  // Given up on — closed, before the negation test below reads its "לא".
  if (/לא ניתנ|בוטל|מבוטל/.test(s)) return 'completed';
  // A negation anywhere keeps it open — "לא הושלמה", "לא בוצעה". Tested with
  // explicit whitespace, not \b: JavaScript's word boundary only knows ASCII
  // letters, so \bלא\b never matched inside Hebrew text and every "לא הושלמה"
  // fell through to the "הושלמ" test below and came out completed.
  if (/(^|\s)לא(\s|$)/.test(s)) return 'not_completed';
  if (/בוצע|הושלמ|נסגר/.test(s)) return 'completed';
  return 'not_completed';
}

/**
 * "31/08/2026 16:10" → "2026-08-31 16:10", Israel wall-clock, untouched. The
 * server turns it into an absolute time (AT TIME ZONE 'Asia/Jerusalem'), so
 * the DST rule is Postgres's and not the browser's. A bare date gets 00:00.
 * null when the cell holds nothing a date can be read from.
 */
export function toWallClock(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const hh = (dmy[4] ?? '0').padStart(2, '0');
    const mm = dmy[5] ?? '00';
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')} ${hh}:${mm}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4] ?? '00'}:${iso[5] ?? '00'}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
