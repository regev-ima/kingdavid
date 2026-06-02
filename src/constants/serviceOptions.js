// Shared vocabulary for the Service Center (מרכז שירות). Kept in one place so
// the rep dialogs, the public self-service form, the list/detail screens, and
// the import all speak the same language and render the same colours.

// ── Request type / warranty classification ────────────────────────────────
// The three buckets the customer (or rep) picks during intake.
export const REQUEST_TYPE_OPTIONS = [
  {
    value: 'general',
    label: 'פנייה כללית',
    description: 'שאלה או בקשה כללית — ללא היבט אחריות',
    emoji: '💬',
    chip: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
  },
  {
    value: 'trial_30d',
    label: 'במסגרת 30 ימי ניסיון',
    description: 'הפנייה בתוך תקופת 30 ימי ההתנסות במוצר',
    emoji: '🛏️',
    chip: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  },
  {
    value: 'warranty',
    label: 'במסגרת אחריות מוצר',
    description: 'אחריות ארוכת-טווח (למשל מזרן עם 10 שנות אחריות)',
    emoji: '🛡️',
    chip: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
  },
];

export const REQUEST_TYPE_LABELS = Object.fromEntries(
  REQUEST_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

// ── Ticket status workflow ────────────────────────────────────────────────
export const SERVICE_STATUS_OPTIONS = [
  { value: 'open', label: 'פתוחה', chip: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  { value: 'in_progress', label: 'בטיפול', chip: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  { value: 'waiting_customer', label: 'ממתין ללקוח', chip: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200' },
  { value: 'waiting_parts', label: 'ממתין לחלקים/מפעל', chip: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  { value: 'resolved', label: 'נפתרה', chip: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200' },
  { value: 'closed', label: 'סגורה', chip: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
];

export const SERVICE_STATUS_LABELS = Object.fromEntries(
  SERVICE_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

export const SERVICE_STATUS_CHIP = Object.fromEntries(
  SERVICE_STATUS_OPTIONS.map((o) => [o.value, o.chip]),
);

export const OPEN_SERVICE_STATUSES = ['open', 'in_progress', 'waiting_customer', 'waiting_parts'];

// ── Priority + SLA ────────────────────────────────────────────────────────
export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'נמוך', slaHours: 72 },
  { value: 'medium', label: 'בינוני', slaHours: 48 },
  { value: 'high', label: 'גבוה', slaHours: 24 },
  { value: 'urgent', label: 'דחוף', slaHours: 4 },
];

export const SLA_HOURS = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.slaHours]));

export const PRIORITY_LABELS = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label]));

// ── Source (who opened the ticket) ────────────────────────────────────────
export const SOURCE_OPTIONS = [
  { value: 'agent_manual', label: 'נפתחה ע״י נציג', emoji: '🧑‍💼', chip: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  { value: 'customer_self', label: 'נפתחה ע״י הלקוח', emoji: '🙋', chip: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  { value: 'imported', label: 'מיובאת', emoji: '📦', chip: 'bg-stone-100 text-stone-600 ring-1 ring-stone-200' },
];

export const SOURCE_LABELS = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]));
export const SOURCE_CHIP = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.chip]));

// ── Diagnostic questions ──────────────────────────────────────────────────
// A small, ordered set of the questions the service team needs to understand a
// fault. Answers are stored in support_tickets.issue_answers as
// { [key]: value }. Generic enough for mattresses/beds/furniture; the team can
// extend this list later.
export const DIAGNOSTIC_QUESTIONS = [
  { key: 'product', label: 'באיזה מוצר מדובר?', type: 'text', placeholder: 'למשל: מזרן קפיצים מבודדים 160/200' },
  { key: 'problem_summary', label: 'מה הבעיה בקצרה?', type: 'text', placeholder: 'תארו את התקלה' },
  {
    key: 'problem_area',
    label: 'היכן ממוקמת הבעיה?',
    type: 'select',
    options: ['מרכז המוצר', 'צד ימין', 'צד שמאל', 'פינה', 'לאורך כל המוצר', 'אחר'],
  },
  {
    key: 'when_started',
    label: 'מתי התחילה הבעיה?',
    type: 'select',
    options: ['בימים האחרונים', 'בחודש האחרון', 'לפני מספר חודשים', 'לפני שנה ויותר'],
  },
  { key: 'notes', label: 'פרטים נוספים שיעזרו לנו', type: 'textarea', placeholder: 'כל מידע נוסף' },
];

// Standard contact-preference choices for the public form.
export const CONTACT_PREFERENCE_OPTIONS = [
  { value: 'phone', label: 'שיחת טלפון' },
  { value: 'whatsapp', label: 'וואטסאפ' },
  { value: 'email', label: 'אימייל' },
];

// ── Helpers ───────────────────────────────────────────────────────────────

// Strip everything but digits, then normalise to local Israeli form so any
// stored variant ("0537772829", "053-777-2829", "+972537772829") matches.
export function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

// 019 / international format: 972XXXXXXXXX (no plus, no leading zero).
export function toInternationalPhone(raw) {
  const local = normalizePhone(raw);
  if (!local) return '';
  return local.startsWith('0') ? '972' + local.slice(1) : local;
}

// Next ticket number given the most-recent ticket (TKT#### sequence).
export function nextTicketNumber(lastTicketNumber) {
  const lastNum = parseInt(String(lastTicketNumber || '').replace(/\D/g, '') || '1000', 10);
  return `TKT${lastNum + 1}`;
}

// Tag stamped on orders brought in through the import (shown in /Orders + /OrderDetails).
export const IMPORTED_ORDER_TAG = 'הזמנה מיובאת';
