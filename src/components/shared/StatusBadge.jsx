import React from 'react';

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
  not_started: { label: 'טרם התחיל', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  materials_check: { label: 'בדיקת חומרים', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  in_production: { label: 'בייצור', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  qc: { label: 'בקרת איכות', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  ready: { label: 'מוכן', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  
  // Delivery Status
  need_scheduling: { label: 'לתאום', color: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200' },
  scheduled: { label: 'מתואם', color: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  dispatched: { label: 'יצא לדרך', color: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' },
  in_transit: { label: 'בדרך', color: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200' },
  delivered: { label: 'נמסר', color: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' },
  failed: { label: 'נכשל', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  returned: { label: 'הוחזר', color: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  
  // Payment Status
  unpaid: { label: 'לא שולם', color: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  deposit_paid: { label: 'מקדמה', color: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
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
  answered_positive: { label: 'חיובי', color: 'bg-green-100 text-green-700 ring-1 ring-green-200' },
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

// Extract the dot color from the text color class
function getDotColor(colorString) {
  const match = colorString.match(/text-(\w+)-(\d+)/);
  if (!match) return 'bg-gray-400';
  return `bg-${match[1]}-${match[2]}`;
}

export default function StatusBadge({ status, className = '' }) {
  const config = statusConfig[status] || { label: status, color: 'bg-gray-100 text-gray-600' };
  // Remove ring classes for cleaner look
  const cleanColor = config.color.replace(/ring-1\s*/g, '').replace(/ring-\w+-\d+/g, '').trim();
  const dotColor = getDotColor(config.color);

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ${cleanColor} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
      {config.label}
    </span>
  );
}