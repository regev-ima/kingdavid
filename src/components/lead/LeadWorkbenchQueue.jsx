import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Phone,
  Users,
  FileText,
  ShoppingCart,
  RefreshCw,
  ClipboardList,
  CheckCircle2,
  Plus,
} from 'lucide-react';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { he } from 'date-fns/locale';
import { format, differenceInCalendarDays } from '@/lib/safe-date-fns';
import { parseWorkbenchDate } from '@/lib/leadWorkbench';

// Visual metadata for each task type. The label here is the glanceable verb
// the rep sees on the row — "שיחה", "פגישה" — because their first question
// scanning the queue is "what kind of action is this?", not "what's its
// summary text?".
const TYPE_META = {
  call:              { label: 'שיחה',        icon: Phone },
  meeting:           { label: 'פגישה',       icon: Users },
  quote_preparation: { label: 'הצעת מחיר',  icon: FileText },
  close_order:       { label: 'סגירת הזמנה', icon: ShoppingCart },
  followup:          { label: 'מעקב',        icon: RefreshCw },
};
const FALLBACK_TYPE_META = { label: 'משימה', icon: ClipboardList };

// The strip itself is amber — "here is the thing to do" — and the bucket
// chip on the end carries the urgency colour. Straight from the mockup.
const BUCKET_CHIP = {
  task_overdue:  { label: 'באיחור', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  task_today:    { label: 'להיום',  cls: 'bg-amber-100 text-amber-800 ring-amber-300' },
  task_upcoming: { label: 'עתידי',  cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  task_undated:  { label: 'ללא יעד', cls: 'bg-muted text-muted-foreground ring-border' },
};

// Compact, human-readable "when?" string. Designed for one-glance reading at
// small font sizes — the rep should be able to triage without parsing dates.
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

/**
 * The lead's open tasks, one strip each.
 *
 * This used to be a titled card ("משימת מכירה קרובה" + "N משימות פתוחות
 * במוקד שלך" + bucket chips + rows), which spent four lines of chrome on
 * what is usually one task. Now each task IS the row: type, what it says,
 * when it's due, and the two things a rep does with it — open it, or close
 * it. Nothing else.
 */
export default function LeadWorkbenchQueue({ state, onAction }) {
  const queue = state?.nowQueue || [];
  const now = React.useMemo(() => new Date(), []);

  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">אין משימות פתוחות לליד הזה.</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px] gap-1 bg-card"
          onClick={() => onAction?.({ type: 'empty' }, 'new_task')}
        >
          <Plus className="h-3 w-3" />
          משימה חדשה
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {queue.map((item) => {
        const dueDate = parseWorkbenchDate(item.dueAt);
        const typeMeta = TYPE_META[item.entity?.task_type] || FALLBACK_TYPE_META;
        const chip = BUCKET_CHIP[item.type] || BUCKET_CHIP.task_undated;
        const TypeIcon = typeMeta.icon;
        const summary = (item.entity?.summary || '').trim();

        return (
          <div
            key={`${item.type}-${item.id}`}
            role="button"
            tabIndex={0}
            className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 cursor-pointer transition-colors hover:bg-amber-100/70"
            onClick={() => onAction?.(item, 'open_task')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAction?.(item, 'open_task');
              }
            }}
          >
            <span className="h-6 w-6 rounded-full bg-card flex items-center justify-center flex-shrink-0">
              <TypeIcon className="h-3.5 w-3.5 text-amber-700" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground truncate">
                {summary ? `${typeMeta.label} — ${summary}` : typeMeta.label}
              </p>
              <p className="text-[11px] text-amber-700 mt-px">
                {whenLabel(item, dueDate, now)}
              </p>
            </div>

            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 flex-shrink-0 ${chip.cls}`}>
              {chip.label}
            </span>

            {/* Close the task without opening it first. Same "מה קרה?" flow
                the tasks screen uses, so an outcome is still recorded. */}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px] flex-shrink-0 gap-1 bg-card"
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(item, 'complete_task');
              }}
            >
              <CheckCircle2 className="h-3 w-3" />
              סיים משימה
            </Button>
          </div>
        );
      })}
    </div>
  );
}
