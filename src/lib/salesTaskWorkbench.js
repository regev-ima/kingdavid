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

// Priority sort — the rep's default ("מומלץ") work order. A three-way tier
// sets the top-level grouping; the day's schedule (SLA bucket, then time)
// orders tasks within each tier:
//
//   1. פגישות         — task_type 'meeting', always a block at the very top.
//   2. תואם מראש       — the rep coordinated this: either the lead is already
//                        engaged, or the rep booked the slot themselves. A
//                        pre-coordinated task ALWAYS wins over a fresh lead the
//                        manager just parked on the rep.
//   3. ליד חדש שהוצב   — an untouched new lead the manager assigned.
//
// Lead stage is denormalized onto the task (`task.status`); fall back to the
// lead record when it's missing.
const WORK_TIER_MEETING = 0;
const WORK_TIER_COORDINATED = 1;
const WORK_TIER_MANAGER_NEW = 2;

// A lead nobody has worked yet. Any stage past this (no-answer, follow-up,
// hot, coming-to-branch…) means the rep already engaged the customer, so a
// task on that lead counts as coordinated.
const UNWORKED_LEAD_STATUSES = new Set(['new_lead']);

function getRepWorkTier(task, leadsById = {}) {
  if (task?.task_type === 'meeting') return WORK_TIER_MEETING;

  const leadStatus = task?.status || (task?.lead_id ? leadsById[task.lead_id]?.status : null);
  const isUnworkedLead =
    task?.task_type === 'assignment' || !leadStatus || UNWORKED_LEAD_STATUSES.has(leadStatus);

  // The rep deliberately creating the task counts as coordinating it — even on
  // a brand-new lead. The "משימה חדשה" dialog always stamps manual_created_date;
  // the manager's auto-placed lead tasks never carry it.
  const repCoordinated = Boolean(task?.manual_created_date);

  return isUnworkedLead && !repCoordinated ? WORK_TIER_MANAGER_NEW : WORK_TIER_COORDINATED;
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
  // 1) Work-order tier: meetings → coordinated → manager-placed new leads.
  const tierA = getRepWorkTier(a, leadsById);
  const tierB = getRepWorkTier(b, leadsById);
  if (tierA !== tierB) return tierA - tierB;

  // 2) Within a tier, follow the day's schedule: overdue, then today, then
  //    upcoming, then undated.
  const rankA = getBucketRank(getSalesTaskQueueBucket(a, now));
  const rankB = getBucketRank(getSalesTaskQueueBucket(b, now));
  if (rankA !== rankB) return rankA - rankB;

  // 3) "לפי השעות והזמנים" — earliest scheduled time first.
  const dueA = parseSalesTaskDate(a.due_date);
  const dueB = parseSalesTaskDate(b.due_date);
  if (dueA && dueB && dueA.getTime() !== dueB.getTime()) return dueA.getTime() - dueB.getTime();
  if (dueA && !dueB) return -1;
  if (!dueA && dueB) return 1;

  // 4) Stable tiebreak: most recently created first.
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

// Stale-assignment heuristic. Mirrors isStaleOverdueTask but keys off
// created_date instead of due_date — assignment tasks are admin-workflow
// items, the only thing that ages is "how long has nobody assigned this
// lead". After 30 days the manager has implicitly decided the lead isn't
// worth working, even if the task is still technically open.
export function isStaleAssignmentTask(task, now = new Date(), thresholdDays = STALE_TASK_THRESHOLD_DAYS) {
  if (!isAssignmentTask(task)) return false;
  if (normalizeTaskStatus(task.task_status) !== 'not_completed') return false;
  const created = parseGenericDate(task.created_date);
  if (!created) return false;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - thresholdDays);
  return created < cutoff;
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
