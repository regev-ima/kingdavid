import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CalendarClock, Clock } from 'lucide-react';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { he } from 'date-fns/locale';
import { format } from '@/lib/safe-date-fns';
import { parseWorkbenchDate } from '@/lib/leadWorkbench';

function formatDueDate(date) {
  const dayName = format(date, 'EEEE', { locale: he });
  const dateStr = formatInTimeZone(date, 'Asia/Jerusalem', 'd/M');
  const timeStr = formatInTimeZone(date, 'Asia/Jerusalem', 'HH:mm');
  return `יום ${dayName} ${dateStr} בשעה: ${timeStr}`;
}

function getItemIcon(item) {
  if (item.type === 'task_overdue') return <AlertTriangle className="h-4 w-4 text-red-600" />;
  if (item.type === 'task_today') return <CalendarClock className="h-4 w-4 text-blue-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function getReasonTone(item) {
  if (item.type === 'task_overdue') return 'destructive';
  if (item.type === 'task_today') return 'warning';
  return 'secondary';
}

export default function LeadWorkbenchQueue({ state, onAction }) {
  const queue = state?.nowQueue || [];
  const counters = state?.counters || {};

  return (
    <Card className="rounded-xl border-border shadow-card overflow-hidden">
      <CardHeader className="py-3 border-b border-border/50 bg-muted/40 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            מה עושים עכשיו
          </CardTitle>
          <Badge variant="outline" className="text-xs">{counters.totalQueue || 0} משימות</Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="destructive">באיחור: {counters.overdueTasks || 0}</Badge>
          <Badge variant="warning">להיום: {counters.todayTasks || 0}</Badge>
          <Badge variant="info">עתידי: {counters.upcomingTasks || 0}</Badge>
          <Badge variant="secondary">ללא יעד: {counters.undatedTasks || 0}</Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {queue.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground flex items-center justify-between gap-3">
            <span>אין משימות פתוחות כרגע.</span>
            <Button size="sm" variant="outline" onClick={() => onAction?.({ type: 'empty' }, 'new_task')}>
              משימה חדשה
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {queue.map((item) => {
              const dueDate = parseWorkbenchDate(item.dueAt);
              return (
                <button
                  type="button"
                  key={`${item.type}-${item.id}`}
                  className="w-full text-right p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onAction?.(item, 'open_task')}
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getItemIcon(item)}
                      <span className="font-semibold text-sm text-foreground">{item.title}</span>
                      <Badge variant={getReasonTone(item)} className="text-[11px]">{item.reason}</Badge>
                    </div>

                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                      {item.subtitle ? <span>{item.subtitle}</span> : null}
                      {dueDate ? (
                        <span>{formatDueDate(dueDate)}</span>
                      ) : (
                        <span>ללא תאריך יעד</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
