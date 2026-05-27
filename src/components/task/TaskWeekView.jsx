import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { addDays, format, startOfDay, endOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { ChevronRight, ChevronLeft, Phone, MessageCircle, Mail, Users, FileText, RefreshCw, ClipboardList, Paperclip, Clock, GripVertical, CalendarDays, PanelRightOpen, PanelRightClose, AlertCircle, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';
import { isAssignmentTask } from '@/lib/salesTaskWorkbench';

const HOURS_START = 7;
const HOURS_END = 21;
const TASK_TYPE_ICONS = {
  call: Phone, whatsapp: MessageCircle, email: Mail, meeting: Users,
  quote_preparation: FileText, followup: RefreshCw, assignment: ClipboardList, other: Paperclip,
};

// Colour map per task type so reps can tell a call from a meeting at a glance
// in both the grid and the sidebar. Keep contrast on the colored stripe high
// enough to remain readable on the lavender hover state.
const TASK_TYPE_STYLES = {
  call:              { stripe: 'bg-blue-500',    bg: 'bg-blue-50',    icon: 'text-blue-600',    label: 'שיחה' },
  whatsapp:          { stripe: 'bg-emerald-500', bg: 'bg-emerald-50', icon: 'text-emerald-600', label: 'וואטסאפ' },
  email:             { stripe: 'bg-amber-500',   bg: 'bg-amber-50',   icon: 'text-amber-600',   label: 'מייל' },
  meeting:           { stripe: 'bg-violet-500',  bg: 'bg-violet-50',  icon: 'text-violet-600',  label: 'פגישה' },
  quote_preparation: { stripe: 'bg-indigo-500',  bg: 'bg-indigo-50',  icon: 'text-indigo-600',  label: 'הצעת מחיר' },
  followup:          { stripe: 'bg-orange-500',  bg: 'bg-orange-50',  icon: 'text-orange-600',  label: 'מעקב' },
  assignment:        { stripe: 'bg-slate-500',   bg: 'bg-slate-50',   icon: 'text-slate-600',   label: 'הקצאה' },
  other:             { stripe: 'bg-gray-400',    bg: 'bg-gray-50',    icon: 'text-gray-600',    label: 'אחר' },
};
const getTaskTypeStyle = (type) => TASK_TYPE_STYLES[type] || TASK_TYPE_STYLES.other;

// Working week is Sun→Thu (5 days, skip Friday/Saturday). Picking a "week
// start" lets us compute weekOffset relative to today consistently.
function getWeekStart(refDate) {
  const d = startOfDay(refDate);
  const day = d.getDay(); // 0=Sun
  return addDays(d, -day);
}

// Sidebar feed: not-completed tasks the user owns, regardless of which week
// is shown in the grid. Split in memory by today / overdue / upcoming so we
// only hit the server once per (user, isAdmin) pair instead of three times.
function useBacklogTasks({ isAdmin, userEmail, enabled }) {
  return useQuery({
    queryKey: ['salesTasks-backlog', isAdmin ? 'admin' : userEmail || 'anon'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      let q = base44.supabase
        .from('sales_tasks')
        .select('*')
        .eq('task_status', 'not_completed')
        .neq('task_type', 'assignment')
        .order('due_date', { ascending: true })
        .limit(500);
      if (!isAdmin && userEmail) {
        q = q.or(`rep1.eq.${userEmail},rep2.eq.${userEmail},pending_rep_email.eq.${userEmail}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

function useWeekTasks({ weekStart, isAdmin, userEmail, enabled }) {
  const startIso = startOfDay(weekStart).toISOString();
  const endIso = endOfDay(addDays(weekStart, 4)).toISOString();
  return useQuery({
    queryKey: ['salesTasks-week', startIso, isAdmin ? 'admin' : userEmail || 'anon'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      // Assignment tasks are an admin queue, not work-on-the-clock items —
      // they don't belong on a calendar. Hide them for everyone; the
      // dedicated "להקצות" tab in the list view is where they live.
      let q = base44.supabase
        .from('sales_tasks')
        .select('*')
        .eq('task_status', 'not_completed')
        .neq('task_type', 'assignment')
        .gte('due_date', startIso)
        .lte('due_date', endIso)
        .order('due_date', { ascending: true });
      if (!isAdmin && userEmail) {
        q = q.or(`rep1.eq.${userEmail},rep2.eq.${userEmail},pending_rep_email.eq.${userEmail}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

// Bucket tasks into a Map keyed by `${dayKey}|${hour}`. Date-only entries
// (stored at midnight) drop into a `${dayKey}|undated` bucket so the card
// strips at the top of each column show them.
function bucketTasks(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const d = new Date(t.due_date);
    const dayKey = format(d, 'yyyy-MM-dd');
    const hour = d.getHours();
    const minutes = d.getMinutes();
    // Bucket key MUST match the droppableId we render below — that's
    // `${dayKey}|hour-${N}` for time slots, `${dayKey}|undated` for the
    // date-only strip. The previous version stored just the bare hour
    // number ("yyyy-MM-dd|14") and lookups against "yyyy-MM-dd|hour-14"
    // never resolved, so the entire week grid rendered empty.
    const key =
      hour === 0 && minutes === 0
        ? `${dayKey}|undated`
        : `${dayKey}|hour-${Math.min(Math.max(hour, HOURS_START), HOURS_END - 1)}`;
    const arr = map.get(key) || [];
    arr.push(t);
    map.set(key, arr);
  }
  return map;
}

function TaskCard({ task, lead, isDragging, dragProvided, onClick, onCall }) {
  const Icon = TASK_TYPE_ICONS[task.task_type] || Paperclip;
  const style = getTaskTypeStyle(task.task_type);
  const leadName = lead?.full_name || task?.summary?.match(/הליד (.+?)$/)?.[1] || 'ליד';
  const phone = lead?.phone;

  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      onClick={onClick}
      title={style.label}
      className={`group relative flex items-center gap-1.5 overflow-hidden rounded-md border ${style.bg} pe-1.5 ps-2 py-1 text-[11px] shadow-sm transition-all cursor-pointer
        ${isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:border-primary/40 hover:shadow-md'}`}
    >
      <span className={`absolute inset-y-0 right-0 w-1 ${style.stripe}`} aria-hidden />
      <span
        {...(dragProvided?.dragHandleProps || {})}
        className="text-muted-foreground/50 group-hover:text-muted-foreground"
      >
        <GripVertical className="h-3 w-3" />
      </span>
      <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${style.icon}`} />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{leadName}</span>
      {phone && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCall?.(phone);
          }}
          className="flex-shrink-0 rounded-full bg-green-100 hover:bg-green-200 active:bg-green-300 p-1 text-green-700 transition-colors"
          title={`התקשר ל-${phone}`}
        >
          <Phone className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default function TaskWeekView({ effectiveUser, isAdmin, onTaskClick }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('today'); // 'today' | 'overdue' | 'upcoming'
  const queryClient = useQueryClient();
  const userEmail = effectiveUser?.email;

  const weekStart = useMemo(
    () => addDays(getWeekStart(new Date()), weekOffset * 7),
    [weekOffset],
  );
  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), // Sun..Thu
    [weekStart],
  );
  const dayKeys = useMemo(() => days.map((d) => format(d, 'yyyy-MM-dd')), [days]);

  const { data: tasks = [], isLoading } = useWeekTasks({
    weekStart,
    isAdmin,
    userEmail,
    enabled: !!effectiveUser,
  });

  const visibleTasks = useMemo(
    () => (isAdmin ? tasks : tasks.filter((t) => !isAssignmentTask(t))),
    [tasks, isAdmin],
  );

  const leadIds = useMemo(
    () => [...new Set(visibleTasks.map((t) => t.lead_id).filter(Boolean))],
    [visibleTasks],
  );
  const { data: leadsRaw = [] } = useQuery({
    queryKey: ['week-view-leads', leadIds.join(',')],
    enabled: leadIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .from('leads')
        .select('id, full_name, phone, status')
        .in('id', leadIds);
      if (error) throw error;
      return data || [];
    },
  });
  const leadsById = useMemo(() => Object.fromEntries(leadsRaw.map((l) => [l.id, l])), [leadsRaw]);

  const buckets = useMemo(() => bucketTasks(visibleTasks), [visibleTasks]);

  // Sidebar feed lives outside the week filter so reps can drag tomorrow's /
  // last week's open tasks into the visible grid.
  const { data: backlog = [] } = useBacklogTasks({
    isAdmin,
    userEmail,
    enabled: !!effectiveUser && sidebarOpen,
  });
  const backlogLeadIds = useMemo(
    () => [...new Set(backlog.map((t) => t.lead_id).filter((id) => id && !leadsById[id]))],
    [backlog, leadsById],
  );
  const { data: backlogLeadsRaw = [] } = useQuery({
    queryKey: ['week-view-backlog-leads', backlogLeadIds.join(',')],
    enabled: backlogLeadIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .from('leads')
        .select('id, full_name, phone, status')
        .in('id', backlogLeadIds);
      if (error) throw error;
      return data || [];
    },
  });
  const allLeadsById = useMemo(
    () => ({ ...leadsById, ...Object.fromEntries(backlogLeadsRaw.map((l) => [l.id, l])) }),
    [leadsById, backlogLeadsRaw],
  );

  // Split the backlog into the three tabs. "today" = same calendar day,
  // "overdue" = strictly before today and still not_completed, "upcoming" =
  // anything in the future (incl. undated tasks pinned to a day's midnight).
  const backlogTabs = useMemo(() => {
    const now = new Date();
    const startToday = startOfDay(now).getTime();
    const endToday = endOfDay(now).getTime();
    const today = [];
    const overdue = [];
    const upcoming = [];
    for (const t of backlog) {
      if (!t.due_date) {
        upcoming.push(t);
        continue;
      }
      const ts = new Date(t.due_date).getTime();
      if (ts < startToday) overdue.push(t);
      else if (ts <= endToday) today.push(t);
      else upcoming.push(t);
    }
    // Overdue: oldest first so the most-late items surface at the top.
    overdue.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    return { today, overdue, upcoming };
  }, [backlog]);

  const sidebarTasks = backlogTabs[sidebarTab] || [];

  const handleCall = async (phone) => {
    if (!phone) return;
    try {
      await base44.functions.invoke('clickToCall', { customerPhone: phone });
      toast.success(`מתקשר ל-${phone}`);
    } catch (err) {
      toast.error(`חיוג נכשל: ${err?.message || 'שגיאה'}`);
    }
  };

  // Drag updates due_date to the dropped (day, hour). 'undated' drops keep
  // the day but zero the time so they surface in the date-only strip.
  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, dayKey, hour }) => {
      const next = new Date(dayKey);
      next.setHours(hour, 0, 0, 0);
      return base44.entities.SalesTask.update(id, { due_date: next.toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks-week'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks-day'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks-counts'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks-tab'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks-backlog'] });
      toast.success('המשימה תוזמנה מחדש');
    },
    onError: (err) => toast.error(`תזמון נכשל: ${err?.message || 'שגיאה'}`),
  });

  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    if (rescheduleMutation.isPending) return;
    // droppableId: "yyyy-MM-dd|hour-N" or "yyyy-MM-dd|undated"
    const [dayKey, slot] = destination.droppableId.split('|');
    if (slot === 'undated') {
      rescheduleMutation.mutate({ id: draggableId, dayKey, hour: 0 });
      return;
    }
    const hour = parseInt(slot.replace('hour-', ''), 10);
    if (Number.isNaN(hour)) return;
    rescheduleMutation.mutate({ id: draggableId, dayKey, hour });
  };

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const totalCount = visibleTasks.length;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset - 1)} className="h-8 px-2">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant={weekOffset === 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setWeekOffset(0)}
            className="h-8"
          >
            <CalendarDays className="h-3.5 w-3.5 me-1" /> השבוע
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset + 1)} className="h-8 px-2">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {format(weekStart, 'd/M', { locale: he })} – {format(addDays(weekStart, 4), 'd/M', { locale: he })} · {totalCount} משימות
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSidebarOpen((v) => !v)}
          className="h-8"
          title={sidebarOpen ? 'הסתר רשימת משימות' : 'הצג רשימת משימות'}
        >
          {sidebarOpen ? <PanelRightClose className="h-4 w-4 me-1" /> : <PanelRightOpen className="h-4 w-4 me-1" />}
          {sidebarOpen ? 'הסתר רשימה' : 'הצג רשימה'}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">טוען...</div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
        {/* @hello-pangea/dnd computes drag-ghost positions in LTR
            coordinates and breaks visibly under dir="rtl" — the ghost
            drifts away from the cursor as the user moves further from
            the source cell, making it impossible to drop accurately.
            Fix: wrap the entire DnD subtree in dir="ltr" so the
            library's math works. To keep the visual RTL layout (time
            column on the right, ימי השבוע reading right-to-left), we
            put the time column LAST in the grid and reverse dayKeys
            when rendering — net result is identical to the original
            display, but drag positions track the cursor 1:1. Hebrew
            text inside cards renders correctly via Unicode bidi. */}
        <div dir="ltr" className="flex flex-row-reverse gap-3 items-start">
          <Card className="overflow-hidden flex-1 min-w-0">
            {/* Header row: 5 day labels + empty corner (rightmost) */}
            <div className="grid grid-cols-[repeat(5,_1fr)_56px] border-b border-border bg-muted/40 text-xs font-bold text-foreground">
              {[...days].reverse().map((d) => {
                const key = format(d, 'yyyy-MM-dd');
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    className={`border-e border-border px-2 py-2 text-center ${
                      isToday ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    <div>{format(d, 'EEEE', { locale: he })}</div>
                    <div className="text-[10px] font-normal opacity-70">{format(d, 'dd/MM')}</div>
                  </div>
                );
              })}
              <div />
            </div>

            {/* Undated strip — one bucket per day */}
            <div className="grid grid-cols-[repeat(5,_1fr)_56px] border-b border-border bg-muted/20">
              {[...dayKeys].reverse().map((dayKey) => {
                const droppableId = `${dayKey}|undated`;
                const cellTasks = buckets.get(droppableId) || [];
                return (
                  <Droppable key={droppableId} droppableId={droppableId}>
                    {(dropProvided, dropSnapshot) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        className={`min-h-[36px] space-y-1 border-e border-border p-1 transition-colors ${
                          dropSnapshot.isDraggingOver ? 'bg-primary/10' : ''
                        }`}
                      >
                        {cellTasks.map((task, idx) => (
                          <Draggable key={task.id} draggableId={task.id} index={idx}>
                            {(dragProvided, dragSnapshot) => (
                              <TaskCard
                                task={task}
                                lead={allLeadsById[task.lead_id]}
                                dragProvided={dragProvided}
                                isDragging={dragSnapshot.isDragging}
                                onClick={() => onTaskClick?.(task)}
                                onCall={handleCall}
                              />
                            )}
                          </Draggable>
                        ))}
                        {dropProvided.placeholder}
                      </div>
                    )}
                  </Droppable>
                );
              })}
              <div className="flex items-center justify-center py-1.5 text-[10px] font-semibold text-muted-foreground">
                <Clock className="h-3 w-3" />
              </div>
            </div>

            {/* Hour rows × day columns */}
            {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i).map((hour) => {
              const isCurrentHour = new Date().getHours() === hour;
              return (
                <div
                  key={hour}
                  className="grid grid-cols-[repeat(5,_1fr)_56px] border-b border-border last:border-0"
                >
                  {[...dayKeys].reverse().map((dayKey) => {
                    const droppableId = `${dayKey}|hour-${hour}`;
                    const cellTasks = buckets.get(droppableId) || [];
                    const isTodayHour = dayKey === todayKey && isCurrentHour;
                    return (
                      <Droppable key={droppableId} droppableId={droppableId}>
                        {(dropProvided, dropSnapshot) => (
                          <div
                            ref={dropProvided.innerRef}
                            {...dropProvided.droppableProps}
                            className={`min-h-[52px] space-y-1 border-e border-border p-1 transition-colors ${
                              dropSnapshot.isDraggingOver
                                ? 'bg-primary/10'
                                : isTodayHour
                                ? 'bg-amber-50/40'
                                : ''
                            }`}
                          >
                            {cellTasks.map((task, idx) => (
                              <Draggable key={task.id} draggableId={task.id} index={idx}>
                                {(dragProvided, dragSnapshot) => (
                                  <TaskCard
                                    task={task}
                                    lead={allLeadsById[task.lead_id]}
                                    dragProvided={dragProvided}
                                    isDragging={dragSnapshot.isDragging}
                                    onClick={() => onTaskClick?.(task)}
                                    onCall={handleCall}
                                  />
                                )}
                              </Draggable>
                            ))}
                            {dropProvided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    );
                  })}
                  <div className="flex items-start justify-center py-2 text-[11px] font-bold text-muted-foreground tabular-nums">
                    {String(hour).padStart(2, '0')}:00
                  </div>
                </div>
              );
            })}
          </Card>

          {sidebarOpen && (
            <BacklogSidebar
              tab={sidebarTab}
              onTabChange={setSidebarTab}
              counts={{
                today: backlogTabs.today.length,
                overdue: backlogTabs.overdue.length,
                upcoming: backlogTabs.upcoming.length,
              }}
              tasks={sidebarTasks}
              leadsById={allLeadsById}
              onTaskClick={onTaskClick}
              onCall={handleCall}
            />
          )}
        </div>
        </DragDropContext>
      )}
    </div>
  );
}

const SIDEBAR_TABS = [
  { id: 'today', label: 'היום', Icon: CalendarDays },
  { id: 'overdue', label: 'באיחור', Icon: AlertCircle },
  { id: 'upcoming', label: 'ממתין', Icon: Hourglass },
];

function BacklogSidebar({ tab, onTabChange, counts, tasks, leadsById, onTaskClick, onCall }) {
  return (
    <Card className="w-72 flex-shrink-0 flex flex-col max-h-[calc(100vh-220px)]" dir="rtl">
      <div className="flex border-b border-border">
        {SIDEBAR_TABS.map(({ id, label, Icon }) => {
          const isActive = tab === id;
          const count = counts[id] || 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold leading-tight ${
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <Droppable droppableId="sidebar-backlog" isDropDisabled={true}>
        {(dropProvided) => (
          <div
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            className="flex-1 overflow-y-auto p-2 space-y-1.5"
          >
            {tasks.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                {tab === 'today' && 'אין משימות להיום'}
                {tab === 'overdue' && 'אין משימות באיחור'}
                {tab === 'upcoming' && 'אין משימות ממתינות'}
              </div>
            ) : (
              tasks.map((task, idx) => (
                <Draggable key={task.id} draggableId={task.id} index={idx}>
                  {(dragProvided, dragSnapshot) => (
                    <SidebarTaskCard
                      task={task}
                      lead={leadsById[task.lead_id]}
                      dragProvided={dragProvided}
                      isDragging={dragSnapshot.isDragging}
                      onClick={() => onTaskClick?.(task)}
                      onCall={onCall}
                    />
                  )}
                </Draggable>
              ))
            )}
            {dropProvided.placeholder}
          </div>
        )}
      </Droppable>
    </Card>
  );
}

function SidebarTaskCard({ task, lead, isDragging, dragProvided, onClick, onCall }) {
  const Icon = TASK_TYPE_ICONS[task.task_type] || Paperclip;
  const style = getTaskTypeStyle(task.task_type);
  const leadName = lead?.full_name || task?.summary?.match(/הליד (.+?)$/)?.[1] || 'ליד';
  const phone = lead?.phone;
  const due = task.due_date ? new Date(task.due_date) : null;
  const dueLabel = due
    ? (due.getHours() === 0 && due.getMinutes() === 0
        ? format(due, 'dd/MM', { locale: he })
        : format(due, 'dd/MM HH:mm', { locale: he }))
    : 'ללא תאריך';
  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      onClick={onClick}
      title={style.label}
      className={`group relative flex items-center gap-1.5 overflow-hidden rounded-md border ${style.bg} pe-2 ps-3 py-1.5 text-xs shadow-sm transition-all cursor-pointer
        ${isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:border-primary/40 hover:shadow-md'}`}
    >
      <span className={`absolute inset-y-0 right-0 w-1 ${style.stripe}`} aria-hidden />
      <span
        {...(dragProvided?.dragHandleProps || {})}
        className="text-muted-foreground/50 group-hover:text-muted-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <Icon className={`h-4 w-4 flex-shrink-0 ${style.icon}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{leadName}</div>
        <div className="truncate text-[10px] text-muted-foreground tabular-nums">{dueLabel}</div>
      </div>
      {phone && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCall?.(phone);
          }}
          className="flex-shrink-0 rounded-full bg-green-100 hover:bg-green-200 active:bg-green-300 p-1 text-green-700 transition-colors"
          title={`התקשר ל-${phone}`}
        >
          <Phone className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
