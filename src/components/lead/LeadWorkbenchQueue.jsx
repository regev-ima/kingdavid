import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Phone,
  Users,
  FileText,
  ShoppingCart,
  UserCheck,
  RefreshCw,
  ClipboardList,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { he } from 'date-fns/locale';
import { format, differenceInCalendarDays } from '@/lib/safe-date-fns';
import { parseWorkbenchDate } from '@/lib/leadWorkbench';

// Visual metadata for each task type. The label here is the
// glanceable verb the rep sees on the row — "שיחה", "פגישה" —
// because their first question scanning the queue is "what kind of
// action is this?", not "what's its summary text?". Colour groups
// match the rest of the app's type palette (calls = blue, quotes =
// indigo, etc.) so the queue looks at home next to the action bar.
const TYPE_META = {
  call:              { label: 'שיחה',         icon: Phone,         tone: 'bg-blue-100    text-blue-700    border-blue-200' },
  meeting:           { label: 'פגישה',        icon: Users,         tone: 'bg-amber-100   text-amber-700   border-amber-200' },
  quote_preparation: { label: 'הצעת מחיר',   icon: FileText,      tone: 'bg-indigo-100  text-indigo-700  border-indigo-200' },
  close_order:       { label: 'סגירת הזמנה', icon: ShoppingCart,  tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  assignment:        { label: 'שיוך',         icon: UserCheck,     tone: 'bg-slate-100   text-slate-700   border-slate-200' },
  followup:          { label: 'מעקב',         icon: RefreshCw,     tone: 'bg-violet-100  text-violet-700  border-violet-200' },
};
const FALLBACK_TYPE_META = { label: 'משימה', icon: ClipboardList, tone: 'bg-muted text-foreground/70 border-border' };

// Visual treatment per urgency bucket. The left border colour is the
// single most glanceable signal — rep can scroll the lead screen and
// instantly count how many red bars sit in the queue.
const BUCKET_STYLE = {
  task_overdue:  { rail: 'bg-red-500',    rowHover: 'hover:bg-red-50/40' },
  task_today:    { rail: 'bg-amber-500',  rowHover: 'hover:bg-amber-50/40' },
  task_upcoming: { rail: 'bg-blue-400',   rowHover: 'hover:bg-blue-50/40' },
  task_undated:  { rail: 'bg-slate-300',  rowHover: 'hover:bg-slate-50/40' },
};

// Compact, human-readable "when?" string. Designed for one-glance
// reading at small font sizes — the rep should be able to triage the
// queue without parsing dates. For overdue tasks we show how long
// ago they slipped; for today/tomorrow we just show the time; for
// further-out tasks we fall back to a Hebrew weekday + time so the
// rep can compare across days without doing date math.
function whenLabel(item, dueDate, now) {
  if (item.type === 'task_undated' || !dueDate) return 'ללא תאריך יעד';

  const diffMs = dueDate.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const diffHour = Math.round(diffMs / (60 * 60_000));
  const dayDiff = differenceInCalendarDays(dueDate, now);

  if (item.type === 'task_overdue') {
    const absHour = Math.abs(diffHour);
    if (absHour < 1) return `באיחור ${Math.abs(diffMin)} דק׳`;
    if (absHour < 24) return `באיחור ${absHour} שע׳`;
    return `באיחור ${Math.abs(dayDiff)} ימים`;
  }

  const time = formatInTimeZone(dueDate, 'Asia/Jerusalem', 'HH:mm');
  if (item.type === 'task_today' || dayDiff === 0) return `היום ${time}`;
  if (dayDiff === 1) return `מחר ${time}`;
  if (dayDiff > 1 && dayDiff <= 6) return `יום ${format(dueDate, 'EEEE', { locale: he })} ${time}`;
  return `${formatInTimeZone(dueDate, 'Asia/Jerusalem', 'd/M')} ${time}`;
}

export default function LeadWorkbenchQueue({ state, onAction }) {
  const queue = state?.nowQueue || [];
  const counters = state?.counters || {};
  const now = React.useMemo(() => new Date(), []);

  // Only render chips for non-zero buckets — the previous version
  // always rendered all four ("באיחור: 0 | להיום: 0 | …") which the
  // product owner called out as visual noise on a clean lead.
  const chips = [
    { label: 'באיחור', count: counters.overdueTasks || 0, cls: 'bg-red-100 text-red-700 border-red-200' },
    { label: 'להיום',  count: counters.todayTasks   || 0, cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    { label: 'עתידי',  count: counters.upcomingTasks || 0, cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    { label: 'ללא יעד', count: counters.undatedTasks || 0, cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  ].filter((chip) => chip.count > 0);

  return (
    <Card className="rounded-xl border-border shadow-card overflow-hidden">
      <CardHeader className="py-3 border-b border-border/50 bg-muted/40">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            מה עושים עכשיו
            {queue.length > 0 ? (
              <span className="text-xs font-medium text-muted-foreground">· {queue.length} משימות</span>
            ) : null}
          </CardTitle>
          {chips.length > 0 ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${chip.cls}`}
                >
                  {chip.label} <span className="tabular-nums">{chip.count}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {queue.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground flex items-center justify-between gap-3">
            <span>אין משימות פתוחות כרגע — הכל מסודר.</span>
            <Button size="sm" variant="outline" onClick={() => onAction?.({ type: 'empty' }, 'new_task')}>
              משימה חדשה
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {queue.map((item) => {
              const dueDate = parseWorkbenchDate(item.dueAt);
              const taskType = item.entity?.task_type;
              const typeMeta = TYPE_META[taskType] || FALLBACK_TYPE_META;
              const bucketStyle = BUCKET_STYLE[item.type] || BUCKET_STYLE.task_undated;
              const TypeIcon = typeMeta.icon;
              const isOverdue = item.type === 'task_overdue';
              const summary = (item.entity?.summary || '').trim();

              return (
                <button
                  type="button"
                  key={`${item.type}-${item.id}`}
                  className={`w-full text-right flex items-stretch gap-0 transition-colors cursor-pointer ${bucketStyle.rowHover}`}
                  onClick={() => onAction?.(item, 'open_task')}
                >
                  {/* Urgency rail — single most glanceable signal.
                      Red bar = overdue, amber = today, etc. */}
                  <span className={`w-1 flex-shrink-0 ${bucketStyle.rail}`} aria-hidden />

                  <div className="flex-1 min-w-0 py-3 px-4 flex items-center gap-3">
                    {/* Type chip — the verb. This is the rep's
                        first answer to "what am I supposed to do
                        here?" so it's the big visible label, not
                        small grey text like before. */}
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold flex-shrink-0 ${typeMeta.tone}`}>
                      <TypeIcon className="h-3.5 w-3.5" />
                      {typeMeta.label}
                    </span>

                    {/* Optional content line. Empty when the rep
                        didn't fill תוכן on creation (which is now
                        the common case since content is optional). */}
                    {summary ? (
                      <span className="text-sm text-foreground truncate flex-1 min-w-0">{summary}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground/60 truncate flex-1 min-w-0">—</span>
                    )}

                    {/* When? — relative time, glanceable. Overdue
                        gets a destructive accent so the eye locks on
                        it even before reading the words. */}
                    <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums flex-shrink-0 ${isOverdue ? 'text-red-700' : 'text-muted-foreground'}`}>
                      {isOverdue ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                      {whenLabel(item, dueDate, now)}
                    </span>
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
