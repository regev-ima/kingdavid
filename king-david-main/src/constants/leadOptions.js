/**
 * Central constants for lead statuses, sources, task types, and SLA thresholds.
 * Single source of truth - import from here instead of duplicating lists.
 */

// ==================== Lead Statuses ====================

export const LEAD_STATUS_OPTIONS = [
  { value: 'new_lead', label: 'ליד חדש' },
  { value: 'hot_lead', label: 'ליד רותח' },
  { value: 'followup_before_quote', label: 'פולאפ - לפני הצעה' },
  { value: 'followup_after_quote', label: 'פולאפ - אחרי הצעת מחיר' },
  { value: 'coming_to_branch', label: 'יגיע לסניף לפגישה' },
  { value: 'no_answer_1', label: 'ללא מענה 1' },
  { value: 'no_answer_2', label: 'ללא מענה 2' },
  { value: 'no_answer_3', label: 'ללא מענה 3' },
  { value: 'no_answer_4', label: 'ללא מענה 4' },
  { value: 'no_answer_5', label: 'ללא מענה 5' },
  { value: 'no_answer_whatsapp_sent', label: 'ללא מענה - נשלח ווטסאפ' },
  { value: 'no_answer_calls', label: 'אין מענה - חיוגים' },
  { value: 'changed_direction', label: 'שנה כיוון לליד' },
  { value: 'deal_closed', label: 'נסגרה עסקה' },
  { value: 'not_relevant_duplicate', label: 'לא רלוונטי - ליד כפול' },
  { value: 'mailing_remove_request', label: 'דיוור חוזר - ביקש להסיר' },
  { value: 'lives_far_phone_concern', label: 'גר רחוק - חושש מקנייה בטלפון' },
  { value: 'products_not_available', label: 'מחפש מוצרים שלא קיימים' },
  { value: 'not_relevant_bought_elsewhere', label: 'לא רלוונטי - רכש במקום אחר' },
  { value: 'not_relevant_1000_nis', label: 'לא רלוונטי - מחפש מזרן ב 1000 שח' },
  { value: 'not_relevant_denies_contact', label: 'לא רלוונטי - מכחיש פניה' },
  { value: 'not_relevant_service', label: 'לא רלוונטי שירות' },
  { value: 'not_interested_hangs_up', label: 'לא מעוניין לדבר - מנתק' },
  { value: 'not_relevant_no_explanation', label: 'לא רלוונטי לא מסביר למה' },
  { value: 'heard_price_not_interested', label: 'שמע מחיר ולא מעוניין' },
  { value: 'not_relevant_wrong_number', label: 'לא רלוונטי - מספר שגוי' },
  { value: 'closed_by_manager_to_mailing', label: 'נסגר ע"י מנהל - הועבר לדיוור' },
];

export const VALID_LEAD_STATUSES = LEAD_STATUS_OPTIONS.map(s => s.value);

export const CLOSED_STATUSES = [
  'deal_closed', 'not_relevant_duplicate', 'mailing_remove_request',
  'lives_far_phone_concern', 'products_not_available', 'not_relevant_bought_elsewhere',
  'not_relevant_1000_nis', 'not_relevant_denies_contact', 'not_relevant_service',
  'not_interested_hangs_up', 'not_relevant_no_explanation', 'heard_price_not_interested',
  'not_relevant_wrong_number', 'closed_by_manager_to_mailing'
];

// ==================== Lead Sources ====================

export const LEAD_SOURCE_OPTIONS = [
  { value: 'store', label: 'חנות' },
  { value: 'callcenter', label: 'מוקד' },
  { value: 'digital', label: 'דיגיטל' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'referral', label: 'הפניה' },
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