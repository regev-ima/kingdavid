import { isValid, startOfDay, endOfDay } from '@/lib/safe-date-fns';

export function parseGenericDate(str) {
  if (!str) return null;
  if (str instanceof Date) return isValid(str) ? str : null;
  if (typeof str !== 'string') return null;
  const dtMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (dtMatch) {
    const [, day, month, year, hour, minute] = dtMatch;
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`);
    return isValid(d) ? d : null;
  }
  const dateMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    return isValid(d) ? d : null;
  }
  const d = new Date(str);
  return isValid(d) ? d : null;
}

export function parseSalesTaskDate(dateStr) {
  return parseGenericDate(dateStr);
}

const OPEN_STATUSES = new Set(['not_completed','pending','new','in_progress','open','waiting']);
const COMPLETED_STATUSES = new Set(['completed','done','closed','finished']);

export function normalizeTaskStatus(status) {
  if (!status) return 'not_completed';
  const lower = status.toLowerCase().trim();
  if (OPEN_STATUSES.has(lower)) return 'not_completed';
  if (COMPLETED_STATUSES.has(lower)) return 'completed';
  if (lower === 'not_done') return 'not_done';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  return 'not_completed';
}

export function getSalesTaskQueueBucket(task, now) {
  const normalized = normalizeTaskStatus(task.task_status);
  if (normalized !== 'not_completed') return null;
  const dueDate = parseSalesTaskDate(task.due_date);
  if (!dueDate) return 'undated';
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  if (dueDate < todayStart) return 'overdue';
  if (dueDate >= todayStart && dueDate <= todayEnd) return 'today';
  return 'upcoming';
}

export function matchesSalesTaskTab(task, tab, now) {
  const normalized = normalizeTaskStatus(task.task_status);
  const dueDate = parseSalesTaskDate(task.due_date);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  switch (tab) {
    case 'today': return normalized === 'not_completed' && dueDate && dueDate >= todayStart && dueDate <= todayEnd;
    case 'overdue': return normalized === 'not_completed' && dueDate && dueDate < todayStart;
    case 'upcoming': return normalized === 'not_completed' && dueDate && dueDate > todayEnd;
    case 'undated': return normalized === 'not_completed' && !dueDate;
    case 'not_completed': return normalized === 'not_completed';
    case 'completed': return normalized === 'completed';
    case 'not_done': return normalized === 'not_done';
    case 'cancelled': return normalized === 'cancelled';
    case 'all': return true;
    default: return true;
  }
}

export function compareSalesTasks(a, b, tab, now) {
  const da = parseSalesTaskDate(a.due_date);
  const db = parseSalesTaskDate(b.due_date);
  if (da && db) return da.getTime() - db.getTime();
  if (da && !db) return -1;
  if (!da && db) return 1;
  return new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime();
}

export function sortSalesTasks(tasks, tab, now) {
  return [...tasks].sort((a, b) => compareSalesTasks(a, b, tab, now));
}

export async function fetchAllSalesTasks(base44Instance) {
  let skip = 0;
  const allTasks = [];
  while (true) {
    const batch = await base44Instance.entities.SalesTask.list('-created_date', 500, skip);
    allTasks.push(...batch);
    if (batch.length < 500) break;
    skip += 500;
  }
  return allTasks;
}

export function buildScopedTaskMetrics(scopedTasks, leadsById, now) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  let openCount = 0, todayCount = 0, overdueCount = 0, upcomingCount = 0, undatedCount = 0, completedTodayCount = 0;
  const taskActionItems = [];
  const completedTodayTasks = [];
  const undatedTasks = [];

  for (const task of scopedTasks) {
    const normalized = normalizeTaskStatus(task.task_status);
    const dueDate = parseSalesTaskDate(task.due_date);
    if (normalized === 'completed') {
      const completedAt = parseGenericDate(task.updated_date || task.created_date);
      if (completedAt && completedAt >= todayStart && completedAt <= todayEnd) {
        completedTodayCount++;
        completedTodayTasks.push(task);
      }
      continue;
    }
    if (normalized !== 'not_completed') continue;
    openCount++;
    const lead = task.lead_id ? leadsById[task.lead_id] : null;
    const bucket = getSalesTaskQueueBucket(task, now);
    if (bucket === 'overdue') {
      overdueCount++;
      taskActionItems.push(buildActionItem(task, lead, dueDate, 'overdue', 'באיחור', 1));
    } else if (bucket === 'today') {
      todayCount++;
      taskActionItems.push(buildActionItem(task, lead, dueDate, 'today', 'להיום', 2));
    } else if (bucket === 'upcoming') {
      upcomingCount++;
      taskActionItems.push(buildActionItem(task, lead, dueDate, 'upcoming', 'עתידי', 3));
    } else {
      undatedCount++;
      undatedTasks.push(task);
      taskActionItems.push(buildActionItem(task, lead, dueDate, 'undated', 'ללא יעד', 4));
    }
  }

  taskActionItems.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });

  return {
    counts: { open: openCount, today: todayCount, overdue: overdueCount, upcoming: upcomingCount, undated: undatedCount, completedToday: completedTodayCount },
    taskActionItems, completedTodayTasks, undatedTasks, now,
  };
}

function buildActionItem(task, lead, dueAt, reasonKey, reasonLabel, priority) {
  return {
    taskId: task.id, taskType: task.task_type || 'other', summary: task.summary || '',
    leadId: task.lead_id || null, leadName: lead?.full_name || null, leadPhone: lead?.phone || null,
    phone: lead?.phone || null, leadStatus: lead?.status || task.status || null,
    customerName: lead?.full_name || null, dueAt, reasonKey, reasonLabel, priority,
  };
}

export function getTaskCounterMismatches(taskCounters, isAdmin, userEmail, liveCounts) {
  if (!taskCounters || taskCounters.length === 0) return {};
  const mismatches = {};
  const email = isAdmin ? '' : (userEmail || '');
  const findCounter = (key) => taskCounters.find(c => {
    if (c.counter_key !== key) return false;
    if (isAdmin) return !c.rep_email;
    return c.rep_email === email;
  });
  const counterKeyMap = { open:'not_completed', today:'today', overdue:'overdue', upcoming:'upcoming', undated:'undated', completedToday:'completed_today' };
  for (const [key, counterKey] of Object.entries(counterKeyMap)) {
    const counter = findCounter(counterKey);
    if (counter && counter.count !== liveCounts[key]) {
      mismatches[key] = { expected: liveCounts[key], persisted: counter.count };
    }
  }
  return mismatches;
}