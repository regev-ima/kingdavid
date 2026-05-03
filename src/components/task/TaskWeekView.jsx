import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { addDays, format, startOfDay, endOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { ChevronRight, ChevronLeft, Phone, MessageCircle, Mail, Users, FileText, RefreshCw, ClipboardList, Paperclip, Clock, GripVertical, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/shared/StatusBadge';
import { isAssignmentTask } from '@/lib/salesTaskWorkbench';

const HOURS_START = 7;
const HOURS_END = 21;
const TASK_TYPE_ICONS = {
  call: Phone, whatsapp: MessageCircle, email: Mail, meeting: Users,
  quote_preparation: FileText, followup: RefreshCw, assignment: ClipboardList, other: Paperclip,
};

// Working week is Sun→Thu (5 days, skip Friday/Saturday). Picking a "week
// start" lets us compute weekOffset relative to today consistently.
function getWeekStart(refDate) {
  const d = startOfDay(refDate);
  const day = d.getDay(); // 0=Sun
  return addDays(d, -day);
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
    const key =
      hour === 0 && minutes === 0
        ? `${dayKey}|undated`
        : `${dayKey}|${Math.min(Math.max(hour, HOURS_START), HOURS_END - 1)}`;
    const arr = map.get(key) || [];
    arr.push(t);
    map.set(key, arr);
  }
  return map;
}

function TaskCard({ task, lead, isDragging, dragProvided, onClick }) {
  const Icon = TASK_TYPE_ICONS[task.task_type] || Paperclip;
  const leadName = lead?.full_name || task?.summary?.match(/הליד (.+?)$/)?.[1] || 'ליד';

  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      onClick={onClick}
      className={`group flex items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 text-[11px] shadow-sm transition-all cursor-pointer
        ${isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:border-primary/40 hover:shadow-md'}`}
    >
      <span
        {...(dragProvided?.dragHandleProps || {})}
        className="text-muted-foreground/50 group-hover:text-muted-foreground"
      >
        <GripVertical className="h-3 w-3" />
      </span>
      <Icon className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{leadName}</span>
      {(task.status || lead?.status) && (
        <StatusBadge status={task.status || lead?.status} className="text-[9px] py-0 px-1" />
      )}
    </div>
  );
}

export default function TaskWeekView({ effectiveUser, isAdmin, onTaskClick }) {
  const [weekOffset, setWeekOffset] = useState(0);
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
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">טוען...</div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Card className="overflow-hidden">
            {/* Header row: empty corner + 5 day labels */}
            <div className="grid grid-cols-[56px_repeat(5,_1fr)] border-b border-border bg-muted/40 text-xs font-bold text-foreground">
              <div />
              {days.map((d) => {
                const key = format(d, 'yyyy-MM-dd');
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    className={`border-s border-border px-2 py-2 text-center ${
                      isToday ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    <div>{format(d, 'EEEE', { locale: he })}</div>
                    <div className="text-[10px] font-normal opacity-70">{format(d, 'dd/MM')}</div>
                  </div>
                );
              })}
            </div>

            {/* Undated strip — one bucket per day */}
            <div className="grid grid-cols-[56px_repeat(5,_1fr)] border-b border-border bg-muted/20">
              <div className="flex items-center justify-center py-1.5 text-[10px] font-semibold text-muted-foreground">
                <Clock className="h-3 w-3" />
              </div>
              {dayKeys.map((dayKey) => {
                const droppableId = `${dayKey}|undated`;
                const cellTasks = buckets.get(droppableId) || [];
                return (
                  <Droppable key={droppableId} droppableId={droppableId}>
                    {(dropProvided, dropSnapshot) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        className={`min-h-[36px] space-y-1 border-s border-border p-1 transition-colors ${
                          dropSnapshot.isDraggingOver ? 'bg-primary/10' : ''
                        }`}
                      >
                        {cellTasks.map((task, idx) => (
                          <Draggable key={task.id} draggableId={task.id} index={idx}>
                            {(dragProvided, dragSnapshot) => (
                              <TaskCard
                                task={task}
                                lead={leadsById[task.lead_id]}
                                dragProvided={dragProvided}
                                isDragging={dragSnapshot.isDragging}
                                onClick={() => onTaskClick?.(task)}
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
            </div>

            {/* Hour rows × day columns */}
            {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i).map((hour) => {
              const isCurrentHour = new Date().getHours() === hour;
              return (
                <div
                  key={hour}
                  className="grid grid-cols-[56px_repeat(5,_1fr)] border-b border-border last:border-0"
                >
                  <div className="flex items-start justify-center py-2 text-[11px] font-bold text-muted-foreground tabular-nums">
                    {String(hour).padStart(2, '0')}:00
                  </div>
                  {dayKeys.map((dayKey) => {
                    const droppableId = `${dayKey}|hour-${hour}`;
                    const cellTasks = buckets.get(droppableId) || [];
                    const isTodayHour = dayKey === todayKey && isCurrentHour;
                    return (
                      <Droppable key={droppableId} droppableId={droppableId}>
                        {(dropProvided, dropSnapshot) => (
                          <div
                            ref={dropProvided.innerRef}
                            {...dropProvided.droppableProps}
                            className={`min-h-[52px] space-y-1 border-s border-border p-1 transition-colors ${
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
                                    lead={leadsById[task.lead_id]}
                                    dragProvided={dragProvided}
                                    isDragging={dragSnapshot.isDragging}
                                    onClick={() => onTaskClick?.(task)}
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
                </div>
              );
            })}
          </Card>
        </DragDropContext>
      )}
    </div>
  );
}
