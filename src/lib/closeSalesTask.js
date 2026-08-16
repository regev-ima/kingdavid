import { base44 } from '@/api/base44Client';

/**
 * Close a sales task — and record *when* it closed.
 *
 * `sales_tasks` has no updated_date trigger (only club_signups, quote_defaults
 * and company_closures ever got one), so a plain SalesTask.update leaves
 * updated_date at whatever it already was — for most rows, the moment the task
 * was created. That matters because the lead's activity feed both sorts and
 * timestamps a closed task by updated_date: a task opened last week and closed
 * today landed in "פעילות הליד" a week back, carrying last week's time. On the
 * collapsed track — the three most recent events — it therefore didn't appear
 * at all. A rep pressed "סמן כבוצע", the task left the "משימה הבאה" card, and
 * nothing took its place in the activity.
 *
 * Every path that closes a task goes through here, so "when was this closed"
 * has one answer no matter which button did the closing.
 *
 * @param {string} id      the task's id
 * @param {Object} fields  the closing update — task_status ('completed' /
 *                         'cancelled' / 'not_done') plus anything else the
 *                         caller is writing in the same breath (summary, the
 *                         lead status the outcome resolved to, …)
 */
export function closeSalesTask(id, fields = {}) {
  return base44.entities.SalesTask.update(id, {
    ...fields,
    updated_date: new Date().toISOString(),
  });
}

export default closeSalesTask;
