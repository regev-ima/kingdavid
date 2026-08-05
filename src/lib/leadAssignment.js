import { base44 } from '@/api/base44Client';
import { isSameRep, reconcileRepSlots } from '@/lib/repSlots';

/**
 * What "assigning a lead to a rep" means beyond writing `leads.rep1`.
 *
 * An unassigned lead carries an OPEN `assignment` task — "יש לשייך את הליד
 * לנציג" — created by the createSalesTaskForNewLead automation. That task is
 * the admin's to-do list ("להקצות" on /SalesTasks) and it is what the lead
 * screen shows in its work queue. Writing rep1 alone does not close it: the
 * lead reads as assigned everywhere, yet opening it still asks a manager to
 * assign the lead all over again, and the task sits in the assignment queue
 * for a lead that already has an owner.
 *
 * Every single-lead path already does the full job — the rep card
 * (handleQuickAssignRep1 in /LeadDetails), the assignment task's own "שייך
 * נציג" button (SalesTaskDialog), the pending-rep banner. The bulk bar on
 * /LeadManagement did not, which is why a 30-lead batch left 30 open
 * assignment tasks behind. This module is that same job, factored out so the
 * bulk path performs it per lead:
 *
 *   1. close the open assignment task(s), attributed to the new owner,
 *   2. hand any other open task on the lead to the new owner — a transfer
 *      moves the work, it doesn't leave it in the previous rep's queue
 *      (the rep-transfer runner, processTransferBatch, does the same),
 *   3. when the lead is left with no open work, create the standard
 *      call-back task, so a freshly triaged lead reaches the rep's queue
 *      instead of going silent.
 *
 * Steps 2 and 3 are exclusive by construction: a lead that already had open
 * work keeps it (re-pointed) and gets no duplicate call task.
 */

// The lead ids travel in the query string as one `in.(…)` list, so the lookup
// is chunked rather than sent as a single URL holding hundreds of uuids.
const LEAD_ID_CHUNK = 100;

// Only what the handover decides on — both tables are wide and none of the
// rest is read here.
const OPEN_TASK_COLUMNS = 'id,lead_id,task_type,task_status,rep1,rep2';
const LEAD_COLUMNS = 'id,full_name,status,rep1,rep2';

// Same call-back window the single-lead assignment uses.
const CALL_TASK_DUE_HOURS = 3;

async function fetchInChunks(entity, field, ids, columns, extraFilters = {}) {
  const rows = [];
  for (let i = 0; i < ids.length; i += LEAD_ID_CHUNK) {
    const chunk = ids.slice(i, i + LEAD_ID_CHUNK);
    const page = await entity.filter(
      { [field]: chunk, ...extraFilters },
      null,
      1000,
      undefined,
      columns,
    );
    if (page?.length) rows.push(...page);
  }
  return rows;
}

/**
 * Everything the handover needs to decide, read up front for a whole batch.
 *
 * The lead rows are re-read here rather than taken from whatever the calling
 * screen has in memory: a selection outlives the list it was made from (change
 * a filter and the rows are gone), and a lead we can't see is a call task
 * written with a blank customer name and the wrong status.
 *
 * @param {string[]} leadIds
 * @returns {Promise<{leadsById: Map<string, Object>, openTasksByLead: Map<string, Object[]>}>}
 *   Leads and their `not_completed` tasks, both keyed by lead id. A lead with
 *   no open task is simply absent from openTasksByLead.
 */
export async function fetchAssignmentContext(leadIds = []) {
  const ids = [...new Set(leadIds.filter(Boolean))];
  const [leadRows, taskRows] = await Promise.all([
    fetchInChunks(base44.entities.Lead, 'id', ids, LEAD_COLUMNS),
    // Open tasks only — a worked lead accumulates a long closed history, and
    // pulling it would push the batch past the page limit for no purpose.
    fetchInChunks(base44.entities.SalesTask, 'lead_id', ids, OPEN_TASK_COLUMNS, {
      task_status: 'not_completed',
    }),
  ]);

  const leadsById = new Map(leadRows.map((l) => [l.id, l]));

  const openTasksByLead = new Map();
  for (const task of taskRows) {
    if (!task?.lead_id) continue;
    const list = openTasksByLead.get(task.lead_id);
    if (list) list.push(task);
    else openTasksByLead.set(task.lead_id, [task]);
  }

  return { leadsById, openTasksByLead };
}

/**
 * Bring one lead's tasks in line with a just-written rep assignment.
 *
 * Call AFTER the lead row itself has been updated — this only touches
 * sales_tasks. The three writes are independent of each other and run
 * together.
 *
 * @param {Object}   opts
 * @param {string}   opts.leadId
 * @param {Object}   [opts.lead]         the lead row, for the call task's
 *                                       summary + status (may be partial)
 * @param {string}   opts.repEmail       the new primary rep
 * @param {string}   opts.repName        their display name, for the summary
 * @param {string}   opts.assignerName   who performed the assignment
 * @param {Object[]} [opts.openTasks]    the lead's open tasks (see
 *                                       fetchAssignmentContext)
 * @param {string}   [opts.stamp]        ISO timestamp for the writes
 */
export async function applyAssignmentTaskHandover({
  leadId,
  lead = null,
  repEmail,
  repName,
  assignerName,
  openTasks = [],
  stamp = new Date().toISOString(),
}) {
  if (!leadId || !repEmail) return;

  const assignmentTasks = openTasks.filter((t) => t?.task_type === 'assignment');
  const otherOpenTasks = openTasks.filter((t) => t?.task_type !== 'assignment');
  const writes = [];

  // 1. The lead has an owner now, so the "assign this lead" task is done.
  //    Stamped with the rep as well, so the closed task records WHO it was
  //    assigned to — an assignment task is created without a rep.
  for (const task of assignmentTasks) {
    writes.push(base44.entities.SalesTask.update(task.id, {
      task_status: 'completed',
      rep1: repEmail,
      summary: `${assignerName} שייך את הליד לנציג ${repName}`,
    }));
  }

  // 2. Open work follows the lead to its new owner. Left alone it would keep
  //    surfacing in the previous rep's daily queue for a lead that is no
  //    longer theirs. reconcileRepSlots keeps the new owner out of both slots.
  for (const task of otherOpenTasks) {
    if (isSameRep(task.rep1, repEmail)) continue;
    writes.push(base44.entities.SalesTask.update(
      task.id,
      reconcileRepSlots(task, { rep1: repEmail }).patch,
    ));
  }

  // 3. Nothing open left → the standard "call the customer" task, the same one
  //    every single-lead assignment creates. Without it a bulk-assigned lead
  //    has no task at all: it never reaches the rep's queue, and the whole
  //    sales flow on this CRM runs off tasks.
  if (otherOpenTasks.length === 0) {
    const due = new Date(Date.parse(stamp) || Date.now());
    due.setHours(due.getHours() + CALL_TASK_DUE_HOURS);
    writes.push(base44.entities.SalesTask.create({
      lead_id: leadId,
      rep1: repEmail,
      task_type: 'call',
      task_status: 'not_completed',
      summary: `יש להתקשר ללקוח ${lead?.full_name || ''}`.trim(),
      due_date: due.toISOString(),
      work_start_date: stamp,
      status: lead?.status || 'new_lead',
    }));
  }

  await Promise.all(writes);
}
