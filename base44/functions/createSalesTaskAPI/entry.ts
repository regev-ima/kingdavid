import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Map Hebrew status values to English enum values
const STATUS_MAP = {
  'ליד חדש': 'new_lead',
  'ליד חם': 'hot_lead',
  'פולואפ - לפני הצעת מחיר': 'followup_before_quote',
  'פולואפ - אחרי הצעת מחיר': 'followup_after_quote',
  'מעקב לפני הצעה': 'followup_before_quote',
  'מעקב אחרי הצעה': 'followup_after_quote',
  'יגיע לסניף לפגישה': 'coming_to_branch',
  'יגיע לסניף': 'coming_to_branch',
  'מגיע לסניף': 'coming_to_branch',
  'לא ענה 1': 'no_answer_1',
  'לא ענה 2': 'no_answer_2',
  'לא ענה 3': 'no_answer_3',
  'לא ענה 4': 'no_answer_4',
  'לא ענה 5': 'no_answer_5',
  'לא ענה - נשלח וואטסאפ': 'no_answer_whatsapp_sent',
  'לא ענה - שיחות': 'no_answer_calls',
  'שינה כיוון': 'changed_direction',
  'עסקה נסגרה': 'deal_closed',
  'לא רלוונטי - כפול': 'not_relevant_duplicate',
  'בקשת הסרה מדיוור': 'mailing_remove_request',
  'גר רחוק - חשש טלפוני': 'lives_far_phone_concern',
  'מוצרים לא זמינים': 'products_not_available',
  'לא רלוונטי - קנה במקום אחר': 'not_relevant_bought_elsewhere',
  'לא רלוונטי - 1000 שח': 'not_relevant_1000_nis',
  'לא רלוונטי - מכחיש פנייה': 'not_relevant_denies_contact',
  'לא רלוונטי - שירות': 'not_relevant_service',
  'לא מעוניין - מנתק': 'not_interested_hangs_up',
  'לא מעונין לדבר - מנתק': 'not_interested_hangs_up',
  'לא רלוונטי - ללא הסבר': 'not_relevant_no_explanation',
  'שמע מחיר לא מעוניין': 'heard_price_not_interested',
  'לא רלוונטי - מספר שגוי': 'not_relevant_wrong_number',
  'סגור ע"י מנהל לדיוור': 'closed_by_manager_to_mailing',
};

const TASK_STATUS_MAP = {
  'לא הושלמה': 'not_completed',
  'בוצעה': 'completed',
  'הושלמה': 'completed',
};

const TASK_TYPE_MAP = {
  'שיחה': 'call',
  'וואטסאפ': 'whatsapp',
  'מייל': 'email',
  'פגישה': 'meeting',
  'הכנת הצעת מחיר': 'quote_preparation',
  'הצעת מחיר': 'quote_preparation',
  'מעקב': 'followup',
  'אחר': 'other',
};

// Valid enum values from schema
const VALID_STATUSES = ['new_lead','hot_lead','followup_before_quote','followup_after_quote','coming_to_branch','no_answer_1','no_answer_2','no_answer_3','no_answer_4','no_answer_5','no_answer_whatsapp_sent','no_answer_calls','changed_direction','deal_closed','not_relevant_duplicate','mailing_remove_request','lives_far_phone_concern','products_not_available','not_relevant_bought_elsewhere','not_relevant_1000_nis','not_relevant_denies_contact','not_relevant_service','not_interested_hangs_up','not_relevant_no_explanation','heard_price_not_interested','not_relevant_wrong_number','closed_by_manager_to_mailing'];
const VALID_TASK_STATUSES = ['not_completed', 'completed', 'not_done', 'cancelled'];
const VALID_TASK_TYPES = ['call','whatsapp','email','meeting','quote_preparation','followup','assignment','other'];

function resolveStatus(val) {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (VALID_STATUSES.includes(trimmed)) return trimmed;
  return STATUS_MAP[trimmed] || undefined;
}

function resolveTaskStatus(val) {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (VALID_TASK_STATUSES.includes(trimmed)) return trimmed;
  return TASK_STATUS_MAP[trimmed] || undefined;
}

function resolveTaskType(val) {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (VALID_TASK_TYPES.includes(trimmed)) return trimmed;
  return TASK_TYPE_MAP[trimmed] || undefined;
}

// Parse date strings like "19/01/2026 10:40" or "26/01/2026 13:00" to ISO format
function parseDate(val) {
  if (!val) return undefined;
  const trimmed = val.trim();
  
  // Already ISO format
  if (trimmed.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed;
  
  // dd/MM/yyyy HH:mm format
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/);
  if (match) {
    const [, day, month, year, hour, minute] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`;
  }
  
  // dd/MM/yyyy format (no time)
  const matchDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (matchDate) {
    const [, day, month, year] = matchDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return trimmed;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    
    // Support single task or array of tasks
    const tasks = Array.isArray(body) ? body : [body];
    
    const results = [];
    
    for (const task of tasks) {
      let leadId = task.lead_id || null;
      
      // If no lead_id but phone is provided, search for lead by phone
      if (!leadId && task.phone) {
        // Build search variants for Israeli phone formats (unified logic)
        const digits = task.phone.replace(/[^0-9]/g, '');
        const searchPhones = [];
        if (digits.startsWith('05') && digits.length === 10) {
          searchPhones.push(digits);
          searchPhones.push('972' + digits.substring(1));
        } else if (digits.startsWith('9725') && digits.length === 12) {
          searchPhones.push(digits);
          searchPhones.push('0' + digits.substring(3));
        } else if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
          searchPhones.push(digits);
          searchPhones.push('972' + digits.substring(1));
        } else if (digits.startsWith('972') && digits.length >= 11) {
          searchPhones.push(digits);
          searchPhones.push('0' + digits.substring(3));
        } else {
          searchPhones.push(digits);
        }

        for (const sPhone of searchPhones) {
          const leads = await base44.asServiceRole.entities.Lead.filter({ phone: sPhone });
          if (leads && leads.length > 0) {
            leadId = leads[0].id;
            break;
          }
        }
      }
      
      if (!leadId) {
        results.push({
          success: false,
          error: 'לא נמצא ליד - יש לספק lead_id או phone תקין',
          input: task,
        });
        continue;
      }
      
      const salesTaskData = {
        lead_id: leadId,
      };
      
      // Map optional fields with Hebrew-to-English translation and date parsing
      if (task.unique_id) salesTaskData.unique_id = task.unique_id;
      if (task.rep1) salesTaskData.rep1 = task.rep1;
      if (task.rep2) salesTaskData.rep2 = task.rep2;
      if (task.pending_rep_email) salesTaskData.pending_rep_email = task.pending_rep_email;
      if (task.manual_created_date) salesTaskData.manual_created_date = parseDate(task.manual_created_date);
      if (task.work_start_date) salesTaskData.work_start_date = parseDate(task.work_start_date);
      if (task.due_date) salesTaskData.due_date = parseDate(task.due_date);
      if (task.summary) salesTaskData.summary = task.summary;

      // Resolve status (Hebrew or English)
      const resolvedStatus = resolveStatus(task.status);
      if (resolvedStatus) salesTaskData.status = resolvedStatus;

      // Resolve task_status (Hebrew or English)
      const resolvedTaskStatus = resolveTaskStatus(task.task_status);
      if (resolvedTaskStatus) salesTaskData.task_status = resolvedTaskStatus;

      // Resolve task_type (Hebrew or English)
      const resolvedTaskType = resolveTaskType(task.task_type);
      if (resolvedTaskType) salesTaskData.task_type = resolvedTaskType;
      
      // Update the Lead's status if provided in the task payload
      if (leadId && resolvedStatus) {
        await base44.asServiceRole.entities.Lead.update(leadId, { status: resolvedStatus });
      }

      const created = await base44.asServiceRole.entities.SalesTask.create(salesTaskData);
      
      results.push({
        success: true,
        id: created.id,
        lead_id: leadId,
      });
    }
    
    return Response.json({
      total: tasks.length,
      success_count: results.filter(r => r.success).length,
      failed_count: results.filter(r => !r.success).length,
      results,
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});