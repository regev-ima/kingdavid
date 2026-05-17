import { base44 } from '@/api/base44Client';

const CANCEL_NOTE = 'בוטלה אוטומטית – העסקה נסגרה';

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
  if (!leadId) return;
  let openTasks;
  try {
    openTasks = await base44.entities.SalesTask.filter({
      lead_id: leadId,
      task_status: 'not_completed',
    });
  } catch (err) {
    console.error('cancelOpenTasksForClosedDeal: failed to load open tasks', err);
    return;
  }
  await Promise.all(
    (openTasks || [])
      .filter((t) => t && t.id !== exceptTaskId)
      .map((t) =>
        base44.entities.SalesTask
          .update(t.id, {
            task_status: 'cancelled',
            status: 'deal_closed',
            summary: t.summary ? `${t.summary}\n— ${CANCEL_NOTE}` : CANCEL_NOTE,
          })
          .catch((err) => {
            console.error('cancelOpenTasksForClosedDeal: task update failed', t.id, err);
          }),
      ),
  );
}
