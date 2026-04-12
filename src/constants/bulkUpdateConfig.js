import {
  LEAD_STATUS_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
} from './leadOptions';

const PAYMENT_STATUS_OPTIONS = [
  { value: 'unpaid', label: 'לא שולם' },
  { value: 'deposit_paid', label: 'מקדמה' },
  { value: 'paid', label: 'שולם' },
];

const PRODUCTION_STATUS_OPTIONS = [
  { value: 'not_started', label: 'טרם התחיל' },
  { value: 'in_production', label: 'בייצור' },
  { value: 'ready', label: 'מוכן' },
];

const DELIVERY_STATUS_OPTIONS = [
  { value: 'need_scheduling', label: 'לתאום' },
  { value: 'scheduled', label: 'מתואם' },
  { value: 'delivered', label: 'נמסר' },
];

const QUOTE_STATUS_OPTIONS = [
  { value: 'draft', label: 'טיוטה' },
  { value: 'sent', label: 'נשלח' },
  { value: 'approved', label: 'מאושר' },
  { value: 'rejected', label: 'נדחה' },
  { value: 'expired', label: 'פג תוקף' },
];

const VIP_STATUS_OPTIONS = [
  { value: 'true', label: 'VIP' },
  { value: 'false', label: 'רגיל' },
];

const TICKET_STATUS_OPTIONS = [
  { value: 'open', label: 'פתוח' },
  { value: 'in_progress', label: 'בטיפול' },
  { value: 'waiting_customer', label: 'ממתין ללקוח' },
  { value: 'resolved', label: 'נפתר' },
  { value: 'closed', label: 'סגור' },
];

const TICKET_PRIORITY_OPTIONS = [
  { value: 'low', label: 'נמוך' },
  { value: 'medium', label: 'בינוני' },
  { value: 'high', label: 'גבוה' },
  { value: 'urgent', label: 'דחוף' },
];

const TICKET_CATEGORY_OPTIONS = [
  { value: 'delivery', label: 'משלוח' },
  { value: 'quality', label: 'איכות' },
  { value: 'return', label: 'החזרה' },
  { value: 'trial', label: 'ניסיון 30 יום' },
  { value: 'billing', label: 'חיוב' },
  { value: 'warranty', label: 'אחריות' },
  { value: 'other', label: 'אחר' },
];

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'כן' },
  { value: 'false', label: 'לא' },
];

const ELEVATOR_TYPE_OPTIONS = [
  { value: 'none', label: 'ללא' },
  { value: 'regular', label: 'רגילה' },
  { value: 'freight', label: 'משא' },
];

const PROPERTY_TYPE_OPTIONS = [
  { value: 'apartment', label: 'דירה' },
  { value: 'house', label: 'בית' },
];

/** Sentinel value for "empty field" filter */
export const EMPTY_FIELD_VALUE = '__EMPTY__';

/**
 * Declarative config for all bulk-updatable entities.
 *
 * Field types:
 *   'select'     – dropdown with predefined options
 *   'rep'        – rep picker (loaded dynamically from Representative entity)
 *   'text'       – free text / regex search
 *   'date_range' – date range picker (from / to)
 *   'number'     – numeric value
 *   'boolean'    – true/false select
 *
 * Every select/rep/text field automatically supports "empty field" search.
 */
export const BULK_UPDATE_ENTITIES = {
  Lead: {
    label: 'לידים',
    icon: 'Users',
    filterFields: [
      { key: 'status', label: 'סטטוס', type: 'select', options: LEAD_STATUS_OPTIONS },
      { key: 'source', label: 'מקור', type: 'select', options: LEAD_SOURCE_OPTIONS },
      { key: 'rep1', label: 'נציג ראשי (מייל)', type: 'text' },
      { key: 'rep2', label: 'נציג משני (מייל)', type: 'text' },
      { key: 'pending_rep_email', label: 'נציג ממתין (מייל)', type: 'text' },
      { key: 'full_name', label: 'שם מלא', type: 'text' },
      { key: 'phone', label: 'טלפון', type: 'text' },
      { key: 'email', label: 'אימייל', type: 'text' },
      { key: 'city', label: 'עיר', type: 'text' },
      { key: 'address', label: 'כתובת', type: 'text' },
      { key: 'notes', label: 'הערות', type: 'text' },
      { key: 'budget', label: 'תקציב', type: 'text' },
      { key: 'preferred_product', label: 'מוצר מועדף', type: 'text' },
      { key: 'utm_source', label: 'UTM Source', type: 'text' },
      { key: 'utm_medium', label: 'UTM Medium', type: 'text' },
      { key: 'utm_campaign', label: 'UTM Campaign', type: 'text' },
      { key: 'utm_content', label: 'UTM Content', type: 'text' },
      { key: 'utm_term', label: 'UTM Term', type: 'text' },
      { key: 'click_id', label: 'Click ID', type: 'text' },
      { key: 'landing_page', label: 'דף נחיתה', type: 'text' },
      { key: 'unique_id', label: 'מזהה ייחודי', type: 'text' },
      { key: 'customer_id', label: 'מזהה לקוח', type: 'text' },
      { key: 'created_date', label: 'תאריך יצירה', type: 'date_range' },
      { key: 'updated_date', label: 'תאריך עדכון', type: 'date_range' },
    ],
    updateFields: [
      { key: 'status', label: 'סטטוס', type: 'select', options: LEAD_STATUS_OPTIONS },
      { key: 'source', label: 'מקור', type: 'select', options: LEAD_SOURCE_OPTIONS },
      { key: 'rep1', label: 'נציג ראשי', type: 'rep' },
      { key: 'rep2', label: 'נציג משני', type: 'rep' },
      { key: 'pending_rep_email', label: 'נציג ממתין', type: 'rep' },
      { key: 'notes', label: 'הערות', type: 'text' },
      { key: 'city', label: 'עיר', type: 'text' },
      { key: 'address', label: 'כתובת', type: 'text' },
      { key: 'budget', label: 'תקציב', type: 'text' },
      { key: 'preferred_product', label: 'מוצר מועדף', type: 'text' },
      { key: 'utm_source', label: 'UTM Source', type: 'text' },
      { key: 'utm_medium', label: 'UTM Medium', type: 'text' },
      { key: 'utm_campaign', label: 'UTM Campaign', type: 'text' },
      { key: 'landing_page', label: 'דף נחיתה', type: 'text' },
    ],
  },

  SalesTask: {
    label: 'משימות מכירה',
    icon: 'CheckSquare',
    filterFields: [
      { key: 'task_status', label: 'סטטוס משימה', type: 'select', options: TASK_STATUS_OPTIONS },
      { key: 'task_type', label: 'סוג משימה', type: 'select', options: TASK_TYPE_OPTIONS },
      { key: 'rep1', label: 'נציג ראשי (מייל)', type: 'text' },
      { key: 'rep2', label: 'נציג משני (מייל)', type: 'text' },
      { key: 'pending_rep_email', label: 'נציג ממתין (מייל)', type: 'text' },
      { key: 'summary', label: 'תקציר', type: 'text' },
      { key: 'lead_id', label: 'מזהה ליד', type: 'text' },
      { key: 'status', label: 'סטטוס ליד בזמן יצירה', type: 'select', options: LEAD_STATUS_OPTIONS },
      { key: 'due_date', label: 'תאריך יעד', type: 'date_range' },
      { key: 'created_date', label: 'תאריך יצירה', type: 'date_range' },
      { key: 'updated_date', label: 'תאריך עדכון', type: 'date_range' },
    ],
    updateFields: [
      { key: 'task_status', label: 'סטטוס משימה', type: 'select', options: TASK_STATUS_OPTIONS },
      { key: 'task_type', label: 'סוג משימה', type: 'select', options: TASK_TYPE_OPTIONS },
      { key: 'rep1', label: 'נציג ראשי', type: 'rep' },
      { key: 'rep2', label: 'נציג משני', type: 'rep' },
      { key: 'pending_rep_email', label: 'נציג ממתין', type: 'rep' },
      { key: 'summary', label: 'תקציר', type: 'text' },
    ],
  },

  Order: {
    label: 'הזמנות',
    icon: 'ShoppingCart',
    filterFields: [
      { key: 'payment_status', label: 'סטטוס תשלום', type: 'select', options: PAYMENT_STATUS_OPTIONS },
      { key: 'production_status', label: 'סטטוס ייצור', type: 'select', options: PRODUCTION_STATUS_OPTIONS },
      { key: 'delivery_status', label: 'סטטוס משלוח', type: 'select', options: DELIVERY_STATUS_OPTIONS },
      { key: 'rep1', label: 'נציג (מייל)', type: 'text' },
      { key: 'customer_name', label: 'שם לקוח', type: 'text' },
      { key: 'customer_phone', label: 'טלפון לקוח', type: 'text' },
      { key: 'customer_email', label: 'אימייל לקוח', type: 'text' },
      { key: 'order_number', label: 'מספר הזמנה', type: 'text' },
      { key: 'customer_id', label: 'מזהה לקוח', type: 'text' },
      { key: 'lead_id', label: 'מזהה ליד', type: 'text' },
      { key: 'quote_id', label: 'מזהה הצעת מחיר', type: 'text' },
      { key: 'delivery_address', label: 'כתובת משלוח', type: 'text' },
      { key: 'delivery_city', label: 'עיר משלוח', type: 'text' },
      { key: 'property_type', label: 'סוג נכס', type: 'select', options: PROPERTY_TYPE_OPTIONS },
      { key: 'elevator_type', label: 'סוג מעלית', type: 'select', options: ELEVATOR_TYPE_OPTIONS },
      { key: 'source', label: 'מקור', type: 'select', options: LEAD_SOURCE_OPTIONS },
      { key: 'trial_30d_enabled', label: 'ניסיון 30 יום', type: 'select', options: BOOLEAN_OPTIONS },
      { key: 'notes_sales', label: 'הערות מכירות', type: 'text' },
      { key: 'created_date', label: 'תאריך יצירה', type: 'date_range' },
      { key: 'updated_date', label: 'תאריך עדכון', type: 'date_range' },
    ],
    updateFields: [
      { key: 'payment_status', label: 'סטטוס תשלום', type: 'select', options: PAYMENT_STATUS_OPTIONS },
      { key: 'production_status', label: 'סטטוס ייצור', type: 'select', options: PRODUCTION_STATUS_OPTIONS },
      { key: 'delivery_status', label: 'סטטוס משלוח', type: 'select', options: DELIVERY_STATUS_OPTIONS },
      { key: 'rep1', label: 'נציג', type: 'rep' },
      { key: 'notes_sales', label: 'הערות מכירות', type: 'text' },
      { key: 'delivery_address', label: 'כתובת משלוח', type: 'text' },
      { key: 'delivery_city', label: 'עיר משלוח', type: 'text' },
      { key: 'source', label: 'מקור', type: 'select', options: LEAD_SOURCE_OPTIONS },
    ],
  },

  Quote: {
    label: 'הצעות מחיר',
    icon: 'FileText',
    filterFields: [
      { key: 'status', label: 'סטטוס', type: 'select', options: QUOTE_STATUS_OPTIONS },
      { key: 'created_by_rep', label: 'נוצר ע"י (מייל)', type: 'text' },
      { key: 'customer_name', label: 'שם לקוח', type: 'text' },
      { key: 'customer_phone', label: 'טלפון לקוח', type: 'text' },
      { key: 'customer_email', label: 'אימייל לקוח', type: 'text' },
      { key: 'quote_number', label: 'מספר הצעה', type: 'text' },
      { key: 'lead_id', label: 'מזהה ליד', type: 'text' },
      { key: 'delivery_address', label: 'כתובת משלוח', type: 'text' },
      { key: 'delivery_city', label: 'עיר משלוח', type: 'text' },
      { key: 'property_type', label: 'סוג נכס', type: 'select', options: PROPERTY_TYPE_OPTIONS },
      { key: 'elevator_type', label: 'סוג מעלית', type: 'select', options: ELEVATOR_TYPE_OPTIONS },
      { key: 'notes', label: 'הערות', type: 'text' },
      { key: 'terms', label: 'תנאים', type: 'text' },
      { key: 'valid_until', label: 'תוקף הצעה', type: 'date_range' },
      { key: 'created_date', label: 'תאריך יצירה', type: 'date_range' },
      { key: 'updated_date', label: 'תאריך עדכון', type: 'date_range' },
    ],
    updateFields: [
      { key: 'status', label: 'סטטוס', type: 'select', options: QUOTE_STATUS_OPTIONS },
      { key: 'notes', label: 'הערות', type: 'text' },
      { key: 'terms', label: 'תנאי תשלום ומשלוח', type: 'text' },
      { key: 'warranty_terms', label: 'תנאי אחריות', type: 'text' },
      { key: 'delivery_address', label: 'כתובת משלוח', type: 'text' },
      { key: 'delivery_city', label: 'עיר משלוח', type: 'text' },
    ],
  },

  Customer: {
    label: 'לקוחות',
    icon: 'Crown',
    filterFields: [
      { key: 'full_name', label: 'שם מלא', type: 'text' },
      { key: 'phone', label: 'טלפון', type: 'text' },
      { key: 'email', label: 'אימייל', type: 'text' },
      { key: 'city', label: 'עיר', type: 'text' },
      { key: 'address', label: 'כתובת', type: 'text' },
      { key: 'source', label: 'מקור', type: 'select', options: LEAD_SOURCE_OPTIONS },
      { key: 'original_source', label: 'מקור מקורי', type: 'text' },
      { key: 'vip_status', label: 'סוג לקוח', type: 'select', options: VIP_STATUS_OPTIONS },
      { key: 'account_manager', label: 'מנהל לקוח (מייל)', type: 'text' },
      { key: 'status', label: 'סטטוס', type: 'text' },
      { key: 'lead_id', label: 'מזהה ליד', type: 'text' },
      { key: 'created_date', label: 'תאריך יצירה', type: 'date_range' },
      { key: 'updated_date', label: 'תאריך עדכון', type: 'date_range' },
    ],
    updateFields: [
      { key: 'city', label: 'עיר', type: 'text' },
      { key: 'address', label: 'כתובת', type: 'text' },
      { key: 'source', label: 'מקור', type: 'select', options: LEAD_SOURCE_OPTIONS },
      { key: 'vip_status', label: 'סוג לקוח', type: 'select', options: VIP_STATUS_OPTIONS },
      { key: 'account_manager', label: 'מנהל לקוח', type: 'rep' },
      { key: 'email', label: 'אימייל', type: 'text' },
    ],
  },

  SupportTicket: {
    label: 'שירות לקוחות',
    icon: 'Headphones',
    filterFields: [
      { key: 'status', label: 'סטטוס', type: 'select', options: TICKET_STATUS_OPTIONS },
      { key: 'priority', label: 'עדיפות', type: 'select', options: TICKET_PRIORITY_OPTIONS },
      { key: 'category', label: 'קטגוריה', type: 'select', options: TICKET_CATEGORY_OPTIONS },
      { key: 'assigned_to', label: 'מטפל (מייל)', type: 'text' },
      { key: 'customer_name', label: 'שם לקוח', type: 'text' },
      { key: 'customer_phone', label: 'טלפון לקוח', type: 'text' },
      { key: 'customer_email', label: 'אימייל לקוח', type: 'text' },
      { key: 'subject', label: 'נושא', type: 'text' },
      { key: 'description', label: 'תיאור', type: 'text' },
      { key: 'ticket_number', label: 'מספר פניה', type: 'text' },
      { key: 'order_id', label: 'מזהה הזמנה', type: 'text' },
      { key: 'created_date', label: 'תאריך יצירה', type: 'date_range' },
      { key: 'updated_date', label: 'תאריך עדכון', type: 'date_range' },
    ],
    updateFields: [
      { key: 'status', label: 'סטטוס', type: 'select', options: TICKET_STATUS_OPTIONS },
      { key: 'priority', label: 'עדיפות', type: 'select', options: TICKET_PRIORITY_OPTIONS },
      { key: 'category', label: 'קטגוריה', type: 'select', options: TICKET_CATEGORY_OPTIONS },
      { key: 'assigned_to', label: 'מטפל', type: 'rep' },
      { key: 'subject', label: 'נושא', type: 'text' },
    ],
  },
};
