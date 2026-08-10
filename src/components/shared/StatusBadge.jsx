import React from 'react';
import { useStatusColors } from '@/hooks/useStatusColors';
import { getStatusColorPreset } from '@/constants/statusColors';

const statusConfig = {
  // Lead Status
  new_lead: { label: 'ליד חדש', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  hot_lead: { label: 'ליד רותח', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  followup_before_quote: { label: 'פולאפ - לפני הצעה', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  followup_after_quote: { label: 'פולאפ - אחרי הצעת מחיר', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  coming_to_branch: { label: 'יגיע לסניף לפגישה', color: 'bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200' },
  no_answer_1: { label: 'ללא מענה 1', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  no_answer_2: { label: 'ללא מענה 2', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  no_answer_3: { label: 'ללא מענה 3', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  no_answer_4: { label: 'ללא מענה 4', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  no_answer_5: { label: 'ללא מענה 5', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  no_answer_whatsapp_sent: { label: 'ללא מענה - נשלח ווטסאפ', color: 'bg-green-100 text-green-700 ring-1 ring-green-200' },
  no_answer_calls: { label: 'אין מענה - חיוגים', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  changed_direction: { label: 'שנה כיוון לליד', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  deal_closed: { label: 'נסגרה עסקה', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  not_relevant_duplicate: { label: 'לא רלוונטי - ליד כפול', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  mailing_remove_request: { label: 'דיוור חוזר - ביקש להסיר', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  lives_far_phone_concern: { label: 'גר רחוק - חושש מקנייה בטלפון', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  products_not_available: { label: 'מחפש מוצרים שלא קיימים בחברה', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  not_relevant_bought_elsewhere: { label: 'לא רלוונטי - רכש במקום אחר', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  not_relevant_1000_nis: { label: 'לא רלוונטי - מחפש מזרן ב 1000 שח', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  not_relevant_denies_contact: { label: 'לא רלוונטי - מכחיש פניה', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  not_relevant_service: { label: 'לא רלוונטי שירות', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  not_interested_hangs_up: { label: 'לא מעוניין לדבר - מנתק', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  not_relevant_no_explanation: { label: 'לא רלוונטי לא מסביר למה', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  heard_price_not_interested: { label: 'שמע מחיר ולא מעוניין לשמוע עוד', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  not_relevant_wrong_number: { label: 'לא רלוונטי - מספר שגוי', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  closed_by_manager_to_mailing: { label: 'נסגר ע"י מנהל - הועבר לדיוור', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },

  // Statuses introduced by the 2026-04-26 lead-status normalization migration.
  // Without these the badge renders the raw English key ("will_arrive_for_meeting").
  will_arrive_for_meeting: { label: 'יגיע לסניף לפגישה', color: 'bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200' },
  second_line_lead: { label: 'ליד קו שני', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  manager_call_potential_close: { label: 'שיחת מנהל - פוטנציאל לסגירה', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  transferred_by_manager_for_followup: { label: 'הועבר ע"י מנהל - להמשך טיפול', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  call_from_google: { label: 'שיחה מגוגל', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  call_from_facebook: { label: 'שיחה מפייסבוק', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  already_purchased_inquiry: { label: 'כבר רכש - פניה לבירור', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  system_test: { label: 'בדיקת מערכת', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  return_to_followup: { label: 'לחזור לפולואפ', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  no_answer_8_calls: { label: 'אין מענה - 8 חיוגים', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  not_relevant_not_mature: { label: 'לא רלוונטי - ליד לא בשל', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  service_handled: { label: 'שירות לקוחות - טופל', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  service_30_nights_trial: { label: 'שירות - 30 לילות ניסיון', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  service_30_nights_trial_handled: { label: 'שירות - 30 לילות ניסיון טופל', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  service_warranty: { label: 'שירות - תעודת אחריות', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  service_warranty_handled: { label: 'שירות - תעודת אחריות טופל', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  service_cancellations: { label: 'שירות - ביטולים', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  service_cancellations_handled: { label: 'שירות - ביטולים טופל', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  service_missing_items: { label: 'שירות - חוסרים בהזמנה', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  service_missing_items_handled: { label: 'שירות - חוסרים בהזמנה טופל', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  delivery_inquiry: { label: 'בירור אספקה', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  delivery_inquiry_handled: { label: 'בירור אספקה - טופל', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },

  // ── Lead-status palette ───────────────────────────────────────────────────
  // Applied below, after this object, so the colour of a lead status is decided
  // by the group it belongs to rather than typed 49 times by hand. Adding a
  // status means putting it in a group; forgetting to means it keeps whatever
  // colour it was declared with above, never an unstyled badge.
  //
  // Colour answers one question on a busy screen — "is this lead in play?" —
  // and the label answers the rest. That is why every terminal status shares
  // one grey: "לא רלוונטי - ליד כפול" and "שמע מחיר ולא מעוניין" call for the
  // same action, which is none, and giving them separate colours spends the
  // reader's attention on a distinction they cannot act on.
  //
  // The one rule the old palette broke: red now means exactly one thing, a
  // lead worth calling right now. It used to also mean "ללא מענה 5" and
  // "שמע מחיר ולא מעוניין" — three unrelated meanings competing for the
  // loudest colour on the screen.

  // Task Status
  not_completed: { label: 'ממתין לביצוע', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  completed: { label: 'בוצע', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  not_done: { label: 'לא בוצע', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  cancelled: { label: 'בוטל', color: 'bg-gray-800 text-white ring-1 ring-gray-900' },

  // Pipeline Stage
  first_contact: { label: 'קשר ראשון', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  follow_up: { label: 'מעקב', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  quote_build: { label: 'בניית הצעה', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  waiting_payment: { label: 'ממתין לתשלום', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  closed_won: { label: 'נסגר בהצלחה', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  closed_lost: { label: 'נסגר ללא הצלחה', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  
  // Production Status
  not_started: { label: 'בתור לייצור', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  in_production: { label: 'ייצור', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  ready: { label: 'מוכן', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  // Legacy values: render under the consolidated "ייצור" stage so old rows still display.
  // `new` is the DB default on freshly-created orders — without this entry the
  // production-status column on the Orders list literally read "new" in English.
  new: { label: 'חדש', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  materials_check: { label: 'ייצור', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  qc: { label: 'ייצור', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  
  // Delivery Status
  need_scheduling: { label: 'לתאום', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  // Self pickup: the goods wait at the factory for the customer, so this never
  // enters the scheduling queue or a delivery route.
  awaiting_pickup: { label: 'ממתין לאיסוף', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  scheduled: { label: 'מתואם', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  dispatched: { label: 'יצא לדרך', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  in_transit: { label: 'בדרך', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  delivered: { label: 'נמסר', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  failed: { label: 'נכשל', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  returned: { label: 'הוחזר', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  
  // Payment Status
  unpaid: { label: 'לא שולם', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  deposit_paid: { label: 'תשלום חלקי', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  paid: { label: 'שולם', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  refunded_partial: { label: 'זיכוי חלקי', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  refunded_full: { label: 'זיכוי מלא', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  
  // Support Status
  open: { label: 'פתוח', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  in_progress: { label: 'בטיפול', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  waiting_customer: { label: 'ממתין ללקוח', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  waiting_factory: { label: 'ממתין למפעל', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  waiting_logistics: { label: 'ממתין ללוגיסטיקה', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  resolved: { label: 'נפתר', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  closed: { label: 'סגור', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  
  // Trial Status
  not_applicable: { label: 'לא רלוונטי', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  active_trial: { label: 'בניסיון', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  ending_soon: { label: 'מסתיים בקרוב', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  expired: { label: 'פג תוקף', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  converted: { label: 'הומר', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  
  // Commission Status
  pending: { label: 'ממתין', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  approved: { label: 'מאושר', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  
  // Quote Status
  draft: { label: 'טיוטה', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  sent: { label: 'נשלח', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  rejected: { label: 'נדחה', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  
  // Return Status
  requested: { label: 'התקבלה בקשה', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  eligible: { label: 'זכאי', color: 'bg-green-100 text-green-700 ring-1 ring-green-200' },
  pickup_scheduled: { label: 'איסוף מתואם', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  received: { label: 'התקבל', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  inspected: { label: 'נבדק', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  refund_approved: { label: 'זיכוי מאושר', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  refund_paid: { label: 'זיכוי שולם', color: 'bg-green-100 text-green-700 ring-1 ring-green-200' },
  
  // Priority
  low: { label: 'נמוך', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  medium: { label: 'בינוני', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  high: { label: 'גבוה', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  urgent: { label: 'דחוף', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  
  // Call Results
  answered_positive: { label: 'מעוניין', color: 'bg-green-100 text-green-700 ring-1 ring-green-200' },
  answered_neutral: { label: 'נייטרלי', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  answered_negative: { label: 'שלילי', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  no_answer: { label: 'לא ענה', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  busy: { label: 'תפוס', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  voicemail_left: { label: 'הודעה', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  callback_requested: { label: 'התקשרות חוזרת', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  not_interested: { label: 'לא מעוניין', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  
  // Lead types
  qualified: { label: 'מוסמך', color: 'bg-green-100 text-green-700 ring-1 ring-green-200' },
  won: { label: 'נסגר', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  lost: { label: 'אבוד', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  contact: { label: 'צור קשר', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
};

// ── The groups ──────────────────────────────────────────────────────────────
// Only lead statuses are re-toned here. Order, delivery, payment, support and
// the rest keep the colours declared above — they are separate vocabularies
// that happen to share this component.
const LEAD_STATUS_TONES = [
  // Just arrived, nobody has worked it yet.
  ['bg-blue-100 text-blue-700 ring-1 ring-blue-200', [
    'new_lead', 'second_line_lead', 'call_from_google', 'call_from_facebook',
  ]],
  // Call this one now. The only red on the screen.
  ['bg-red-100 text-red-700 ring-1 ring-red-200', [
    'hot_lead', 'manager_call_potential_close',
  ]],
  // Live, committed to a date — before a quote exists.
  ['bg-violet-100 text-violet-700 ring-1 ring-violet-200', [
    'followup_before_quote', 'return_to_followup',
    'transferred_by_manager_for_followup', 'changed_direction',
  ]],
  // Live, committed to a date — a price is already on the table. Deliberately
  // a different hue from the one above: the two follow-up tiers are the most
  // frequent pair on the screen and used to be near-identical purples.
  ['bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200', [
    'followup_after_quote',
  ]],
  // A booked meeting — the strongest commitment short of a sale.
  ['bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200', [
    'coming_to_branch', 'will_arrive_for_meeting',
  ]],
  // Chasing, early. The ramp below escalates with the number of attempts, so
  // the colour tells the rep how tired this lead is of the phone.
  ['bg-amber-100 text-amber-700 ring-1 ring-amber-200', [
    'no_answer_1', 'no_answer_2',
  ]],
  ['bg-orange-100 text-orange-700 ring-1 ring-orange-200', [
    'no_answer_3', 'no_answer_4', 'no_answer_calls',
  ]],
  // Chasing, exhausted. Rose rather than red: loud, but never mistaken for
  // "ליד רותח" at a glance.
  ['bg-rose-100 text-rose-700 ring-1 ring-rose-200', [
    'no_answer_5', 'no_answer_8_calls',
  ]],
  // We reached out and the ball is in their court. Used to be green, which
  // read as "done" while sitting in the middle of the no-answer ramp.
  ['bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200', [
    'no_answer_whatsapp_sent',
  ]],
  // Sold.
  ['bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200', [
    'deal_closed',
  ]],
  // Already a customer — an inquiry, not a sale to win. Used to share the
  // "נסגרה עסקה" green, which made the closed-deal colour mean two things.
  ['bg-teal-100 text-teal-700 ring-1 ring-teal-200', [
    'already_purchased_inquiry', 'service_handled',
    'service_30_nights_trial_handled', 'service_warranty_handled',
    'service_cancellations_handled', 'service_missing_items_handled',
    'delivery_inquiry_handled',
  ]],
  // Service, still open. "בירור אספקה" joins its own family here; it used to
  // be blue, alone among the open service statuses.
  ['bg-amber-100 text-amber-700 ring-1 ring-amber-200', [
    'service_30_nights_trial', 'service_warranty', 'service_cancellations',
    'service_missing_items', 'delivery_inquiry',
  ]],
  // Out of play, whatever the reason. The label carries the reason.
  ['bg-slate-100 text-slate-600 ring-1 ring-slate-200', [
    'not_relevant_duplicate', 'not_relevant_bought_elsewhere',
    'not_relevant_1000_nis', 'not_relevant_denies_contact',
    'not_relevant_service', 'not_relevant_no_explanation',
    'not_relevant_wrong_number', 'not_relevant_not_mature',
    'heard_price_not_interested', 'not_interested_hangs_up',
    'lives_far_phone_concern', 'products_not_available',
    'mailing_remove_request', 'closed_by_manager_to_mailing', 'system_test',
  ]],
];

for (const [color, statuses] of LEAD_STATUS_TONES) {
  for (const status of statuses) {
    if (statusConfig[status]) statusConfig[status].color = color;
  }
}

// Extract the dot color from the text color class
function getDotColor(colorString) {
  const match = colorString.match(/text-(\w+)-(\d+)/);
  if (!match) return 'bg-gray-400';
  return `bg-${match[1]}-${match[2]}`;
}

export default function StatusBadge({ status, className = '', label: labelOverride }) {
  const { statusColors } = useStatusColors();
  const config = statusConfig[status] || { label: status, color: 'bg-gray-100 text-gray-600' };

  // Admin override (Settings → סטטוסים → color picker) takes precedence over
  // the built-in palette so a recolored status looks the same everywhere it's
  // rendered. Falls back to the original tailwind classes (ring classes
  // included) when no override — without them the bg-{color}-100 backgrounds
  // are too pale to see on a white card and badges read as colorless.
  const overridePreset = getStatusColorPreset(statusColors[status]);
  const colorClasses = overridePreset
    ? `${overridePreset.bg} ${overridePreset.text}`
    : config.color;
  const dotColor = overridePreset ? overridePreset.dot : getDotColor(config.color);

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${colorClasses} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
      {labelOverride ?? config.label}
    </span>
  );
}