import { base44 } from '@/api/base44Client';
import { statusOpensAutoTask } from '@/constants/leadOptions';

const CANCEL_NOTE = 'בוטלה אוטומטית – העסקה נסגרה';
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
// `exceptTaskId` skips a specific task — callers in the middle of saving that
// same task pass it so the sweep doesn't race their own update.
export async function cancelOpenTasksForStatus(leadId, newStatus, exceptTaskId = null) {
  if (!leadId || !newStatus) return;
  if (statusOpensAutoTask(newStatus)) return;
  await sweepOpenTasks(
    leadId,
    newStatus,
    newStatus === 'deal_closed' ? CANCEL_NOTE : IDLE_NOTE,
    exceptTaskId,
  );
}

// Called when a lead's status transitions to 'deal_closed'. Cancels every
// still-open SalesTask linked to that lead — once the deal is closed,
// remaining follow-ups (callbacks, quote preps, etc.) are moot and
// otherwise clutter the rep's "להיום" / "באיחור" buckets forever.
//
// Tasks are set to `task_status: 'cancelled'` (not `'completed'`) so the
// "סיימתי היום" KPI stays honest — the rep didn't actually do them.
//
// `exceptTaskId` skips a specific task — used by callers that are
// themselves in the middle of saving that task (CompleteTaskDialog,
// EditSalesTaskDialog) and don't want the sweep to race against their
// own update.
export async function cancelOpenTasksForClosedDeal(leadId, exceptTaskId = null) {
  return sweepOpenTasks(leadId, 'deal_closed', CANCEL_NOTE, exceptTaskId);
}

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
        base44.entities.SalesTask
          .update(t.id, {
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
