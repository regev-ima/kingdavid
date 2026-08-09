/**
 * The permission catalog — every capability in the system that can be opened
 * or blocked, grouped by area and nested to whatever depth the area needs.
 *
 * Shape
 * ─────
 *   PERMISSION_GROUPS: [{ key, label, icon, description, permissions: [node] }]
 *   node:              { key, label, description, baseline, tiers, children? }
 *
 * `baseline`  — the gate that already decides this today (see ./baselines.js).
 *               Present on everything that maps to existing behaviour; that is
 *               what makes the rollout a no-op.
 * `tiers`     — the default for each access level when no baseline applies and
 *               nothing was configured. Written to match what the app does
 *               today, so a fresh מנהל חנות is a believable middle ground
 *               rather than an empty account.
 * `children`  — sub-permissions. A child is only ever effective if its parent
 *               is: that is how "block the whole area / block one section /
 *               block one sub-section inside it" all fall out of one rule.
 *
 * Adding a permission here does NOT enforce it. Enforcement is a `can(user,
 * 'x.y')` call at the place that matters. Entries with no call site yet are
 * intentional: they are the vocabulary the הרשאות screen exposes, and wiring
 * one up later is a one-line change that cannot silently alter behaviour
 * because its baseline already describes the status quo.
 */

import { BASELINE } from './baselines';
import { ACCESS_LEVELS } from './roles';

// Shorthand: t(rep, storeManager, chiefManager). Super admin is never
// consulted — it short-circuits to true before defaults are read.
const t = (rep, store, chief) => ({
  [ACCESS_LEVELS.REP]: rep,
  [ACCESS_LEVELS.STORE_MANAGER]: store,
  [ACCESS_LEVELS.CHIEF_MANAGER]: chief,
});

export const PERMISSION_GROUPS = [
  // ── מסכי בית ─────────────────────────────────────────────────────────────
  {
    key: 'dashboards',
    label: 'מסכי בית ודשבורדים',
    icon: 'space_dashboard',
    description: 'מרכז השליטה, דשבורד המכירות ודשבורד המפעל.',
    permissions: [
      {
        key: 'dashboards.control_center',
        label: 'מרכז שליטה',
        description: 'המסך הראשי עם נתוני החברה כולה.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
        children: [
          {
            key: 'dashboards.control_center.revenue',
            label: 'נתוני הכנסות',
            description: 'מחזור, יעדים וסכומי עסקאות במרכז השליטה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'dashboards.control_center.team',
            label: 'ביצועי צוות',
            description: 'טאב הצוות — כמה כל נציג סגר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'dashboards.control_center.marketing',
            label: 'נתוני שיווק',
            description: 'טאב השיווק — מקורות, עלויות והמרות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'dashboards.control_center.leaderboard',
            label: 'טבלת מובילים',
            description: 'דירוג הנציגים לפי ביצועים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
        ],
      },
      {
        key: 'dashboards.sales',
        label: 'דשבורד מכירות אישי',
        description: 'הנתונים האישיים של הנציג המחובר.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
      },
      {
        key: 'dashboards.factory',
        label: 'דשבורד מפעל',
        description: 'מצב הייצור והעבודות הפתוחות.',
        baseline: BASELINE.FACTORY,
        tiers: t(false, false, true),
      },
      {
        key: 'dashboards.export',
        label: 'ייצוא נתוני דשבורד',
        description: 'הורדת הנתונים שמאחורי הדשבורד לקובץ.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, false, true),
      },
    ],
  },

  // ── לידים ────────────────────────────────────────────────────────────────
  {
    key: 'leads',
    label: 'לידים',
    icon: 'contact_phone',
    description: 'ניהול הלידים — מי רואה, מי משייך ומי מוחק.',
    permissions: [
      {
        key: 'leads.view',
        label: 'גישה לאזור הלידים',
        description: 'כניסה למסך ניהול הלידים ופתיחת כרטיס ליד.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
        children: [
          {
            key: 'leads.view_all',
            label: 'צפייה בלידים של כל הנציגים',
            description: 'ללא ההרשאה הזו הנציג רואה רק לידים שהוא משויך אליהם.',
            baseline: BASELINE.VIEW_ALL_LEADS,
            tiers: t(false, true, true),
          },
          {
            key: 'leads.create',
            label: 'יצירת ליד חדש',
            description: 'הוספת ליד ידנית מהמסך.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.edit',
            label: 'עריכת פרטי ליד',
            description: 'שינוי שם, טלפון, כתובת ושאר שדות הליד.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.change_status',
            label: 'שינוי סטטוס ליד',
            description: 'קידום הליד בין שלבי המשפך.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.assign_primary_rep',
            label: 'שיוך נציג ראשי',
            description: 'קביעה של מי הבעלים של הליד. פעולת ניהול.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'leads.assign_secondary_rep',
            label: 'שיוך נציג משני',
            description: 'הוספת נציג שני לליד כשהמשבצת ריקה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.transfer',
            label: 'העברת לידים בין נציגים',
            description: 'העברה מרוכזת של תיק לידים מנציג לנציג.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'leads.delete',
            label: 'מחיקת ליד',
            description: 'מחיקה סופית של ליד מהמערכת.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'leads.import',
            label: 'ייבוא לידים',
            description: 'ייבוא מקובץ או מגוגל שיטס.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'leads.export',
            label: 'ייצוא לידים',
            description: 'הורדת רשימת לידים לקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'leads.bulk_update',
            label: 'עדכון מרוכז של לידים',
            description: 'כלי העדכון ההמוני.',
            baseline: BASELINE.BULK_UPDATE,
            tiers: t(false, true, true),
          },
          {
            key: 'leads.lookup',
            label: 'איתור ליד לפי טלפון',
            description: 'חיפוש חוצה-נציגים לפי מספר טלפון.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.marketing_fields',
            label: 'צפייה בשדות מקור ושיווק',
            description: 'מאיזו קמפיין/מקור הגיע הליד.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.activity_log',
            label: 'יומן פעילות הליד',
            description: 'ציר הזמן המלא של הליד, כולל פעולות של נציגים אחרים.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'leads.notes',
            label: 'הוספת הערות',
            description: 'כתיבת הערות בכרטיס הליד.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
        ],
      },
    ],
  },

  // ── משימות מכירה ─────────────────────────────────────────────────────────
  {
    key: 'tasks',
    label: 'משימות מכירה',
    icon: 'checklist',
    description: 'תור המשימות של הנציגים.',
    permissions: [
      {
        key: 'tasks.view',
        label: 'גישה למשימות מכירה',
        description: 'רשימת המשימות של הנציג.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
        children: [
          {
            key: 'tasks.view_all',
            label: 'צפייה במשימות של כל הנציגים',
            description: 'ללא ההרשאה הזו רואים רק משימות אישיות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'tasks.create',
            label: 'יצירת משימה',
            description: 'פתיחת משימת מכירה חדשה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'tasks.assign',
            label: 'שיוך משימה לנציג אחר',
            description: 'הטלת משימה על מישהו אחר בצוות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'tasks.complete',
            label: 'סגירת משימה',
            description: 'סימון משימה כבוצעה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'tasks.delete',
            label: 'מחיקת משימה',
            description: 'הסרת משימה מהתור.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'tasks.import',
            label: 'ייבוא משימות',
            description: 'ייבוא משימות מקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
    ],
  },

  // ── לקוחות ───────────────────────────────────────────────────────────────
  {
    key: 'customers',
    label: 'לקוחות',
    icon: 'contacts',
    description: 'כרטיסי הלקוחות וההיסטוריה שלהם.',
    permissions: [
      {
        key: 'customers.view',
        label: 'גישה ללקוחות',
        description: 'כניסה למסך הלקוחות.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
        children: [
          {
            key: 'customers.view_all',
            label: 'צפייה בכל הלקוחות',
            description: 'ללא ההרשאה הזו רואים רק לקוחות שהנציג מטפל בהם.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'customers.create',
            label: 'יצירת לקוח',
            description: 'הוספת כרטיס לקוח חדש.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'customers.edit',
            label: 'עריכת לקוח',
            description: 'שינוי פרטי הלקוח.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'customers.delete',
            label: 'מחיקת לקוח',
            description: 'מחיקה סופית של כרטיס לקוח.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'customers.change_account_manager',
            label: 'החלפת מנהל תיק',
            description: 'העברת הלקוח לנציג אחר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'customers.contact_details',
            label: 'צפייה בפרטי קשר מלאים',
            description: 'טלפון ומייל של הלקוח ללא מיסוך.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'customers.order_history',
            label: 'היסטוריית רכישות',
            description: 'כל ההזמנות הקודמות של הלקוח.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'customers.import',
            label: 'ייבוא לקוחות',
            description: 'ייבוא מקובץ או מגוגל שיטס.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'customers.export',
            label: 'ייצוא לקוחות',
            description: 'הורדת רשימת הלקוחות לקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
        ],
      },
    ],
  },

  // ── הצעות מחיר ───────────────────────────────────────────────────────────
  {
    key: 'quotes',
    label: 'הצעות מחיר',
    icon: 'request_quote',
    description: 'בניית הצעות, הנחות ושליחה ללקוח.',
    permissions: [
      {
        key: 'quotes.view',
        label: 'גישה להצעות מחיר',
        description: 'כניסה למסך ההצעות ופתיחת הצעה.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
        children: [
          {
            key: 'quotes.view_all',
            label: 'צפייה בהצעות של כל הנציגים',
            description: 'ללא ההרשאה הזו רואים רק הצעות שהנציג יצר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'quotes.create',
            label: 'יצירת הצעת מחיר',
            description: 'פתיחת הצעה חדשה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'quotes.edit',
            label: 'עריכת הצעה',
            description: 'שינוי פריטים וכמויות בהצעה קיימת.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'quotes.delete',
            label: 'מחיקת הצעה',
            description: 'הסרת הצעה מהמערכת.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'quotes.discount',
            label: 'מתן הנחה',
            description: 'הורדת מחיר במסגרת התקרה המותרת.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'quotes.discount_above_limit',
            label: 'הנחה מעל התקרה',
            description: 'חריגה ממדיניות ההנחות — פעולת ניהול.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'quotes.edit_prices',
            label: 'עריכת מחיר ידנית',
            description: 'דריסת מחיר הקטלוג בשורת פריט.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'quotes.send',
            label: 'שליחת הצעה ללקוח',
            description: 'שליחה בוואטסאפ / מייל.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'quotes.pdf',
            label: 'הפקת PDF',
            description: 'ייצוא ההצעה כמסמך.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'quotes.convert_to_order',
            label: 'הפיכת הצעה להזמנה',
            description: 'סגירת עסקה מתוך ההצעה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
        ],
      },
    ],
  },

  // ── הזמנות ───────────────────────────────────────────────────────────────
  {
    key: 'orders',
    label: 'הזמנות',
    icon: 'shopping_cart',
    description: 'ההזמנות, התשלומים והביטולים.',
    permissions: [
      {
        key: 'orders.view',
        label: 'גישה להזמנות',
        description: 'כניסה למסך ההזמנות ופתיחת הזמנה.',
        baseline: BASELINE.ORDERS,
        tiers: t(true, true, true),
        children: [
          {
            key: 'orders.view_all',
            label: 'צפייה בהזמנות של כל הנציגים',
            description: 'ללא ההרשאה הזו רואים רק הזמנות של הנציג עצמו.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'orders.create',
            label: 'יצירת הזמנה',
            description: 'פתיחת הזמנה חדשה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'orders.edit',
            label: 'עריכת הזמנה',
            description: 'שינוי פריטים, כתובת ומועד אספקה.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'orders.change_status',
            label: 'שינוי סטטוס הזמנה',
            description: 'קידום ההזמנה בין שלבי הטיפול.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'orders.cancel',
            label: 'ביטול הזמנה',
            description: 'ביטול עסקה שכבר נסגרה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'orders.delete',
            label: 'מחיקת הזמנה',
            description: 'מחיקה סופית — לא ניתנת לשחזור.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'orders.edit_prices',
            label: 'עריכת מחירים בהזמנה',
            description: 'דריסת מחירים אחרי סגירת העסקה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'orders.discount',
            label: 'מתן הנחה בהזמנה',
            description: 'הנחה על הזמנה קיימת.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'orders.payments',
            label: 'תשלומים',
            description: 'צפייה ורישום של תשלומים על ההזמנה.',
            baseline: BASELINE.ORDERS,
            tiers: t(true, true, true),
          },
          {
            key: 'orders.refund',
            label: 'זיכוי והחזר כספי',
            description: 'החזרת כסף ללקוח.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'orders.extra_charges',
            label: 'תוספות לחיוב',
            description: 'הוספת חיובים נלווים להזמנה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'orders.pdf',
            label: 'הפקת מסמך הזמנה',
            description: 'ייצוא ההזמנה כ-PDF.',
            baseline: BASELINE.ORDERS,
            tiers: t(true, true, true),
          },
          {
            key: 'orders.import',
            label: 'ייבוא הזמנות',
            description: 'ייבוא הזמנות היסטוריות מקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'orders.export',
            label: 'ייצוא הזמנות',
            description: 'הורדת רשימת ההזמנות לקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
        ],
      },
    ],
  },

  // ── כספים ────────────────────────────────────────────────────────────────
  {
    key: 'finance',
    label: 'כספים',
    icon: 'payments',
    description: 'הכנסות, רווחיות, עמלות והנהלת חשבונות.',
    permissions: [
      {
        key: 'finance.view',
        label: 'גישה לאזור הכספים',
        description: 'כניסה לדשבורד הפיננסי.',
        baseline: BASELINE.FINANCE,
        tiers: t(false, false, true),
        children: [
          {
            key: 'finance.revenue',
            label: 'נתוני הכנסות',
            description: 'מחזור המכירות של החברה.',
            baseline: BASELINE.FINANCE,
            tiers: t(false, false, true),
          },
          {
            key: 'finance.profit',
            label: 'רווחיות ועלויות',
            description: 'שולי רווח ועלויות — הנתון הרגיש ביותר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'finance.invoices',
            label: 'חשבוניות',
            description: 'צפייה בחשבוניות ומעקב אחרי הפקתן.',
            baseline: BASELINE.BOOKKEEPING,
            tiers: t(false, false, true),
          },
          {
            key: 'finance.bookkeeping',
            label: 'אזור הנהלת חשבונות',
            description: 'המסך הייעודי של מנהלת החשבונות.',
            baseline: BASELINE.BOOKKEEPING,
            tiers: t(false, false, true),
          },
          {
            key: 'finance.export',
            label: 'ייצוא נתונים פיננסיים',
            description: 'הורדת דוחות כספיים לקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
      {
        key: 'finance.own_commission',
        label: 'צפייה בעמלה האישית',
        description: 'הנציג רואה כמה הוא עצמו הרוויח.',
        baseline: BASELINE.ANY,
        tiers: t(true, true, true),
      },
      {
        key: 'finance.all_commissions',
        label: 'צפייה בעמלות כל הנציגים',
        description: 'טבלת העמלות של כל הצוות.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
      {
        key: 'finance.edit_commission_rate',
        label: 'עריכת אחוז עמלה',
        description: 'שינוי אחוז העמלה של נציג.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, false, true),
      },
      {
        key: 'finance.payment_links',
        label: 'יצירת קישורי תשלום',
        description: 'שליחת בקשת תשלום ללקוח.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
      },
    ],
  },

  // ── שיווק ────────────────────────────────────────────────────────────────
  {
    key: 'marketing',
    label: 'שיווק',
    icon: 'campaign',
    description: 'קמפיינים, עלויות שיווק, דפי נחיתה ומועדון לקוחות.',
    permissions: [
      {
        key: 'marketing.view',
        label: 'גישה לאזור השיווק',
        description: 'כניסה למסך השיווק.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, false, true),
        children: [
          {
            key: 'marketing.costs',
            label: 'צפייה בעלויות שיווק',
            description: 'כמה הושקע בכל ערוץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'marketing.edit_costs',
            label: 'עריכת עלויות שיווק',
            description: 'הזנה ועדכון של תקציבי קמפיין.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'marketing.roi',
            label: 'ניתוח ROI',
            description: 'עלות מול הכנסה לכל מקור.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'marketing.sources',
            label: 'ניהול מקורות ליד',
            description: 'רשימת המקורות והקמפיינים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'marketing.export',
            label: 'ייצוא נתוני שיווק',
            description: 'הורדת נתוני קמפיינים לקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
      {
        key: 'marketing.landing_pages',
        label: 'דפי נחיתה',
        description: 'ניהול דפי הנחיתה המחוברים למערכת.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, false, true),
      },
      {
        key: 'marketing.club_signups',
        label: 'הצטרפויות למועדון',
        description: 'רשימת ההרשמות למועדון הלקוחות.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
    ],
  },

  // ── מפעל וייצור ──────────────────────────────────────────────────────────
  {
    key: 'factory',
    label: 'מפעל וייצור',
    icon: 'precision_manufacturing',
    description: 'לוח הייצור והעבודות במפעל.',
    permissions: [
      {
        key: 'factory.view',
        label: 'גישה לאזור המפעל',
        description: 'כניסה למסכי הייצור.',
        baseline: BASELINE.FACTORY,
        tiers: t(false, false, true),
        children: [
          {
            key: 'factory.board',
            label: 'לוח ייצור',
            description: 'תצוגת העבודות לפי שלב.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'factory.change_status',
            label: 'עדכון סטטוס ייצור',
            description: 'קידום עבודה בין שלבי הייצור.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'factory.assign',
            label: 'שיוך עבודה לעובד',
            description: 'חלוקת עבודות בין אנשי הייצור.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'factory.production_notes',
            label: 'הערות ייצור',
            description: 'כתיבת הנחיות על גבי העבודה.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'factory.reports',
            label: 'דוחות ייצור',
            description: 'עומסים, זמני מחזור ותפוקה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
    ],
  },

  // ── לוגיסטיקה ומשלוחים ───────────────────────────────────────────────────
  {
    key: 'logistics',
    label: 'לוגיסטיקה ומשלוחים',
    icon: 'local_shipping',
    description: 'שיבוץ המשלוחים ומסלולי החלוקה.',
    permissions: [
      {
        key: 'logistics.view',
        label: 'גישה למשלוחים',
        description: 'כניסה למסך המשלוחים.',
        baseline: BASELINE.FACTORY,
        tiers: t(false, false, true),
        children: [
          {
            key: 'logistics.schedule',
            label: 'שיבוץ משלוח',
            description: 'קביעת תאריך וחלון זמן ללקוח.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'logistics.edit',
            label: 'עריכת משלוח',
            description: 'שינוי כתובת, מועד או תכולה.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'logistics.routes',
            label: 'מסלולי חלוקה',
            description: 'בניית מסלול יומי לנהג.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'logistics.map',
            label: 'תצוגת מפה',
            description: 'מפת המשלוחים.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'logistics.driver_details',
            label: 'פרטי נהגים',
            description: 'מי מוביל איזה מסלול.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
        ],
      },
    ],
  },

  // ── מלאי ─────────────────────────────────────────────────────────────────
  {
    key: 'inventory',
    label: 'מלאי',
    icon: 'inventory_2',
    description: 'כמויות במלאי ותנועות מלאי.',
    permissions: [
      {
        key: 'inventory.view',
        label: 'גישה למלאי',
        description: 'צפייה בכמויות הזמינות.',
        baseline: BASELINE.FACTORY,
        tiers: t(false, false, true),
        children: [
          {
            key: 'inventory.edit',
            label: 'עדכון מלאי',
            description: 'שינוי כמויות ידנית.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'inventory.movements',
            label: 'תנועות מלאי',
            description: 'היסטוריית כניסות ויציאות.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
          {
            key: 'inventory.alerts',
            label: 'התראות מלאי נמוך',
            description: 'קבלת התראות על חוסרים.',
            baseline: BASELINE.FACTORY,
            tiers: t(false, false, true),
          },
        ],
      },
    ],
  },

  // ── קטלוג מוצרים ─────────────────────────────────────────────────────────
  {
    key: 'catalog',
    label: 'קטלוג מוצרים',
    icon: 'category',
    description: 'המוצרים, המידות, התוספות והמחירים.',
    permissions: [
      {
        key: 'catalog.view',
        label: 'צפייה בקטלוג',
        description: 'נדרש לכל מי שבונה הצעה או הזמנה.',
        baseline: BASELINE.ANY,
        tiers: t(true, true, true),
        children: [
          {
            key: 'catalog.edit',
            label: 'עריכת מוצרים',
            description: 'הוספה, שינוי ומחיקה של מוצרים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'catalog.prices',
            label: 'עריכת מחירי מכירה',
            description: 'שינוי המחיר שהלקוח משלם.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'catalog.cost_prices',
            label: 'צפייה במחירי עלות',
            description: 'כמה המוצר עולה לחברה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'catalog.addons',
            label: 'ניהול תוספות',
            description: 'תוספות ואפשרויות למוצר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'catalog.sizes',
            label: 'ניהול מידות',
            description: 'מידות גלובליות ומחירים לפי מידה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'catalog.import',
            label: 'ייבוא מוצרים',
            description: 'ייבוא קטלוג מגוגל שיטס.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
    ],
  },

  // ── שירות והחזרות ────────────────────────────────────────────────────────
  {
    key: 'service',
    label: 'מרכז שירות והחזרות',
    icon: 'support_agent',
    description: 'פניות שירות, טיפול בהן והחזרות.',
    permissions: [
      {
        key: 'service.view',
        label: 'גישה למרכז השירות',
        description: 'צפייה בפניות השירות.',
        baseline: BASELINE.SUPPORT,
        tiers: t(true, true, true),
        children: [
          {
            key: 'service.open_ticket',
            label: 'פתיחת פניית שירות',
            description: 'כל נציג יכול לפתוח פנייה על הזמנה.',
            baseline: BASELINE.SUPPORT,
            tiers: t(true, true, true),
          },
          {
            key: 'service.manage',
            label: 'ניהול מרכז השירות',
            description: 'הרשאת מנהל השירות — טיפול בכל הפניות.',
            baseline: BASELINE.SERVICE_MANAGE,
            tiers: t(false, true, true),
          },
          {
            key: 'service.assign',
            label: 'שיוך פנייה לנציג',
            description: 'הטלת טיפול בפנייה על נציג.',
            baseline: BASELINE.SERVICE_MANAGE,
            tiers: t(false, true, true),
          },
          {
            key: 'service.close',
            label: 'סגירת פנייה',
            description: 'סימון פנייה כטופלה.',
            baseline: BASELINE.SERVICE_MANAGE,
            tiers: t(false, true, true),
          },
          {
            key: 'service.import',
            label: 'ייבוא פניות',
            description: 'ייבוא מרוכז של פניות שירות.',
            baseline: BASELINE.SERVICE_MANAGE,
            tiers: t(false, false, true),
          },
        ],
      },
      {
        key: 'service.returns',
        label: 'גישה להחזרות',
        description: 'מסך ההחזרות והזיכויים.',
        baseline: BASELINE.SUPPORT,
        tiers: t(true, true, true),
        children: [
          {
            key: 'service.returns_approve',
            label: 'אישור החזרה',
            description: 'אישור סופי של החזרת מוצר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
        ],
      },
    ],
  },

  // ── תקשורת ───────────────────────────────────────────────────────────────
  {
    key: 'comms',
    label: 'תקשורת — וואטסאפ, SMS ושיחות',
    icon: 'forum',
    description: 'ערוצי התקשורת עם הלקוח וההיסטוריה שלהם.',
    permissions: [
      {
        key: 'comms.whatsapp',
        label: "גישה לצ'אט וואטסאפ",
        description: 'מסך השיחות של הנציג.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
        children: [
          {
            key: 'comms.whatsapp_all_chats',
            label: 'צפייה בשיחות של כל הנציגים',
            description: 'ללא ההרשאה הזו רואים רק את השיחות של החיבור האישי.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'comms.whatsapp_send',
            label: 'שליחת הודעות',
            description: 'שליחה יזומה ללקוח.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'comms.whatsapp_templates',
            label: 'שימוש בתבניות',
            description: 'תבניות ההודעה המוכנות בקומפוזר.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'comms.whatsapp_accounts',
            label: 'ניהול חיבורי וואטסאפ',
            description: 'חיבור וניתוק של מכשירים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
      {
        key: 'comms.sms',
        label: 'שליחת SMS',
        description: 'שליחת מסרונים ללקוח.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
      },
      {
        key: 'comms.email',
        label: 'שליחת מייל',
        description: 'שליחת מסמכים והודעות במייל.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
      },
      {
        key: 'comms.calls',
        label: 'שיחות טלפון',
        description: 'חיוג מהמערכת ותיעוד שיחות.',
        baseline: BASELINE.SALES,
        tiers: t(true, true, true),
        children: [
          {
            key: 'comms.click_to_call',
            label: 'חיוג בלחיצה',
            description: 'התחלת שיחה מתוך כרטיס הליד.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'comms.call_history',
            label: 'היסטוריית שיחות',
            description: 'רשימת השיחות שבוצעו.',
            baseline: BASELINE.SALES,
            tiers: t(true, true, true),
          },
          {
            key: 'comms.call_recordings',
            label: 'האזנה להקלטות',
            description: 'הקלטות שיחה — כולל של נציגים אחרים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'comms.call_analytics',
            label: 'ניתוח שיחות',
            description: 'מסך האנליטיקה של השיחות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
        ],
      },
    ],
  },

  // ── דוחות ────────────────────────────────────────────────────────────────
  {
    key: 'reports',
    label: 'דוחות ואנליטיקה',
    icon: 'analytics',
    description: 'דוחות תפעוליים, ביצועי מכירות וייצוא נתונים.',
    permissions: [
      {
        key: 'reports.operational',
        label: 'דוחות תפעוליים',
        description: 'מסך הדוחות התפעוליים.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
      {
        key: 'reports.sales',
        label: 'דוחות מכירות',
        description: 'ניתוח מכירות לפי תקופה ומוצר.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
      {
        key: 'reports.own_performance',
        label: 'ביצועים אישיים',
        description: 'הנציג רואה את הנתונים של עצמו.',
        baseline: BASELINE.ANY,
        tiers: t(true, true, true),
      },
      {
        key: 'reports.team_performance',
        label: 'ביצועי כל הצוות',
        description: 'השוואת נציגים.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
      {
        key: 'reports.export_csv',
        label: 'ייצוא דוחות',
        description: 'הורדת דוחות לאקסל / CSV.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
    ],
  },

  // ── צוות ─────────────────────────────────────────────────────────────────
  {
    key: 'team',
    label: 'צוות ונציגים',
    icon: 'groups',
    description: 'ניהול אנשי הצוות — פרטים, לו״ז, מסמכים והרשאות.',
    permissions: [
      {
        key: 'team.view',
        label: 'צפייה ברשימת הנציגים',
        description: 'מסך הנציגים.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
        children: [
          {
            key: 'team.create',
            label: 'הוספת נציג',
            description: 'פתיחת משתמש חדש ושליחת הזמנה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.edit_details',
            label: 'עריכת פרטי נציג',
            description: 'שם, טלפון ושלוחה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'team.deactivate',
            label: 'השבתת נציג',
            description: 'חסימת התחברות והעברת הלידים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.delete',
            label: 'מחיקת נציג',
            description: 'מחיקה לצמיתות — לא ניתנת לשחזור.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.passwords',
            label: 'איפוס וקביעת סיסמה',
            description: 'שליחת קישור איפוס או קביעת סיסמה ידנית.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.work_schedule',
            label: 'לו״ז שבועי של נציג',
            description: 'ימי ושעות העבודה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'team.vacations',
            label: 'ימי חופשה',
            description: 'מכסה ורישום חופשות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'team.documents',
            label: 'מסמכי עובד',
            description: 'חוזה, טופס 101 ותעודות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.commission_rate',
            label: 'אחוז עמלה של נציג',
            description: 'צפייה ועריכה של אחוז העמלה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.permissions',
            label: 'עריכת הרשאות של נציג',
            description: 'הטאב "הרשאות" בכרטיס הנציג.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.access_level',
            label: 'שינוי רמת הרשאה של נציג',
            description: 'העברת נציג בין נציג / מנהל חנות / מנהל ראשי. אי אפשר להעניק רמה גבוהה משלך.',
            baseline: BASELINE.NONE,
            tiers: t(false, false, true),
          },
          {
            key: 'team.impersonate',
            label: 'התחזות לנציג',
            description: 'צפייה במערכת דרך העיניים של נציג אחר.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'team.import',
            label: 'ייבוא נציגים',
            description: 'פתיחת משתמשים מקובץ.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
        ],
      },
      {
        key: 'team.shift_schedule',
        label: 'צפייה בשיבוץ משמרות',
        description: 'הלוח השבועי של המשמרות.',
        baseline: BASELINE.ANY,
        tiers: t(true, true, true),
        children: [
          {
            key: 'team.shift_schedule_edit',
            label: 'עריכת שיבוץ משמרות',
            description: 'שיבוץ נציגים למשמרות. ללא זה — צפייה בלבד.',
            baseline: BASELINE.EDIT_SCHEDULE,
            tiers: t(false, true, true),
          },
        ],
      },
    ],
  },

  // ── הגדרות ───────────────────────────────────────────────────────────────
  // The one area the brief calls out explicitly: block the whole screen, or a
  // single card inside it, or a single control inside that card. Each level of
  // nesting below is a real level of blocking.
  {
    key: 'settings',
    label: 'הגדרות המערכת',
    icon: 'settings',
    description:
      'כל סעיף במסך ההגדרות בנפרד. חסימת סעיף אב חוסמת אוטומטית את כל תת-הסעיפים שמתחתיו.',
    permissions: [
      {
        key: 'settings.access',
        label: 'כניסה למסך ההגדרות',
        description: 'כיבוי כאן חוסם את מסך ההגדרות כולו, על כל סעיפיו.',
        baseline: BASELINE.ANY,
        tiers: t(true, true, true),
        children: [
          {
            key: 'settings.profile',
            label: 'פרופיל אישי',
            description: 'הפרטים של המשתמש עצמו.',
            baseline: BASELINE.ANY,
            tiers: t(true, true, true),
            children: [
              {
                key: 'settings.profile.edit_name',
                label: 'עריכת שם מלא',
                description: 'שינוי השם המוצג.',
                baseline: BASELINE.ANY,
                tiers: t(true, true, true),
              },
              {
                key: 'settings.profile.avatar',
                label: 'תמונת פרופיל',
                description: 'העלאה והחלפה של תמונה.',
                baseline: BASELINE.ANY,
                tiers: t(true, true, true),
              },
              {
                key: 'settings.profile.notifications',
                label: 'התראות Push',
                description: 'הפעלת התראות במכשיר.',
                baseline: BASELINE.ANY,
                tiers: t(true, true, true),
              },
              {
                key: 'settings.profile.whatsapp_agent',
                label: 'חיבור לסוכן וואטסאפ',
                description: 'חיבור אישי לסוכן המכירות.',
                baseline: BASELINE.ANY,
                tiers: t(true, true, true),
              },
            ],
          },
          {
            key: 'settings.users',
            label: 'נציגים',
            description: 'הסעיף שמכיל את ניהול הצוות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
            children: [
              {
                key: 'settings.users.details',
                label: 'פרטי נציג',
                description: 'הטאב "פרטים" בכרטיס הנציג.',
                baseline: BASELINE.ADMIN,
                tiers: t(false, true, true),
              },
              {
                key: 'settings.users.schedule',
                label: 'לו״ז וחופשות',
                description: 'הטאבים "לו״ז" ו"חופשות".',
                baseline: BASELINE.ADMIN,
                tiers: t(false, true, true),
              },
              {
                key: 'settings.users.permissions',
                label: 'הרשאות נציג',
                description: 'הטאב "הרשאות" בכרטיס הנציג.',
                baseline: BASELINE.ADMIN,
                tiers: t(false, false, true),
              },
              {
                key: 'settings.users.documents',
                label: 'מסמכים',
                description: 'הטאב "קבצים".',
                baseline: BASELINE.ADMIN,
                tiers: t(false, false, true),
              },
              {
                key: 'settings.users.whatsapp',
                label: 'חיבור וואטסאפ לנציג',
                description: 'הטאב "וואטסאפ" בכרטיס הנציג.',
                baseline: BASELINE.ADMIN,
                tiers: t(false, false, true),
              },
            ],
          },
          {
            key: 'settings.statuses',
            label: 'סטטוסים',
            description: 'ניהול סטטוסי הלידים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
            children: [
              {
                key: 'settings.statuses.hide',
                label: 'הסתרת סטטוסים',
                description: 'הוצאת סטטוס מרשימת הבחירה.',
                baseline: BASELINE.ADMIN,
                tiers: t(false, true, true),
              },
              {
                key: 'settings.statuses.create',
                label: 'יצירת ומחיקת סטטוסים',
                description: 'הוספת סטטוס מותאם.',
                baseline: BASELINE.ADMIN,
                tiers: t(false, false, true),
              },
              {
                key: 'settings.statuses.colors',
                label: 'צבעי סטטוס',
                description: 'התאמת הצבע של כל סטטוס.',
                baseline: BASELINE.ADMIN,
                tiers: t(false, true, true),
              },
            ],
          },
          {
            key: 'settings.lead_import',
            label: 'ייבוא לידים',
            description: 'ייבוא מכוורת / CSV.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.data_import',
            label: 'ייבוא נתונים',
            description: 'ייבוא הזמנות היסטוריות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.quote_defaults',
            label: 'ברירות-מחדל להצעת מחיר',
            description: 'אמצעי התשלום שנבחרים אוטומטית בהצעה חדשה.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'settings.document_terms',
            label: 'טקסטים ותנאים',
            description: 'הנוסח המשפטי על הצעות מחיר והזמנות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.closures',
            label: 'ימי סגירה',
            description: 'חגים וימי אי-פעילות.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'settings.sms',
            label: 'שליחת SMS',
            description: 'חיבור חשבון 019.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.wa_templates',
            label: 'תבניות וואטסאפ',
            description: 'תבניות הודעה וקיצורים.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'settings.wa_alerts',
            label: 'התראות ניתוק וואטסאפ',
            description: 'הודעה לקבוצה כשנציג מתנתק.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.ai',
            label: 'בינה מלאכותית',
            description: 'בחירת מודל לניסוח תוכן.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.bulk',
            label: 'עדכון המוני',
            description: 'כלי העדכון בכמות.',
            baseline: BASELINE.BULK_UPDATE,
            tiers: t(false, true, true),
          },
          {
            key: 'settings.lead_visibility',
            label: 'הרשאות צפייה בלידים',
            description: 'המדיניות הגלובלית — כולם רואים הכל / כל אחד את שלו.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, false, true),
          },
          {
            key: 'settings.menu',
            label: 'תפריט',
            description: 'הסתרה וסידור של פריטי התפריט.',
            baseline: BASELINE.ADMIN,
            tiers: t(false, true, true),
          },
          {
            key: 'settings.permissions',
            label: 'הרשאות ותפקידים',
            description:
              'המסך הזה עצמו. שמור לסופר אדמין — מי שיכול לערוך הרשאות יכול להעניק לעצמו הכול.',
            baseline: BASELINE.NONE,
            tiers: t(false, false, false),
            children: [
              {
                key: 'settings.permissions.roles',
                label: 'עריכת מטריצת ההרשאות',
                description: 'קביעה מה כל רמת הרשאה יכולה לעשות.',
                baseline: BASELINE.NONE,
                tiers: t(false, false, false),
              },
              {
                key: 'settings.permissions.per_user',
                label: 'חריגים פרטניים לנציג',
                description: 'פתיחה או חסימה של הרשאה לנציג בודד.',
                baseline: BASELINE.NONE,
                tiers: t(false, false, false),
              },
              {
                key: 'settings.permissions.super_admin',
                label: 'מינוי סופר אדמין',
                description: 'הענקה והסרה של רמת סופר אדמין.',
                baseline: BASELINE.NONE,
                tiers: t(false, false, false),
              },
            ],
          },
        ],
      },
    ],
  },

  // ── מערכת ────────────────────────────────────────────────────────────────
  {
    key: 'system',
    label: 'מערכת ואבטחה',
    icon: 'security',
    description: 'יומן פעולות, חיבורים חיצוניים ופעולות רגישות.',
    permissions: [
      {
        key: 'system.audit_log',
        label: 'יומן פעולות',
        description: 'מי עשה מה ומתי במערכת.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, false, true),
      },
      {
        key: 'system.notifications_admin',
        label: 'שליחת התראות לצוות',
        description: 'דחיפת התראה לנציגים.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, true, true),
      },
      {
        key: 'system.integrations',
        label: 'חיבורים חיצוניים',
        description: 'VoiceCenter, גוגל שיטס, סליקה וכדומה.',
        baseline: BASELINE.ADMIN,
        tiers: t(false, false, true),
      },
      {
        key: 'system.danger_zone',
        label: 'פעולות בלתי הפיכות',
        description: 'מחיקות מרוכזות ואיפוסי נתונים. סופר אדמין בלבד.',
        baseline: BASELINE.NONE,
        tiers: t(false, false, false),
      },
    ],
  },
];

// ── Index ──────────────────────────────────────────────────────────────────
// Built once at module load: key → { node, parentKey, groupKey, depth, path }.
// The resolver walks parents on every check, so this has to be a map lookup
// rather than a tree search.

const INDEX = new Map();

function indexNode(node, groupKey, parentKey, depth) {
  const entry = {
    ...node,
    groupKey,
    parentKey,
    depth,
    childKeys: (node.children || []).map((c) => c.key),
  };
  INDEX.set(node.key, entry);
  for (const child of node.children || []) {
    indexNode(child, groupKey, node.key, depth + 1);
  }
}

for (const group of PERMISSION_GROUPS) {
  for (const node of group.permissions) indexNode(node, group.key, null, 0);
}

export const PERMISSION_KEYS = Array.from(INDEX.keys());

export function getPermission(key) {
  return INDEX.get(key) || null;
}

export function permissionExists(key) {
  return INDEX.has(key);
}

/** [parent, grandparent, …] for `key`, closest first. */
export function getAncestorKeys(key) {
  const out = [];
  let current = INDEX.get(key);
  while (current?.parentKey) {
    out.push(current.parentKey);
    current = INDEX.get(current.parentKey);
  }
  return out;
}

/** Every key beneath `key`, at any depth. */
export function getDescendantKeys(key) {
  const entry = INDEX.get(key);
  if (!entry) return [];
  const out = [];
  const stack = [...entry.childKeys];
  while (stack.length) {
    const next = stack.pop();
    out.push(next);
    const child = INDEX.get(next);
    if (child) stack.push(...child.childKeys);
  }
  return out;
}

export function getGroup(groupKey) {
  return PERMISSION_GROUPS.find((g) => g.key === groupKey) || null;
}

/** Flat list of every permission entry — used by the search box in the UI. */
export function allPermissions() {
  return Array.from(INDEX.values());
}
