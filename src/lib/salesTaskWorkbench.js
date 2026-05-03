import { endOfDay, isValid, startOfDay } from '@/lib/safe-date-fns';

export const CLOSED_TASK_STATUSES = ['completed', 'not_done', 'cancelled'];

const OPEN_STATUS_ALIASES = new Set([
  '',
  'not_completed',
  'open',
  'pending',
  'todo',
  'to_do',
  'in_progress',
  'in progress',
  'active',
  'assigned',
]);

const COMPLETED_STATUS_ALIASES = new Set([
  'completed',
  'done',
  'closed',
  'resolved',
]);

const NOT_DONE_STATUS_ALIASES = new Set([
  'not_done',
  'failed',
  'missed',
]);

const CANCELLED_STATUS_ALIASES = new Set([
  'cancelled',
  'canceled',
]);

export async function fetchAllSalesTasks(base44, pageSize = 500) {
  let skip = 0;
  const allTasks = [];

  while (true) {
    const batch = await base44.entities.SalesTask.list('-created_date', pageSize, skip);
    allTasks.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }

  return allTasks;
}

export function parseSalesTaskDate(dateStr) {
  if (!dateStr) return null;

  let parsed = new Date(dateStr);
  if (isValid(parsed)) return parsed;

  if (typeof dateStr === 'string') {
    const matchTime = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/);
    if (matchTime) {
      const [, day, month, year, hour, minute] = matchTime;
      parsed = new Date(
        `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`
      );
      if (isValid(parsed)) return parsed;
    }

    const matchDate = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (matchDate) {
      const [, day, month, year] = matchDate;
      parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      if (isValid(parsed)) return parsed;
    }

    const matchShortTime = dateStr.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (matchShortTime) {
      const [, day, month, hour, minute] = matchShortTime;
      const currentYear = new Date().getFullYear();
      parsed = new Date(
        `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`
      );
      if (isValid(parsed)) return parsed;
    }

    const matchShortDate = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (matchShortDate) {
      const [, day, month] = matchShortDate;
      const currentYear = new Date().getFullYear();
      parsed = new Date(`${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      if (isValid(parsed)) return parsed;
    }
  }

  return null;
}

export function parseGenericDate(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  return isValid(parsed) ? parsed : null;
}

export function normalizeTaskStatus(status) {
  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (OPEN_STATUS_ALIASES.has(normalizedStatus)) return 'not_completed';
  if (COMPLETED_STATUS_ALIASES.has(normalizedStatus)) return 'completed';
  if (NOT_DONE_STATUS_ALIASES.has(normalizedStatus)) return 'not_done';
  if (CANCELLED_STATUS_ALIASES.has(normalizedStatus)) return 'cancelled';
  return normalizedStatus || 'not_completed';
}

export function isSalesTaskClosed(status) {
  return CLOSED_TASK_STATUSES.includes(normalizeTaskStatus(status));
}

export function getScopedTaskCounterValue(taskCounters, key, isAdmin, userEmail, fallback = 0) {
  if (!Array.isArray(taskCounters) || taskCounters.length === 0) return fallback;

  if (isAdmin) {
    const globalCounter = taskCounters.find((counter) => counter.counter_key === key && !counter.rep_email);
    return globalCounter?.count ?? fallback;
  }

  const repCounter = taskCounters.find((counter) => counter.counter_key === key && counter.rep_email === userEmail);
  return repCounter?.count ?? fallback;
}

export function getSalesTaskQueueBucket(task, now = new Date()) {
  if (normalizeTaskStatus(task.task_status) !== 'not_completed') return null;

  const dueAt = parseSalesTaskDate(task.due_date);
  if (!dueAt) return 'undated';

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (dueAt < todayStart) return 'overdue';
  if (dueAt <= todayEnd) return 'today';
  return 'upcoming';
}

export function matchesSalesTaskTab(task, tab, now = new Date()) {
  const bucket = getSalesTaskQueueBucket(task, now);
  const normalizedStatus = normalizeTaskStatus(task.task_status);

  switch (tab) {
    case 'today':
      return bucket === 'today';
    case 'overdue':
      return bucket === 'overdue';
    case 'upcoming':
      return bucket === 'upcoming';
    case 'undated':
      return bucket === 'undated';
    case 'not_completed':
      return normalizedStatus === 'not_completed';
    case 'completed':
      return normalizedStatus === 'completed';
    case 'not_done':
      return normalizedStatus === 'not_done';
    case 'cancelled':
      return normalizedStatus === 'cancelled';
    case 'all':
    default:
      return true;
  }
}

function getQueueSortRank(task, now) {
  const bucket = getSalesTaskQueueBucket(task, now);
  switch (bucket) {
    case 'overdue':
      return 0;
    case 'today':
      return 1;
    case 'upcoming':
      return 2;
    case 'undated':
      return 3;
    default:
      return 4;
  }
}

export function compareSalesTasks(a, b, tab = 'not_completed', now = new Date()) {
  const dueA = parseSalesTaskDate(a.due_date);
  const dueB = parseSalesTaskDate(b.due_date);
  const updatedA = parseGenericDate(a.updated_date || a.created_date);
  const updatedB = parseGenericDate(b.updated_date || b.created_date);
  const createdA = parseGenericDate(a.created_date);
  const createdB = parseGenericDate(b.created_date);

  if (['completed', 'not_done', 'cancelled'].includes(tab)) {
    const finishedA = updatedA?.getTime() || dueA?.getTime() || 0;
    const finishedB = updatedB?.getTime() || dueB?.getTime() || 0;
    if (finishedB !== finishedA) return finishedB - finishedA;
    return (createdB?.getTime() || 0) - (createdA?.getTime() || 0);
  }

  if (tab === 'undated') {
    const updatedTimeA = updatedA?.getTime() || 0;
    const updatedTimeB = updatedB?.getTime() || 0;
    if (updatedTimeB !== updatedTimeA) return updatedTimeB - updatedTimeA;
    return (createdB?.getTime() || 0) - (createdA?.getTime() || 0);
  }

  if (tab === 'all' || tab === 'not_completed') {
    const rankDiff = getQueueSortRank(a, now) - getQueueSortRank(b, now);
    if (rankDiff !== 0) return rankDiff;
  }

  const dueTimeA = dueA?.getTime();
  const dueTimeB = dueB?.getTime();

  if (dueTimeA && dueTimeB && dueTimeA !== dueTimeB) return dueTimeA - dueTimeB;
  if (dueTimeA && !dueTimeB) return -1;
  if (!dueTimeA && dueTimeB) return 1;

  const updatedTimeA = updatedA?.getTime() || 0;
  const updatedTimeB = updatedB?.getTime() || 0;
  if (updatedTimeA !== updatedTimeB) return updatedTimeB - updatedTimeA;

  return (createdB?.getTime() || 0) - (createdA?.getTime() || 0);
}

export function sortSalesTasks(tasks, tab = 'not_completed', now = new Date()) {
  return [...tasks].sort((a, b) => compareSalesTasks(a, b, tab, now));
}

// Priority sort — independent of tab. Used by the "מומלץ" sort option to
// dictate the rep's work order: SLA breach first, then hottest leads, then
// followups, with due_date as tiebreaker inside each tier. Lead status is
// usually denormalized onto the task (`task.status`); fall back to the lead.
const HOT_LEAD_STATUSES = new Set(['hot_lead', 'coming_to_branch']);
const NEW_LEAD_STATUSES = new Set(['new_lead']);
const FOLLOWUP_LEAD_STATUSES = new Set([
  'followup_before_quote',
  'followup_after_quote',
]);

function getLeadHeatTier(leadStatus) {
  if (HOT_LEAD_STATUSES.has(leadStatus)) return 0;
  if (NEW_LEAD_STATUSES.has(leadStatus)) return 1;
  if (FOLLOWUP_LEAD_STATUSES.has(leadStatus)) return 2;
  return 3;
}

function getBucketRank(bucket) {
  switch (bucket) {
    case 'overdue': return 0;
    case 'today': return 1;
    case 'upcoming': return 2;
    case 'undated': return 3;
    default: return 4;
  }
}

export function compareTasksByPriority(a, b, leadsById = {}, now = new Date()) {
  const bucketA = getSalesTaskQueueBucket(a, now);
  const bucketB = getSalesTaskQueueBucket(b, now);
  const heatA = getLeadHeatTier(a.status || leadsById[a.lead_id]?.status);
  const heatB = getLeadHeatTier(b.status || leadsById[b.lead_id]?.status);

  // Composite: bucket dominates (SLA-first), heat ranks within the bucket.
  const scoreA = getBucketRank(bucketA) * 10 + heatA;
  const scoreB = getBucketRank(bucketB) * 10 + heatB;
  if (scoreA !== scoreB) return scoreA - scoreB;

  const dueA = parseSalesTaskDate(a.due_date);
  const dueB = parseSalesTaskDate(b.due_date);
  if (dueA && dueB) return dueA.getTime() - dueB.getTime();
  if (dueA) return -1;
  if (dueB) return 1;

  return (
    (parseGenericDate(b.created_date)?.getTime() || 0) -
    (parseGenericDate(a.created_date)?.getTime() || 0)
  );
}

// Anything past this cutoff is treated as legacy/migration noise the rep
// shouldn't be staring at every morning. Tunable; surfaced via a toggle.
export const STALE_TASK_THRESHOLD_DAYS = 30;

export function isStaleOverdueTask(task, now = new Date(), thresholdDays = STALE_TASK_THRESHOLD_DAYS) {
  if (normalizeTaskStatus(task.task_status) !== 'not_completed') return false;
  const due = parseSalesTaskDate(task.due_date);
  if (!due) return false;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - thresholdDays);
  return due < cutoff;
}

export function isAssignmentTask(task) {
  return task?.task_type === 'assignment';
}

export function buildTaskActionItems(tasks, leadsById, now = new Date()) {
  return sortSalesTasks(
    tasks.filter((task) => ['overdue', 'today', 'upcoming', 'undated'].includes(getSalesTaskQueueBucket(task, now))),
    'not_completed',
    now
  ).map((task) => {
    const lead = task.lead_id ? leadsById[task.lead_id] : null;
    const dueAt = parseSalesTaskDate(task.due_date);
    const bucket = getSalesTaskQueueBucket(task, now);

    return {
      entityType: 'task',
      entityId: task.id,
      taskId: task.id,
      taskType: task.task_type,
      taskStatus: normalizeTaskStatus(task.task_status),
      dueAt,
      summary: task.summary,
      leadId: task.lead_id,
      leadName: lead?.full_name || null,
      leadPhone: lead?.phone || null,
      leadStatus: lead?.status || null,
      customerName: lead?.full_name || task.summary || 'משימה',
      phone: lead?.phone || null,
      status: lead?.status || normalizeTaskStatus(task.task_status),
      priority: bucket === 'overdue' ? 100 : bucket === 'today' ? 80 : 60,
      reasonKey: bucket,
      reasonLabel:
        bucket === 'overdue' ? 'משימה באיחור' :
        bucket === 'today' ? 'משימה להיום' :
        bucket === 'upcoming' ? 'משימה עתידית' :
        'משימה ללא יעד',
      isOverdue: bucket === 'overdue',
      isToday: bucket === 'today',
      updatedAt: parseGenericDate(task.updated_date || task.created_date),
      createdAt: parseGenericDate(task.created_date),
    };
  });
}

export function buildScopedTaskMetrics(scopedTasks = [], leadsById = {}, now = new Date()) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const openTasks = scopedTasks.filter((task) => normalizeTaskStatus(task.task_status) === 'not_completed');
  const overdueTasks = openTasks.filter((task) => matchesSalesTaskTab(task, 'overdue', now));
  const todayTasks = openTasks.filter((task) => matchesSalesTaskTab(task, 'today', now));
  const upcomingTasks = openTasks.filter((task) => matchesSalesTaskTab(task, 'upcoming', now));
  const undatedTasks = sortSalesTasks(
    openTasks.filter((task) => matchesSalesTaskTab(task, 'undated', now)),
    'undated',
    now
  );
  const completedTodayTasks = sortSalesTasks(
    scopedTasks.filter((task) => {
      if (normalizeTaskStatus(task.task_status) !== 'completed') return false;
      const completedAt = parseGenericDate(task.updated_date || task.created_date);
      return completedAt && completedAt >= todayStart && completedAt <= todayEnd;
    }),
    'completed',
    now
  );
  const taskActionItems = buildTaskActionItems(openTasks, leadsById, now);

  return {
    now,
    openTasks,
    overdueTasks,
    todayTasks,
    upcomingTasks,
    undatedTasks,
    completedTodayTasks,
    taskActionItems,
    counts: {
      open: openTasks.length,
      overdue: overdueTasks.length,
      today: todayTasks.length,
      upcoming: upcomingTasks.length,
      undated: undatedTasks.length,
      completedToday: completedTodayTasks.length,
    },
  };
}

export function getTaskCounterMismatches(taskCounters, isAdmin, userEmail, counts) {
  const counterKeys = {
    not_completed: counts.open,
    overdue: counts.overdue,
    today: counts.today,
    upcoming: counts.upcoming,
  };

  return Object.entries(counterKeys).reduce((acc, [key, derivedCount]) => {
    const counterCount = getScopedTaskCounterValue(taskCounters, key, isAdmin, userEmail, derivedCount);
    if (counterCount !== derivedCount) {
      acc[key] = { counter: counterCount, derived: derivedCount };
    }
    return acc;
  }, {});
}
