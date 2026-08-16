import { base44 } from '@/api/base44Client';
import { statusOpensAutoTask } from '@/constants/leadOptions';
import { closeSalesTask } from '@/lib/closeSalesTask';

const IDLE_NOTE = 'בוטלה אוטומטית – הסטטוס של הליד אינו מצריך משימה פתוחה';

// An open task is a commitment to do something on a date. Three lead statuses
// ARE that commitment — follow-up before quote, follow-up after quote, and a
// booked meeting (AUTO_TASK_STATUSES). A lead in any other status has stopped
// moving, and a task hanging off it is a reminder nobody will ever act on: it
// sits in "באיחור" forever and inflates every open-task number on the floor.
//
// So the rule that opens a task now also closes one. Whenever a lead's status
// changes, this sweeps the tasks the new status no longer justifies.
//
// 'deal_closed' is deliberately NOT one of them. It used to be the first status
// this sweep was written for, and it was wrong: a closed deal is the start of
// the work, not the end of it. The customer who just bought is the one coming
// in on Sunday to choose a fabric, and the meeting the rep booked for that is a
// real appointment with a real person — closing the deal does not un-book it.
// Marking "נסגרה עסקה" now marks the lead closed and touches nothing else.
//
// `exceptTaskId` skips a specific task — callers in the middle of saving that
// same task pass it so the sweep doesn't race their own update. Those callers
// own closing it themselves: see statusKeepsOpenTasks below.
export async function cancelOpenTasksForStatus(leadId, newStatus, exceptTaskId = null) {
  if (!leadId || !newStatus) return;
  if (statusKeepsOpenTasks(newStatus)) return;
  await sweepOpenTasks(leadId, newStatus, IDLE_NOTE, exceptTaskId);
}

/**
 * Does landing in this status justify an open task on the lead?
 *
 * The same rule the sweep above runs on, exported so a caller writing a task
 * in the same breath as the status can apply it to that task too. Without it
 * the task the rep is saving is the one task the rule never reaches: the sweep
 * skips it (exceptTaskId, so it doesn't race the save), and the save writes
 * `not_completed` straight over the top — a lead marked "שמע מחיר ולא מעוניין"
 * keeps a call task in באיחור forever, which is exactly what this module
 * exists to prevent.
 *
 * Note this asks about the STATUS, not about whether the rep wants a task. A
 * rep opening "משימה חדשה" on a dead lead on purpose is a different question,
 * and callers answer it by only consulting this when the status is what just
 * changed.
 */
export function statusKeepsOpenTasks(status) {
  return status === 'deal_closed' || statusOpensAutoTask(status);
}

// Tasks are set to `task_status: 'cancelled'` (not `'completed'`) so the
// "סיימתי היום" KPI stays honest — the rep didn't actually do them.
async function sweepOpenTasks(leadId, newStatus, note, exceptTaskId) {
  if (!leadId) return;
  let openTasks;
  try {
    openTasks = await base44.entities.SalesTask.filter({
      lead_id: leadId,
      task_status: 'not_completed',
    });
  } catch (err) {
    console.error('sweepOpenTasks: failed to load open tasks', err);
    return;
  }
  await Promise.all(
    (openTasks || [])
      .filter((t) => t && t.id !== exceptTaskId)
      .map((t) =>
        closeSalesTask(t.id, {
          task_status: 'cancelled',
          status: newStatus,
          summary: t.summary ? `${t.summary}\n— ${note}` : note,
        })
          .catch((err) => {
            console.error('sweepOpenTasks: task update failed', t.id, err);
          }),
      ),
  );
}
