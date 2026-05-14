// Maps task outcomes to lead-status transitions and the next task that
// should automatically appear. Consumed by CompleteTaskDialog and by the
// quick-action buttons in Leads.jsx / LeadDetails.
//
// Each outcome has:
//   id            — stable identifier
//   label         — Hebrew text shown on the button
//   tone          — color hint: 'success' | 'warn' | 'danger' | 'neutral' | 'whatsapp'
//   newLeadStatus — either a literal status string or (currentStatus) => string.
//                   Use the function form to preserve special states
//                   (e.g. an after-quote followup should stay after-quote).
//                   Returning null/undefined keeps the current status.
//   nextTask      — optional next task config:
//     - task_type:    one of call | meeting | quote_preparation | close_order
//     - askForDateTime: true  → CompleteTaskDialog shows a picker
//     - delayHours / delayDays → automatic offset from now
//     - summary:      default text for the new task
//   redirectTo    — optional URL key, e.g. 'NewOrder' for the deal-closed case

const incrementNoAnswer = (currentStatus) => {
  const match = /^no_answer_(\d+)$/.exec(currentStatus || '');
  if (match) {
    const n = Math.min(5, parseInt(match[1], 10) + 1);
    return `no_answer_${n}`;
  }
  return 'no_answer_1';
};

const keepFollowupTier = (currentStatus) =>
  currentStatus === 'followup_after_quote' ? 'followup_after_quote' : 'followup_before_quote';

export const TASK_COMPLETION_FLOWS = {
  call: [
    {
      id: 'answered_interested',
      label: 'ענה — מעוניין',
      tone: 'success',
      newLeadStatus: 'hot_lead',
      nextTask: {
        task_type: 'quote_preparation',
        delayHours: 24,
        summary: 'להכין הצעת מחיר',
      },
    },
    {
      id: 'answered_callback',
      label: 'ענה — חוזר אליי',
      tone: 'warn',
      newLeadStatus: keepFollowupTier,
      nextTask: {
        task_type: 'call',
        askForDateTime: true,
        summary: 'שיחת חזרה',
      },
    },
    {
      id: 'answered_not_interested',
      label: 'ענה — לא מעוניין',
      tone: 'danger',
      newLeadStatus: 'heard_price_not_interested',
    },
    {
      id: 'no_answer',
      label: 'לא ענה',
      tone: 'neutral',
      newLeadStatus: incrementNoAnswer,
      nextTask: {
        task_type: 'call',
        delayHours: 24,
        summary: 'ניסיון התקשרות נוסף',
      },
    },
    {
      id: 'sent_whatsapp',
      label: 'שלחתי וואטסאפ',
      tone: 'whatsapp',
      newLeadStatus: 'no_answer_whatsapp_sent',
      nextTask: {
        task_type: 'call',
        delayHours: 24,
        summary: 'פולאפ אחרי וואטסאפ',
      },
    },
  ],

  meeting: [
    {
      id: 'deal_closed',
      label: 'סגרנו עסקה 🎉',
      tone: 'success',
      newLeadStatus: 'deal_closed',
      redirectTo: 'NewOrder',
    },
    {
      id: 'send_quote',
      label: 'צריך לשלוח הצעה',
      tone: 'success',
      newLeadStatus: 'followup_after_quote',
      nextTask: {
        task_type: 'quote_preparation',
        delayHours: 24,
        summary: 'להכין הצעת מחיר אחרי פגישה',
      },
    },
    {
      id: 'callback_after_meeting',
      label: 'הלקוח חוזר אליי',
      tone: 'warn',
      newLeadStatus: keepFollowupTier,
      nextTask: {
        task_type: 'call',
        askForDateTime: true,
        summary: 'שיחת חזרה אחרי פגישה',
      },
    },
    {
      id: 'not_relevant',
      label: 'לא רלוונטי',
      tone: 'danger',
      newLeadStatus: 'not_relevant_no_explanation',
    },
    {
      id: 'no_show',
      label: 'לא הגיע',
      tone: 'neutral',
      newLeadStatus: null,
      nextTask: {
        task_type: 'call',
        delayHours: 24,
        summary: 'תיאום פגישה חדשה',
      },
    },
  ],

  quote_preparation: [
    {
      id: 'sent_to_customer',
      label: 'שלחתי ללקוח',
      tone: 'success',
      newLeadStatus: 'followup_after_quote',
      nextTask: {
        task_type: 'call',
        delayDays: 3,
        summary: 'פולאפ הצעת מחיר',
      },
    },
    {
      id: 'negotiating',
      label: 'דחה — משא ומתן',
      tone: 'warn',
      newLeadStatus: 'followup_after_quote',
      nextTask: {
        task_type: 'call',
        delayHours: 24,
        summary: 'המשך משא ומתן',
      },
    },
    {
      id: 'lost',
      label: 'לקוח לא מעוניין',
      tone: 'danger',
      newLeadStatus: 'heard_price_not_interested',
    },
  ],

  close_order: [
    {
      id: 'closed',
      label: 'נסגר ✓',
      tone: 'success',
      newLeadStatus: 'deal_closed',
      redirectTo: 'NewOrder',
    },
    {
      id: 'postponed',
      label: 'דחה למועד אחר',
      tone: 'warn',
      newLeadStatus: 'followup_after_quote',
      nextTask: {
        task_type: 'call',
        askForDateTime: true,
        summary: 'שיחת חזרה לסגירה',
      },
    },
    {
      id: 'cancelled',
      label: 'לא יסגור',
      tone: 'danger',
      newLeadStatus: 'not_relevant_no_explanation',
    },
  ],
};

// Tones map to Tailwind utility classes used by the dialog buttons.
export const TONE_CLASSES = {
  success: 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800',
  warn: 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800',
  danger: 'border-red-300 bg-red-50 hover:bg-red-100 text-red-800',
  neutral: 'border-border bg-muted hover:bg-muted/70 text-foreground',
  whatsapp: 'border-green-300 bg-green-50 hover:bg-green-100 text-green-800',
};

// Resolve a (currentStatus) => newStatus function or static string.
export function resolveOutcomeStatus(outcome, currentStatus) {
  if (typeof outcome.newLeadStatus === 'function') {
    return outcome.newLeadStatus(currentStatus);
  }
  return outcome.newLeadStatus ?? null;
}

// Compute the due-date ISO string for the auto-created follow-up task.
// Returns null when the outcome doesn't create a follow-up.
export function computeNextTaskDueDate(outcome, manualDateTime) {
  if (!outcome.nextTask) return null;
  if (outcome.nextTask.askForDateTime) {
    return manualDateTime || null;
  }
  const now = new Date();
  if (outcome.nextTask.delayHours) {
    now.setHours(now.getHours() + outcome.nextTask.delayHours);
    return now.toISOString();
  }
  if (outcome.nextTask.delayDays) {
    now.setDate(now.getDate() + outcome.nextTask.delayDays);
    return now.toISOString();
  }
  return now.toISOString();
}
