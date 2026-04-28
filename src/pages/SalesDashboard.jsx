import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  ListTodo,
  Plus,
  RefreshCw,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react';
import { addHours, format, formatDistanceToNow, isValid } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';

import UserAvatar from '@/components/shared/UserAvatar';
import StatusBadge from '@/components/shared/StatusBadge';
import AddSalesTaskDialog from '@/components/task/AddSalesTaskDialog';
import EditSalesTaskDialog from '@/components/task/EditSalesTaskDialog';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import {
  buildLeadsById,
  canAccessSalesWorkspace,
  filterSalesTasksForUser,
  isFactoryUser,
} from '@/components/shared/rbac';
import {
  buildScopedTaskMetrics,
  getTaskCounterMismatches,
  getSalesTaskQueueBucket,
  parseGenericDate,
  parseSalesTaskDate,
} from '@/components/shared/salesTaskWorkbench';
import PendingQuotesCard from '@/components/dashboard/PendingQuotesCard';
import MyCommissionsCard from '@/components/dashboard/MyCommissionsCard';

const TASK_TYPE_EMOJI = {
  call: '📞',
  whatsapp: '💬',
  email: '📧',
  meeting: '🤝',
  quote_preparation: '📝',
  followup: '🔄',
  assignment: '👤',
  other: '📋',
};



function formatDueLabel(date, prefix = '') {
  if (!date || !isValid(date)) return 'ללא יעד';
  const relative = formatDistanceToNow(date, { addSuffix: true, locale: he });
  return prefix ? `${prefix} ${relative}` : relative;
}

function formatTaskHeadline(taskOrItem) {
  return taskOrItem.summary || taskOrItem.leadName || taskOrItem.customerName || 'משימה';
}

function formatTaskContext(taskOrItem) {
  const parts = [];
  if (taskOrItem.leadName && taskOrItem.summary && taskOrItem.leadName !== taskOrItem.summary) {
    parts.push(taskOrItem.leadName);
  }
  if (taskOrItem.leadPhone || taskOrItem.phone) {
    parts.push(taskOrItem.leadPhone || taskOrItem.phone);
  }
  return parts.join(' • ');
}

function EmptyActionState({ title, ctaLabel, onCta }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      {onCta ? (
        <Button variant="link" className="mt-1 h-auto p-0 text-sm" onClick={onCta}>
          {ctaLabel}
        </Button>
      ) : null}
    </div>
  );
}

function MiniKpiCard({ label, value, helper, icon: Icon, onClick, tone = 'default' }) {
  const toneClasses = {
    default: 'border-border hover:border-primary/30',
    amber: 'border-amber-200 hover:border-amber-300',
    red: 'border-red-200 hover:border-red-300',
    emerald: 'border-emerald-200 hover:border-emerald-300',
    slate: 'border-slate-200 hover:border-slate-300',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border bg-card text-start transition-all hover:shadow-sm ${toneClasses[tone] || toneClasses.default}`}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
        </div>
        <div className="rounded-xl bg-muted p-2.5">
          <Icon className="h-4 w-4 text-foreground/80" />
        </div>
      </div>
    </button>
  );
}



function TaskListCard({ title, helper, icon: Icon, items, totalCount, emptyLabel, onOpenAll, onOpenItem, footerLabel = 'הכל', accentColor = 'primary', taskTypeEmoji }) {
  const colorMap = {
    red: { headerBg: 'bg-gradient-to-l from-red-50 to-red-100/50', iconBg: 'bg-red-100', iconText: 'text-red-600', border: 'border-red-200', hoverBg: 'hover:bg-red-50/60', countBg: 'bg-red-500' },
    amber: { headerBg: 'bg-gradient-to-l from-amber-50 to-amber-100/50', iconBg: 'bg-amber-100', iconText: 'text-amber-600', border: 'border-amber-200', hoverBg: 'hover:bg-amber-50/60', countBg: 'bg-amber-500' },
    blue: { headerBg: 'bg-gradient-to-l from-blue-50 to-blue-100/50', iconBg: 'bg-blue-100', iconText: 'text-blue-600', border: 'border-blue-200', hoverBg: 'hover:bg-blue-50/60', countBg: 'bg-blue-500' },
    slate: { headerBg: 'bg-gradient-to-l from-slate-50 to-slate-100/50', iconBg: 'bg-slate-100', iconText: 'text-slate-600', border: 'border-slate-200', hoverBg: 'hover:bg-slate-50/60', countBg: 'bg-slate-500' },
    primary: { headerBg: 'bg-gradient-to-l from-primary/5 to-primary/10', iconBg: 'bg-primary/10', iconText: 'text-primary', border: 'border-primary/20', hoverBg: 'hover:bg-primary/5', countBg: 'bg-primary' },
  };
  const c = colorMap[accentColor] || colorMap.primary;

  return (
    <Card className={`overflow-hidden shadow-sm ${c.border}`}>
      <CardHeader className={`pb-3 ${c.headerBg}`}>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2.5">
            <div className={`rounded-xl p-2.5 ${c.iconBg}`}>
              <Icon className={`h-5 w-5 ${c.iconText}`} />
            </div>
            <div>
              <span className="font-bold">{title}</span>
              <span className={`ms-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold text-white ${c.countBg}`}>
                {totalCount !== undefined ? totalCount : items.length}
              </span>
            </div>
          </span>
          {onOpenAll ? (
            <Button variant="ghost" size="sm" onClick={onOpenAll} className="text-xs">
              {footerLabel}
              <ChevronRight className="me-1 h-3.5 w-3.5" />
            </Button>
          ) : null}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{helper}</p>
      </CardHeader>
      <CardContent className="p-3 space-y-2 max-h-[520px] overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <button
              type="button"
              key={item.id || item.taskId}
              onClick={() => onOpenItem(item)}
              className={`flex w-full items-center gap-3 rounded-xl border ${c.border} p-3 text-start transition-all ${c.hoverBg} hover:shadow-sm`}
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-base">
                {taskTypeEmoji?.[item.taskType] || TASK_TYPE_EMOJI[item.taskType] || '📋'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{formatTaskHeadline(item)}</p>
                <p className="truncate text-xs text-muted-foreground">{formatTaskContext(item) || item.reasonLabel || ''}</p>
              </div>
              {item.leadStatus && (
                <div className="flex-shrink-0">
                  <StatusBadge status={item.leadStatus} />
                </div>
              )}
              <div className="text-left flex-shrink-0">
                {item.dueAt ? (
                  <>
                    <p className="text-sm font-bold text-foreground">{format(item.dueAt, 'HH:mm')}</p>
                    <p className="text-xs text-muted-foreground">{format(item.dueAt, 'EEEE dd/MM', { locale: he })}</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">ללא יעד</p>
                )}
              </div>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function SalesDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [editingTaskData, setEditingTaskData] = useState(null);


  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  useEffect(() => {
    if (!effectiveUser) return;
    if (isFactoryUser(effectiveUser)) {
      navigate(createPageUrl('FactoryDashboard'));
      return;
    }
    if (!canAccessSalesWorkspace(effectiveUser)) {
      navigate(createPageUrl('Dashboard'));
    }
  }, [effectiveUser, navigate]);

  const { data: leads = [], refetch: refetchLeads } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      let skip = 0;
      const allLeads = [];
      while (true) {
        const batch = await base44.entities.Lead.list('-created_date', 500, skip);
        allLeads.push(...batch);
        if (batch.length < 500) break;
        skip += 500;
      }
      return allLeads;
    },
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const { data: salesTasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ['salesTasks', 'dashboard'],
    queryFn: async () => {
      // Fetch open tasks (not_completed) - these are the ones that matter for the dashboard
      const openTasks = await base44.entities.SalesTask.filter(
        { task_status: 'not_completed' },
        '-created_date',
        500
      );
      // Also fetch tasks completed today for the "completed today" section
      const todayStr = new Date().toISOString().split('T')[0];
      const recentTasks = await base44.entities.SalesTask.filter(
        { task_status: 'completed' },
        '-updated_date',
        100
      );
      return [...openTasks, ...recentTasks];
    },
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const { data: taskCounters = [], refetch: refetchTaskCounters } = useQuery({
    queryKey: ['taskCounters'],
    queryFn: () => base44.entities.TaskCounter.list('-created_date', 200),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const leadsById = useMemo(() => buildLeadsById(leads), [leads]);
  const isAdmin = effectiveUser?.role === 'admin';
  const userEmail = effectiveUser?.email;

  const scopedTasks = useMemo(
    () => filterSalesTasksForUser(effectiveUser, salesTasks, leadsById),
    [effectiveUser, salesTasks, leadsById]
  );

  const metrics = useMemo(() => {
    const now = new Date();
    const baseMetrics = buildScopedTaskMetrics(scopedTasks, leadsById, now);
    const taskActionItems = baseMetrics.taskActionItems;
    const nearUpcomingItems = taskActionItems.filter(
      (item) => item.reasonKey === 'upcoming' && item.dueAt && item.dueAt <= addHours(now, 48)
    );
    const counterMismatches = getTaskCounterMismatches(taskCounters, isAdmin, userEmail, baseMetrics.counts);

    if (isAdmin && Object.keys(counterMismatches).length > 0) {
      console.warn('TaskCounter mismatch on SalesDashboard', {
        userEmail,
        mismatches: counterMismatches,
      });
    }

    return {
      ...baseMetrics,
      taskActionItems,
      nearUpcomingItems,
      counterMismatches,
      taskTodayCount: baseMetrics.counts.today,
      taskOverdueCount: baseMetrics.counts.overdue,
      taskOpenCount: baseMetrics.counts.open,
      taskUpcomingCount: baseMetrics.counts.upcoming,
      undatedCount: baseMetrics.counts.undated,
      completedTodayCount: baseMetrics.counts.completedToday,
    };
  }, [isAdmin, leadsById, scopedTasks, taskCounters, userEmail]);









  const handleRefresh = async () => {
    await Promise.all([refetchLeads(), refetchTasks(), refetchTaskCounters()]);
    setLastUpdated(new Date());
  };

  const openTaskPopup = (taskId) => {
    const task = scopedTasks.find(t => t.id === taskId);
    if (!task) return;
    const lead = task.lead_id ? leadsById[task.lead_id] : null;
    setEditingTaskData({ ...task, lead });
  };



  const buildTaskPreview = (task) => {
    const lead = task.lead_id ? leadsById[task.lead_id] : null;
    const dueAt = parseSalesTaskDate(task.due_date);
    return {
      id: task.id,
      taskId: task.id,
      summary: task.summary,
      leadName: lead?.full_name || null,
      leadPhone: lead?.phone || null,
      leadStatus: lead?.status || null,
      dueAt,
      reasonLabel: getSalesTaskQueueBucket(task, metrics.now) === 'undated' ? 'ללא תאריך יעד' : null,
    };
  };

  if (isLoadingUser) {
    return <div className="py-12 text-center">טוען...</div>;
  }

  if (!effectiveUser || !canAccessSales) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">אין לך הרשאה לגשת לדשבורד המכירות</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="hidden h-14 w-14 sm:block">
            <UserAvatar user={effectiveUser} className="h-14 w-14" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">מה עכשיו, {effectiveUser?.full_name}?</h1>
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              מסך עבודה למשימות מכירה • עודכן לאחרונה: {format(lastUpdated, 'HH:mm:ss')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              יחידת העבודה הראשית כאן היא משימה. כרגע יש לך {metrics.taskOpenCount} משימות פתוחות, מהן {metrics.taskOverdueCount} באיחור ו-{metrics.taskTodayCount} לביצוע היום.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="me-2 h-4 w-4" />
              רענן
            </Button>
            <Button size="sm" onClick={() => setShowTaskDialog(true)}>
              <CheckSquare className="me-2 h-4 w-4" />
              משימה חדשה
            </Button>
            <Link to={createPageUrl('NewLead')}>
              <Button variant="secondary" size="sm">
                <Plus className="me-2 h-4 w-4" />
                ליד חדש
              </Button>
            </Link>
            <Link to={createPageUrl('SalesTasks')}>
              <Button variant="outline" size="sm">
                <ArrowRight className="me-2 h-4 w-4" />
                לכל המשימות
              </Button>
            </Link>
          </div>


        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <MiniKpiCard label="פתוחות" value={metrics.taskOpenCount} helper="ממתינות לביצוע" icon={Zap} tone="red" onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=not_completed')} />
        <MiniKpiCard label="באיחור" value={metrics.taskOverdueCount} helper="עבר מועד יעד" icon={AlertTriangle} tone="red" onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=overdue')} />
        <MiniKpiCard label="להיום" value={metrics.taskTodayCount} helper="יעד להיום" icon={Calendar} tone="amber" onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=today')} />
        <MiniKpiCard label="עתידי" value={metrics.taskUpcomingCount} helper="מתוזמנות" icon={Clock} onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=upcoming')} />
        <MiniKpiCard label="בוצע היום" value={metrics.completedTodayCount} helper="הושלמו" icon={CheckCircle2} tone="emerald" onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=completed')} />
        <MiniKpiCard label="ללא יעד" value={metrics.undatedCount} helper="דורש תכנון" icon={ListTodo} tone="slate" onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=undated')} />
      </div>

      {/* לידים חדשים + הצעות מחיר ממתינות + העמלות שלי */}
      <div className="grid gap-5 lg:grid-cols-3">
        <TaskListCard
          title="לידים חדשים"
          helper="משימות של לידים בסטטוס ׳ליד חדש׳ — דורשים טיפול ראשוני"
          icon={UserPlus}
          accentColor="primary"
          totalCount={metrics.taskActionItems.filter((item) => item.leadStatus === 'new_lead' && (item.reasonKey === 'today' || item.reasonKey === 'overdue')).length}
          items={metrics.taskActionItems.filter((item) => item.leadStatus === 'new_lead' && (item.reasonKey === 'today' || item.reasonKey === 'overdue'))}
          emptyLabel="אין לידים חדשים כרגע"
          onOpenAll={() => navigate(createPageUrl('Leads') + '?status=new_lead')}
          onOpenItem={(item) => openTaskPopup(item.taskId)}
          taskTypeEmoji={TASK_TYPE_EMOJI}
        />
        <PendingQuotesCard leadsById={leadsById} effectiveUser={effectiveUser} />
        <MyCommissionsCard effectiveUser={effectiveUser} />
      </div>

      {/* Main 50/50: באיחור + להיום (ללא לידים חדשים) */}
      <div className="grid gap-5 lg:grid-cols-2">
        <TaskListCard
          title="באיחור"
          helper="משימות שעבר מועד היעד — דורשות טיפול מיידי"
          icon={AlertTriangle}
          accentColor="red"
          totalCount={metrics.taskActionItems.filter((item) => item.reasonKey === 'overdue' && item.leadStatus !== 'new_lead').length}
          items={metrics.taskActionItems.filter((item) => item.reasonKey === 'overdue' && item.leadStatus !== 'new_lead')}
          emptyLabel="🎉 אין משימות באיחור!"
          onOpenAll={() => navigate(createPageUrl('SalesTasks') + '?tab=overdue')}
          onOpenItem={(item) => openTaskPopup(item.taskId)}
          taskTypeEmoji={TASK_TYPE_EMOJI}
        />
        <TaskListCard
          title="להיום"
          helper="המשימות שיש לבצע היום (ללא לידים חדשים)"
          icon={Calendar}
          accentColor="amber"
          totalCount={metrics.taskActionItems.filter((item) => item.reasonKey === 'today' && item.leadStatus !== 'new_lead').length}
          items={metrics.taskActionItems.filter((item) => item.reasonKey === 'today' && item.leadStatus !== 'new_lead')}
          emptyLabel="✅ סיימת את כל המשימות להיום!"
          onOpenAll={() => navigate(createPageUrl('SalesTasks') + '?tab=today')}
          onOpenItem={(item) => openTaskPopup(item.taskId)}
          taskTypeEmoji={TASK_TYPE_EMOJI}
        />
      </div>

      {/* Secondary 50/50: עתידי + ללא יעד */}
      <div className="grid gap-5 lg:grid-cols-2">
        <TaskListCard
          title="עתידי קרוב"
          helper="משימות ב-48 השעות הקרובות"
          icon={Clock}
          accentColor="blue"
          totalCount={metrics.nearUpcomingItems.length}
          items={metrics.nearUpcomingItems}
          emptyLabel="אין משימות קרובות"
          onOpenAll={() => navigate(createPageUrl('SalesTasks') + '?tab=upcoming')}
          onOpenItem={(item) => openTaskPopup(item.taskId)}
          taskTypeEmoji={TASK_TYPE_EMOJI}
        />
        <TaskListCard
          title="ללא יעד"
          helper="משימות פתוחות שלא תוזמנו עדיין"
          icon={ListTodo}
          accentColor="slate"
          totalCount={metrics.undatedTasks.length}
          items={metrics.undatedTasks.map(buildTaskPreview)}
          emptyLabel="אין משימות ללא יעד"
          onOpenAll={() => navigate(createPageUrl('SalesTasks') + '?tab=undated')}
          onOpenItem={(item) => openTaskPopup(item.taskId)}
          taskTypeEmoji={TASK_TYPE_EMOJI}
        />
      </div>

      {/* Completed today */}
      <Card className="shadow-sm border-emerald-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3 bg-gradient-to-l from-emerald-50 to-emerald-100/30">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="rounded-xl bg-emerald-100 p-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              הושלמו היום
              <span className="ms-2 inline-flex items-center justify-center rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-white">
                {metrics.completedTodayCount}
              </span>
            </div>
          </CardTitle>
          <Link to={createPageUrl('SalesTasks') + '?tab=completed'}>
            <Button variant="ghost" size="sm" className="text-xs">
              הכל
              <ChevronRight className="me-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-3 max-h-[520px] overflow-y-auto">
          {metrics.completedTodayTasks.length === 0 ? (
            <EmptyActionState title="אין כרגע משימות שהושלמו היום." />
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {metrics.completedTodayTasks.map((task) => {
                const lead = task.lead_id ? leadsById[task.lead_id] : null;
                const completedAt = parseGenericDate(task.updated_date || task.created_date);
                return (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => openTaskPopup(task.id)}
                    className="flex items-center gap-3 rounded-xl border border-emerald-200 p-3 text-start transition-all hover:bg-emerald-50/60 hover:shadow-sm"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-base">
                      {TASK_TYPE_EMOJI[task.task_type] || '📋'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{task.summary || lead?.full_name || 'משימה'}</p>
                      <p className="text-xs text-muted-foreground">{lead?.full_name && task.summary ? lead.full_name : ''}</p>
                    </div>
                    {lead?.status && (
                      <div className="flex-shrink-0">
                        <StatusBadge status={lead.status} />
                      </div>
                    )}
                    <div className="text-left flex-shrink-0">
                      <Badge className="bg-emerald-100 text-emerald-700 text-[11px]">בוצע</Badge>
                      {completedAt && (
                        <>
                          <p className="mt-0.5 text-sm font-bold text-foreground">{format(completedAt, 'HH:mm')}</p>
                          <p className="text-xs text-muted-foreground">{format(completedAt, 'EEEE dd/MM', { locale: he })}</p>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AddSalesTaskDialog
        isOpen={showTaskDialog}
        onClose={() => setShowTaskDialog(false)}
        effectiveUser={effectiveUser}
      />

      <EditSalesTaskDialog
        isOpen={!!editingTaskData}
        onClose={() => setEditingTaskData(null)}
        task={editingTaskData}
        effectiveUser={effectiveUser}
      />
    </div>
  );
}