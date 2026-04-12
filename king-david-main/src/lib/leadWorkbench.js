export function parseWorkbenchDate(value) {
  if (!value) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  if (typeof value !== 'string') return null;

  const withTime = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/);
  if (withTime) {
    const [, dd, mm, yyyy, hh, min] = withTime;
    const parsed = new Date(
      `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${min}:00`
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const onlyDate = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (onlyDate) {
    const [, dd, mm, yyyy] = onlyDate;
    const parsed = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function getTaskBucket(task, now, todayStart, tomorrowStart) {
  const dueDate = parseWorkbenchDate(task?.due_date);
  if (!dueDate) return 'undated';
  if (dueDate < now) return 'overdue';
  if (dueDate >= todayStart && dueDate < tomorrowStart) return 'today';
  return 'upcoming';
}

function getBucketPriority(bucket) {
  if (bucket === 'overdue') return 400;
  if (bucket === 'today') return 300;
  if (bucket === 'upcoming') return 200;
  return 100;
}

function getBucketReason(bucket) {
  if (bucket === 'overdue') return 'משימה באיחור';
  if (bucket === 'today') return 'משימה להיום';
  if (bucket === 'upcoming') return 'משימה עתידית';
  return 'משימה ללא תאריך יעד';
}

function compareTaskItems(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;

  const dueA = parseWorkbenchDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const dueB = parseWorkbenchDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) return dueA - dueB;

  const updatedA = parseWorkbenchDate(a.updatedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const updatedB = parseWorkbenchDate(b.updatedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (updatedA !== updatedB) return updatedA - updatedB;

  const createdA = parseWorkbenchDate(a.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const createdB = parseWorkbenchDate(b.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return createdA - createdB;
}

export function buildLeadWorkbenchState({
  tasks = [],
  now = new Date(),
  mode = 'sales',
}) {
  const safeNow = parseWorkbenchDate(now) || new Date();
  const todayStart = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate());
  const tomorrowStart = new Date(safeNow.getFullYear(), safeNow.getMonth(), safeNow.getDate() + 1);

  const openTasks = tasks.filter((task) => String(task?.task_status || '').toLowerCase() === 'not_completed');

  const queueItems = openTasks
    .map((task) => {
      const bucket = getTaskBucket(task, safeNow, todayStart, tomorrowStart);
      return {
        type: `task_${bucket}`,
        id: task.id,
        priority: getBucketPriority(bucket),
        reason: getBucketReason(bucket),
        dueAt: task.due_date || null,
        status: task.task_status,
        value: null,
        source: 'sales',
        cta: ['open_task'],
        title: task.summary || 'משימה פתוחה',
        subtitle: task.task_type ? `סוג: ${{ call: 'שיחה', meeting: 'פגישה', quote_preparation: 'הצעת מחיר', close_order: 'סגירת הזמנה', assignment: 'שיוך', followup: 'מעקב' }[task.task_type] || task.task_type}` : 'משימת מכירה',
        phone: null,
        href: null,
        updatedAt: task.updated_date,
        createdAt: task.created_date,
        entity: task,
      };
    })
    .sort(compareTaskItems);

  const counters = {
    totalQueue: queueItems.length,
    overdueTasks: queueItems.filter((item) => item.type === 'task_overdue').length,
    todayTasks: queueItems.filter((item) => item.type === 'task_today').length,
    upcomingTasks: queueItems.filter((item) => item.type === 'task_upcoming').length,
    undatedTasks: queueItems.filter((item) => item.type === 'task_undated').length,
  };

  return {
    mode,
    nowQueue: queueItems.slice(0, 8),
    counters,
    contextPanels: {
      showSales: true,
      showService: false,
      hasServiceData: false,
    },
  };
}
