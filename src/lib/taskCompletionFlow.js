// The outcomes a task can be closed with, and the next task each one suggests.
// Consumed by CompleteTaskDialog.
//
// Closing a task does NOT touch the lead's status. It used to: "ענה — מעוניין"
// wrote 'hot_lead', "לא ענה" walked the no-answer ladder, and so on. But the
// rep had already put the lead where it belongs — a lead sitting in "מעוניין
// מאוד" got flipped to "ליד רותח" for the crime of having its task closed, and
// the rep's own judgement was overwritten by a button that was only ever asked
// "what happened on this call?".
//
// The two questions are separate. This dialog answers "what happened"; the
// status is the rep's answer to "where is this lead now", and they set it on
// the lead card. ("ענה — לא מעוניין" was already carved out this way for the
// same reason; this is the rest of the list catching up.)
//
// ONE exception survives, and it is not a judgement call: "לא ענה" walks the
// no-answer ladder (no_answer_1 → 2 → … → 5). That status is a COUNT of failed
// attempts, not an opinion about the lead — the rep cannot be asked to keep it
// by hand, and the whole ladder is worthless if it stops counting.
//
// Whether the `nextTask` on an outcome actually fires is decided by the status
// the lead is IN, via outcomeOpensNextTask() below. See AUTO_TASK_STATUSES in
// constants/leadOptions.

import { statusOpensAutoTask } from '@/constants/leadOptions';

// no_answer_3 → no_answer_4, capped at 5. A lead with no ladder status yet
// starts at 1.
const incrementNoAnswer = (currentStatus) => {
  const match = /^no_answer_(\d+)$/.exec(currentStatus || '');
  if (match) {
    const n = Math.min(5, parseInt(match[1], 10) + 1);
    return `no_answer_${n}`;
  }
  return 'no_answer_1';
};
//
// Each outcome has:
//   id            — stable identifier
//   label         — Hebrew text shown on the button
//   tone          — color hint: 'success' | 'warn' | 'danger' | 'neutral' | 'whatsapp'
//   newLeadStatus — optional. A literal status, or (currentStatus) => status.
//                   Absent on almost every outcome by design (see above); only
//                   the no-answer ladder still moves a lead by itself.
//   nextTask      — optional next task config:
//     - task_type:    one of call | meeting | quote_preparation | close_order
//     - askForDateTime: true  → CompleteTaskDialog shows a picker
//     - delayHours / delayDays → automatic offset from now
//     - summary:      default text for the new task

export const TASK_COMPLETION_FLOWS = {
  call: [
    {
      id: 'answered_interested',
      label: 'ענה — מעוניין',
      tone: 'success',
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
    },
    {
      id: 'no_answer',
      label: 'לא ענה',
      tone: 'neutral',
      // The ladder — the one status this dialog still writes. See the note at
      // the top of the file.
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
    },
    {
      id: 'send_quote',
      label: 'צריך לשלוח הצעה',
      tone: 'success',
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
    },
    {
      id: 'no_show',
      label: 'לא הגיע',
      tone: 'neutral',
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
    },
  ],

  close_order: [
    {
      id: 'closed',
      label: 'נסגר ✓',
      tone: 'success',
    },
    {
      id: 'postponed',
      label: 'דחה למועד אחר',
      tone: 'warn',
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

// Resolve a (currentStatus) => newStatus function or static string. Returns
// null for the outcomes that leave the lead's status alone, which is most of
// them.
export function resolveOutcomeStatus(outcome, currentStatus) {
  if (typeof outcome?.newLeadStatus === 'function') {
    return outcome.newLeadStatus(currentStatus);
  }
  return outcome?.newLeadStatus ?? null;
}

/**
 * Should closing a task with this outcome pre-arm the next one?
 *
 * Only when the lead is in a status that schedules itself — follow-up
 * before/after quote, or a meeting. Every other outcome closes the task and
 * stops: "לא ענה" doesn't mint another call, "ענה — מעוניין" doesn't mint a
 * quote task. The rep opens what they need, from the toggle in the dialog.
 *
 * Judged on the status the lead ends up in — which for every outcome but the
 * no-answer ladder is simply the status it already had.
 */
export function outcomeOpensNextTask(outcome, currentStatus) {
  if (!outcome?.nextTask) return false;
  return statusOpensAutoTask(resolveOutcomeStatus(outcome, currentStatus) ?? currentStatus);
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
