import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { addDays, format, startOfDay, endOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { Calendar as CalendarIcon, ChevronRight, ChevronLeft, Phone, MessageCircle, Mail, Users, FileText, RefreshCw, ClipboardList, Paperclip, Clock, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/shared/StatusBadge';
import { isAssignmentTask } from '@/lib/salesTaskWorkbench';

const HOURS_START = 7;  // 07:00
const HOURS_END = 21;   // 21:00 (exclusive)
const TASK_TYPE_ICONS = {
  call: Phone, whatsapp: MessageCircle, email: Mail, meeting: Users,
  quote_preparation: FileText, followup: RefreshCw, assignment: ClipboardList, other: Paperclip,
};

// Pull tasks scoped to the logged-in rep for a single day. Same OR-rep-scope
// the SalesTasks list query uses, plus the day-bounded due_date filter.
function useDayTasks({ date, isAdmin, userEmail, enabled }) {
  const dayStartIso = startOfDay(date).toISOString();
  const dayEndIso = endOfDay(date).toISOString();

  return useQuery({
    queryKey: ['salesTasks-day', dayStartIso, isAdmin ? 'admin' : userEmail || 'anon'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      let q = base44.supabase
        .from('sales_tasks')
        .select('*')
        .eq('task_status', 'not_completed')
        .gte('due_date', dayStartIso)
        .lte('due_date', dayEndIso)
        .order('due_date', { ascending: true });
      if (!isAdmin && userEmail) {
        q = q
          .neq('task_type', 'assignment')
          .or(`rep1.eq.${userEmail},rep2.eq.${userEmail},pending_rep_email.eq.${userEmail}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

// Tasks with no actual time-of-day (stored at midnight) live in a strip above
// the hourly grid so we don't pretend they were scheduled for 00:00. The
// remaining tasks bucket into hour slots.
function bucketTasks(tasks) {
  const slots = new Map(); // hour -> []
  const undated = [];
  for (const t of tasks) {
    const d = new Date(t.due_date);
    const hour = d.getHours();
    const minutes = d.getMinutes();
    if (hour === 0 && minutes === 0) {
      undated.push(t);
    } else if (hour < HOURS_START || hour >= HOURS_END) {
      // Out-of-hours stays in its closest visible slot — clamping keeps the
      // grid manageable. A future iteration can expose dedicated early/late
      // bands if reps complain.
      const clamped = Math.min(Math.max(hour, HOURS_START), HOURS_END - 1);
      const arr = slots.get(clamped) || [];
      arr.push(t);
      slots.set(clamped, arr);
    } else {
      const arr = slots.get(hour) || [];
      arr.push(t);
      slots.set(hour, arr);
    }
  }
  return { slots, undated };
}

function TaskCard({ task, lead, isDragging, dragProvided, onClick }) {
  const Icon = TASK_TYPE_ICONS[task.task_type] || Paperclip;
  const leadName = lead?.full_name || task?.summary?.match(/הליד (.+?)$/)?.[1] || 'ליד';
  const phone = lead?.phone;

  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-lg border bg-card p-2 text-sm shadow-sm transition-all cursor-pointer
        ${isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:border-primary/40 hover:shadow-md'}`}
    >
      <span
        {...(dragProvided?.dragHandleProps || {})}
        className="text-muted-foreground/50 group-hover:text-muted-foreground"
        title="גרור כדי לתזמן מחדש"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-foreground">{leadName}</div>
        {phone && <div className="truncate text-xs text-muted-foreground" dir="ltr">{phone}</div>}
      </div>
      {(task.status || lead?.status) && (
        <StatusBadge status={task.status || lead?.status} className="text-[10px] py-0 px-1.5" />
      )}
    </div>
  );
}

export default function TaskDayView({ effectiveUser, isAdmin, onTaskClick }) {
  const [date, setDate] = useState(() => startOfDay(new Date()));
  const queryClient = useQueryClient();
  const userEmail = effectiveUser?.email;

  const { data: tasks = [], isLoading } = useDayTasks({
    date,
    isAdmin,
    userEmail,
    enabled: !!effectiveUser,
  });

  // The cards display lead name/phone — fetch them in one batch instead of
  // doing N round-trips like the list view used to.
  const leadIds = useMemo(
    () => [...new Set(tasks.map((t) => t.lead_id).filter(Boolean))],
    [tasks],
  );
  const { data: leadsRaw = [] } = useQuery({
    queryKey: ['day-view-leads', leadIds.join(',')],
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

  const visibleTasks = useMemo(
    () => (isAdmin ? tasks : tasks.filter((t) => !isAssignmentTask(t))),
    [tasks, isAdmin],
  );
  const { slots, undated } = useMemo(() => bucketTasks(visibleTasks), [visibleTasks]);

  // Reschedule by setting due_date to {date}T{hour}:00. Optimistic-friendly
  // through react-query's invalidation; we keep the write simple and let the
  // refetch settle the UI.
  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, hour, dropDate }) => {
      const next = new Date(dropDate);
      next.setHours(hour, 0, 0, 0);
      return base44.entities.SalesTask.update(id, { due_date: next.toISOString() });
    },
    onSuccess: () => {
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
    // droppableId is "hour-N" or "undated". Undated drops keep date-only.
    if (destination.droppableId === 'undated') {
      // Setting hour=0 produces midnight, which our bucketing reads as undated.
      rescheduleMutation.mutate({ id: draggableId, hour: 0, dropDate: date });
      return;
    }
    const hour = parseInt(destination.droppableId.replace('hour-', ''), 10);
    if (Number.isNaN(hour)) return;
    rescheduleMutation.mutate({ id: draggableId, hour, dropDate: date });
  };

  const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const totalCount = visibleTasks.length;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header — date navigator */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setDate(addDays(date, -1))} className="h-8 px-2">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant={isToday ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDate(startOfDay(new Date()))}
            className="h-8"
          >
            <CalendarIcon className="h-3.5 w-3.5 me-1" /> היום
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDate(addDays(date, 1))} className="h-8 px-2">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={format(date, 'yyyy-MM-dd')}
            onChange={(e) => {
              const next = e.target.value ? startOfDay(new Date(e.target.value)) : startOfDay(new Date());
              setDate(next);
            }}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
          <span className="text-sm text-muted-foreground">
            {format(date, 'EEEE, d בMMMM', { locale: he })} · {totalCount} משימות
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">טוען...</div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          {/* Undated strip — tasks with date but no time */}
          <Droppable droppableId="undated" direction="horizontal">
            {(dropProvided, dropSnapshot) => (
              <Card
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className={`p-3 transition-colors ${
                  dropSnapshot.isDraggingOver ? 'bg-primary/5 ring-2 ring-primary/40' : 'bg-muted/30'
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> ללא שעה ({undated.length})
                </div>
                {undated.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70">
                    {dropSnapshot.isDraggingOver ? 'שחרר כדי להסיר את השעה' : 'אין משימות ללא שעה ביום זה'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {undated.map((task, idx) => (
                      <Draggable key={task.id} draggableId={task.id} index={idx}>
                        {(dragProvided, dragSnapshot) => (
                          <div className="min-w-[220px] flex-1">
                            <TaskCard
                              task={task}
                              lead={leadsById[task.lead_id]}
                              dragProvided={dragProvided}
                              isDragging={dragSnapshot.isDragging}
                              onClick={() => onTaskClick?.(task)}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                  </div>
                )}
                {dropProvided.placeholder}
              </Card>
            )}
          </Droppable>

          {/* Hour grid */}
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i).map((hour) => {
                const hourTasks = slots.get(hour) || [];
                const droppableId = `hour-${hour}`;
                const isCurrentHour = isToday && new Date().getHours() === hour;
                return (
                  <Droppable droppableId={droppableId} key={droppableId}>
                    {(dropProvided, dropSnapshot) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        className={`flex min-h-[64px] gap-3 px-3 py-2 transition-colors ${
                          dropSnapshot.isDraggingOver ? 'bg-primary/5' : isCurrentHour ? 'bg-amber-50/40' : ''
                        }`}
                      >
                        <div className="w-12 flex-shrink-0 select-none text-xs font-bold text-muted-foreground tabular-nums">
                          {String(hour).padStart(2, '0')}:00
                        </div>
                        <div className="flex-1 space-y-1.5">
                          {hourTasks.length === 0 && (
                            <div className="text-[11px] text-muted-foreground/50 italic">
                              {dropSnapshot.isDraggingOver ? 'שחרר כדי לתזמן לשעה זו' : ''}
                            </div>
                          )}
                          {hourTasks.map((task, idx) => (
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
                      </div>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </Card>
        </DragDropContext>
      )}
    </div>
  );
}
