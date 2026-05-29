import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { ChevronRight, ChevronLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { isAssignmentTask } from '@/lib/salesTaskWorkbench';

// A coloured dot per task type so a month at a glance reads like a heatmap
// of what kind of work is stacking up — matches the day/week views' palette.
const TASK_TYPE_DOT = {
  call: 'bg-blue-500',
  whatsapp: 'bg-emerald-500',
  email: 'bg-amber-500',
  meeting: 'bg-violet-500',
  quote_preparation: 'bg-indigo-500',
  followup: 'bg-orange-500',
  assignment: 'bg-slate-500',
  other: 'bg-gray-400',
};

// Sun→Sat, matching the Israeli working week the day/week views already use.
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MAX_CHIPS_PER_DAY = 3;

// Same shape/scoping as the day/week queries: open tasks only, no assignment
// queue, bounded to the visible calendar grid (which spills a few days into
// the neighbouring months), scoped to the rep unless an admin is viewing.
function useMonthTasks({ gridStart, gridEnd, isAdmin, userEmail, enabled }) {
  const startIso = startOfDay(gridStart).toISOString();
  const endIso = endOfDay(gridEnd).toISOString();
  return useQuery({
    queryKey: ['salesTasks-month', startIso, endIso, isAdmin ? 'admin' : userEmail || 'anon'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
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

export default function TaskMonthView({ effectiveUser, isAdmin, onTaskClick }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const userEmail = effectiveUser?.email;

  const viewMonth = useMemo(() => addMonths(startOfMonth(new Date()), monthOffset), [monthOffset]);
  const gridStart = useMemo(() => startOfWeek(startOfMonth(viewMonth)), [viewMonth]);
  const gridEnd = useMemo(() => endOfWeek(endOfMonth(viewMonth)), [viewMonth]);
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);
  const viewMonthNum = viewMonth.getMonth();

  const { data: tasks = [], isLoading } = useMonthTasks({
    gridStart,
    gridEnd,
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
    queryKey: ['month-view-leads', leadIds.join(',')],
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

  const tasksByDay = useMemo(() => {
    const map = new Map();
    for (const t of visibleTasks) {
      if (!t.due_date) continue;
      const key = format(new Date(t.due_date), 'yyyy-MM-dd');
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [visibleTasks]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" dir="rtl">
      {/* Month header + navigation */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">{format(viewMonth, 'MMMM yyyy', { locale: he })}</h2>
          {isLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setMonthOffset(0)}>
            היום
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset((o) => o + 1)} title="חודש הבא">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset((o) => o - 1)} title="חודש קודם">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — 1px gridlines via the gap showing the border-coloured bg */}
      <div className="grid grid-cols-7 gap-px bg-border">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayTasks = tasksByDay.get(key) || [];
          const inMonth = day.getMonth() === viewMonthNum;
          const today = isToday(day);
          const shown = dayTasks.slice(0, MAX_CHIPS_PER_DAY);
          const extra = dayTasks.length - shown.length;
          return (
            <div key={key} className={`min-h-[108px] p-1.5 ${inMonth ? 'bg-card' : 'bg-muted/20'}`}>
              <div className="mb-1 flex justify-end">
                <span
                  className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1 text-xs font-semibold ${
                    today
                      ? 'bg-primary text-primary-foreground'
                      : inMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground/40'
                  }`}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="space-y-1">
                {shown.map((t) => {
                  const lead = t.lead_id ? leadsById[t.lead_id] : null;
                  const name = lead?.full_name || t.summary || 'משימה';
                  const dot = TASK_TYPE_DOT[t.task_type] || TASK_TYPE_DOT.other;
                  const d = new Date(t.due_date);
                  const timed = !(d.getHours() === 0 && d.getMinutes() === 0);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onTaskClick?.(t)}
                      title={name}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-start text-[11px] transition-colors hover:bg-muted"
                    >
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dot}`} aria-hidden />
                      {timed && (
                        <span className="flex-shrink-0 font-semibold tabular-nums text-muted-foreground">
                          {format(d, 'HH:mm')}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name}</span>
                    </button>
                  );
                })}
                {extra > 0 && (
                  <div className="px-1.5 text-[10px] font-medium text-muted-foreground">עוד {extra}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
