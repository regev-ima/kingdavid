/**
 * Central constants for lead statuses, sources, task types, and SLA thresholds.
 * Single source of truth - import from here instead of duplicating lists.
 */

// ==================== Lead Statuses ====================

// This list must cover every status key the DATABASE can hold, not just the
// ones the app offers in a dropdown. Migration 20260426000004 normalized the
// raw Hebrew strings in `leads.status` to English keys, and it produced 22 keys
// that never made it into this file — service tickets, delivery inquiries,
// `second_line_lead`, `system_test` and others. A lead carrying one of those
// rendered with no label anywhere in the app, and the Kaveret importer, which
// resolves a status by matching the file's Hebrew against these labels, sent
// all of them to `new_lead`: 23,050 rows on the last export.
//
// So the rule is: a key that exists in the data belongs here, even when nobody
// would pick it from a menu.
export const LEAD_STATUS_OPTIONS = [
  { value: 'new_lead', label: 'ליד חדש' },
  { value: 'hot_lead', label: 'ליד רותח' },
  { value: 'second_line_lead', label: 'ליד קו שני' },
  { value: 'followup_before_quote', label: 'פולאפ - לפני הצעה' },
  { value: 'followup_after_quote', label: 'פולאפ - אחרי הצעת מחיר' },
  { value: 'return_to_followup', label: 'לחזור לפולואפ' },
  { value: 'coming_to_branch', label: 'יגיע לסניף לפגישה' },
  // Same label as coming_to_branch on purpose: 20260426000004 normalized that
  // Hebrew string to `will_arrive_for_meeting` while the UI writes
  // `coming_to_branch`, so production holds both. Listed so stored rows render;
  // leadStatusMatch resolves the ambiguous label to coming_to_branch, the one
  // the app actually writes.
  { value: 'will_arrive_for_meeting', label: 'יגיע לסניף לפגישה' },
  { value: 'manager_call_potential_close', label: 'לבצע שיחת מנהל - פוטנציאלי לסגירה' },
  { value: 'transferred_by_manager_for_followup', label: 'הועבר ע"י מנהל - להמשך טיפול' },
  { value: 'no_answer_1', label: 'ללא מענה 1' },
  { value: 'no_answer_2', label: 'ללא מענה 2' },
  { value: 'no_answer_3', label: 'ללא מענה 3' },
  { value: 'no_answer_4', label: 'ללא מענה 4' },
  { value: 'no_answer_5', label: 'ללא מענה 5' },
  { value: 'no_answer_8_calls', label: 'אין מענה - 8 חיוגים' },
  { value: 'no_answer_whatsapp_sent', label: 'ללא מענה - נשלח ווטסאפ' },
  { value: 'no_answer_calls', label: 'אין מענה - חיוגים' },
  { value: 'changed_direction', label: 'שנה כיוון לליד' },
  { value: 'call_from_google', label: 'שיחה מגוגל' },
  { value: 'call_from_facebook', label: 'שיחה מפייסבוק' },
  { value: 'already_purchased_inquiry', label: 'כבר רכש ב - King David התקשר לבירור' },
  { value: 'deal_closed', label: 'נסגרה עסקה' },
  { value: 'not_relevant_duplicate', label: 'לא רלוונטי - ליד כפול' },
  { value: 'mailing_remove_request', label: 'דיוור חוזר - ביקש להסיר' },
  { value: 'lives_far_phone_concern', label: 'גר רחוק - חושש מקנייה בטלפון' },
  { value: 'products_not_available', label: 'מחפש מוצרים שלא קיימים' },
  { value: 'not_relevant_bought_elsewhere', label: 'לא רלוונטי - רכש במקום אחר' },
  { value: 'not_relevant_1000_nis', label: 'לא רלוונטי - מחפש מזרן ב 1000 שח' },
  { value: 'not_relevant_denies_contact', label: 'לא רלוונטי - מכחיש פניה' },
  { value: 'not_relevant_service', label: 'לא רלוונטי שירות' },
  { value: 'not_relevant_not_mature', label: 'לא רלוונטי - ליד לא בשל לעסקה' },
  { value: 'not_interested_hangs_up', label: 'לא מעוניין לדבר - מנתק' },
  { value: 'not_relevant_no_explanation', label: 'לא רלוונטי לא מסביר למה' },
  { value: 'heard_price_not_interested', label: 'שמע מחיר ולא מעוניין' },
  { value: 'not_relevant_wrong_number', label: 'לא רלוונטי - מספר שגוי' },
  { value: 'closed_by_manager_to_mailing', label: 'נסגר ע"י מנהל - הועבר לדיוור' },
  // Customer-service and delivery tracks. Each comes in an open pair and a
  // "טופל" (handled) pair; only the handled half terminates the lead.
  { value: 'service_30_nights_trial', label: 'שירות לקוחות - מסגרת 30 לילות ניסיון' },
  { value: 'service_30_nights_trial_handled', label: 'שירות לקוחות - מסגרת 30 לילות ניסיון טופל' },
  { value: 'service_warranty', label: 'שירות לקוחות - תעודת אחריות' },
  { value: 'service_warranty_handled', label: 'שירות לקוחות - תעודת אחריות טופל' },
  { value: 'service_cancellations', label: 'שירות לקוחות - ביטולים' },
  { value: 'service_cancellations_handled', label: 'שירות לקוחות - ביטולים טופל' },
  { value: 'service_missing_items', label: 'שירות לקוחות - חוסרים בהזמנה' },
  { value: 'service_missing_items_handled', label: 'שירות לקוחות - חוסרים בהזמנה טופל' },
  { value: 'service_handled', label: 'שירות לקוחות - טופל' },
  { value: 'delivery_inquiry', label: 'בירור אספקה' },
  { value: 'delivery_inquiry_handled', label: 'בירור אספקה - טופל' },
  { value: 'system_test', label: 'בדיקת מערכת' },
];

export const VALID_LEAD_STATUSES = LEAD_STATUS_OPTIONS.map(s => s.value);

// Statuses that terminate the pipeline: the lead leaves the reps' work queue
// ("לידים בטיפול") and stops counting as open work in the dashboards.
//
// MIRRORED IN SQL by public.lead_closed_statuses() — which landing_pages_stats
// and dashboard_stats_v1 both call, so the SQL side is one list rather than
// three — and in supabase/functions/getDashboardStats/index.ts, which cannot
// import either. Change one, change all three.
export const CLOSED_STATUSES = [
  'deal_closed', 'not_relevant_duplicate', 'mailing_remove_request',
  'lives_far_phone_concern', 'products_not_available', 'not_relevant_bought_elsewhere',
  'not_relevant_1000_nis', 'not_relevant_denies_contact', 'not_relevant_service',
  'not_interested_hangs_up', 'not_relevant_no_explanation', 'heard_price_not_interested',
  'not_relevant_wrong_number', 'closed_by_manager_to_mailing',
  // Added with the 20260426000004 keys. The service/delivery tracks close only
  // on their "טופל" half; the open half stays in the queue because somebody is
  // still expected to handle it. `system_test` is test data, never real work.
  'not_relevant_not_mature', 'system_test',
  'service_handled', 'service_30_nights_trial_handled', 'service_warranty_handled',
  'service_cancellations_handled', 'service_missing_items_handled',
  'delivery_inquiry_handled',
];

// ==================== Lead Sources ====================

export const LEAD_SOURCE_OPTIONS = [
  { value: 'store', label: 'חנות' },
  { value: 'callcenter', label: 'מוקד' },
  { value: 'digital', label: 'דיגיטל' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'referral', label: 'הפניה' },
  { value: 'website', label: 'אתר' },
];

export const SOURCE_LABELS = Object.fromEntries(
  LEAD_SOURCE_OPTIONS.map(s => [s.value, s.label])
);

// ==================== Task Types ====================

export const TASK_TYPE_OPTIONS = [
  { value: 'call', label: 'שיחה', emoji: '📞' },
  { value: 'meeting', label: 'פגישה', emoji: '🤝' },
  { value: 'quote_preparation', label: 'הצעת מחיר', emoji: '📝' },
  { value: 'close_order', label: 'סגירת הזמנה', emoji: '✅' },
];

export const TASK_TYPE_LABELS = Object.fromEntries(
  TASK_TYPE_OPTIONS.map(t => [t.value, t.label])
);

// Display labels for EVERY task type the system may produce — including
// ones that aren't offered in the "new task" dropdown (TASK_TYPE_OPTIONS):
// system-generated `assignment` tasks, follow-ups, and legacy/imported
// types (whatsapp / email / other). Use this for rendering a task type;
// use TASK_TYPE_OPTIONS only for the manual-create picker.
export const ALL_TASK_TYPE_LABELS = {
  ...TASK_TYPE_LABELS,
  assignment: 'שיוך',
  followup: 'מעקב',
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  other: 'אחר',
};

// ==================== Task Statuses ====================

export const TASK_STATUS_OPTIONS = [
  { value: 'not_completed', label: 'ממתין לביצוע' },
  { value: 'completed', label: 'בוצע' },
  { value: 'not_done', label: 'לא בוצע' },
  { value: 'cancelled', label: 'בוטל' },
];

// ==================== SLA Thresholds ====================

export const SLA_THRESHOLDS = {
  GREEN_MAX_MINUTES: 5,
  AMBER_MAX_MINUTES: 15,
};

// ==================== Timezone ====================

export const TIMEZONE = 'Asia/Jerusalem';

// ==================== Pagination ====================

export const DEFAULT_PAGE_SIZE = 100;