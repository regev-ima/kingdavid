import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import StatusBadge from '@/components/shared/StatusBadge';
import ResponsiveLeadsTable from '@/components/lead/ResponsiveLeadsTable';
import RepeatEnquiryBadge from '@/components/lead/RepeatEnquiryBadge';
import QuickActions from '@/components/shared/QuickActions';
import UserAvatar from '@/components/shared/UserAvatar';
import CompleteTaskDialog from '@/components/sales/CompleteTaskDialog';
import { Phone, Users, FileText, ShoppingCart, MessageCircle, AlertCircle } from 'lucide-react';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { format } from '@/lib/safe-date-fns';
import { getLeadSlaAnchor, isLeadHandled } from '@/utils/leadStatus';
import { ALL_TASK_TYPE_LABELS, SLA_THRESHOLDS } from '@/constants/leadOptions';
import SourceBadge from '@/components/shared/SourceBadge';
import { formatIsraeliPhone as formatPhone } from '@/utils/phoneUtils';
import { isTaskDueNow } from '@/lib/salesTaskWorkbench';
import { useRepeatEnquiries } from '@/lib/repeatEnquiries';

// Lead table for the lead-management page. Desktop renders a DataTable (via
// ResponsiveLeadsTable); on a phone the same component swaps to stacked cards
// so reps don't fight a 1400px-wide horizontal scroll. The "משימה הבאה" column
// surfaces each lead's earliest open task with a one-click "סיים משימה".
export default function LeadListTable({
  leads,
  isLoading,
  isAdmin = false,
  selectedLeads = [],
  onSelectionChange,
  repNameByEmail = new Map(),
  users = [],
  onRowClick,
  highlightId,
  // 'full' keeps every column (Marketing still wants SLA / activity date).
  // 'tasks' is the manager's leads/tasks screen: the columns the approved
  // design shows, in its order, and nothing else.
  columnSet = 'full',
  // Multi-select is opt-in on the tasks screen — the design has no checkbox
  // column, so it appears only when the manager turns "בחירה מרובה" on.
  showSelection = true,
}) {
  const queryClient = useQueryClient();
  // Ticks every 30s so a lead whose task comes due rises to the top and gets
  // its tag without anyone reloading the page — same cadence as the sales
  // tasks screen, which this mirrors.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const handleClickToCall = async (phone) => {
    if (!phone) return;
    try { await base44.functions.invoke('clickToCall', { customerPhone: phone }); } catch {}
  };
  const allSelected = selectedLeads.length > 0 && selectedLeads.length === leads.length;
  const someSelected = selectedLeads.length > 0 && !allSelected;

  // Next-active-task per visible lead — drives the "משימה הבאה" column.
  // One batched fetch for the loaded rows, kept to the earliest open task
  // per lead.
  const leadIds = useMemo(() => leads.map((l) => l.id).filter(Boolean), [leads]);
  const { data: leadActiveTasks = [] } = useQuery({
    queryKey: ['leads-active-tasks', leadIds.join(',')],
    queryFn: () => leadIds.length === 0
      ? []
      : base44.entities.SalesTask.filter(
          { lead_id: { '$in': leadIds }, task_status: 'not_completed' },
          'due_date',
          leadIds.length * 5,
        ),
    enabled: leadIds.length > 0,
    staleTime: 30000,
  });
  const nextActiveTaskByLead = useMemo(() => {
    const map = new Map();
    for (const t of leadActiveTasks) {
      if (!t?.lead_id) continue;
      // Assignment ("שיוך") tasks are retired — nothing creates them any more,
      // and a leftover row is never anyone's "next task".
      if (t.task_type === 'assignment') continue;
      const existing = map.get(t.lead_id);
      if (!existing) { map.set(t.lead_id, t); continue; }
      const a = t.due_date ? new Date(t.due_date).getTime() : Infinity;
      const b = existing.due_date ? new Date(existing.due_date).getTime() : Infinity;
      if (a < b) map.set(t.lead_id, t);
    }
    return map;
  }, [leadActiveTasks]);
  const [completingTask, setCompletingTask] = useState(null);

  // "פנייה נוספת" — which of the visible leads are a repeat enquiry from
  // someone who already came in before. One batched query for the page.
  const repeatEnquiries = useRepeatEnquiries(leads);

  // Rep lookup for the נציג column, so its avatar gets the real user row
  // (photo included) rather than a name-and-email stub.
  const userByEmail = useMemo(
    () => new Map((users || []).filter((u) => u?.email).map((u) => [u.email, u])),
    [users],
  );

  // The list arrives sorted by activity date, which says nothing about what
  // needs doing. A lead whose next task is due right now (±60 min) belongs at
  // the top of the screen — that's the call the rep should be making. Stable
  // sort, so everything else keeps the incoming order; it re-runs on the `now`
  // tick, so the lead rises by itself when its time comes.
  //
  // Scoped to the loaded page, like the equivalent sort on the tasks screen.
  const orderedLeads = useMemo(() => {
    const dueNow = (lead) => isTaskDueNow(nextActiveTaskByLead.get(lead.id), now);
    return [...leads].sort((a, b) => (dueNow(a) ? 0 : 1) - (dueNow(b) ? 0 : 1));
  }, [leads, nextActiveTaskByLead, now]);

  const toggleAll = (checked) => {
    onSelectionChange?.(checked ? leads.map((l) => l.id) : []);
  };
  const toggleOne = (id, checked) => {
    onSelectionChange?.(checked
      ? [...selectedLeads, id]
      : selectedLeads.filter((x) => x !== id));
  };
  const isTasksView = columnSet === 'tasks';
  const columns = [
    ...(isAdmin && onSelectionChange && showSelection ? [{
      header: () => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(c) => toggleAll(!!c)}
          />
        </div>
      ),
      accessor: 'select',
      align: 'center',
      width: '52px',
      render: (row) => (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectedLeads.includes(row.id)}
            onCheckedChange={(c) => toggleOne(row.id, !!c)}
          />
        </div>
      ),
    }] : []),
    {
      header: isTasksView ? 'ליד' : 'לקוח',
      accessor: 'full_name',
      // Name + phone + the call button need about 190px; the old 260 left a
      // column of empty space and pushed the call button away from the name
      // it belongs to.
      width: isTasksView ? '190px' : '260px',
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium truncate" title={row.full_name || ''}>{row.full_name || '—'}</p>
              <RepeatEnquiryBadge entry={repeatEnquiries.get(row.id)} />
            </div>
            <p className="text-xs text-muted-foreground truncate" dir="ltr" title={row.phone || ''}>{formatPhone(row.phone)}</p>
          </div>
          {isTasksView && row.phone ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleClickToCall(row.phone); }}
              className="h-8 w-8 flex-none grid place-items-center rounded-full text-primary hover:bg-primary/10 transition-colors"
              title={`חיוג ל${row.full_name || ''}`}
              aria-label="חיוג"
            >
              <Phone className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ),
    },
    {
      header: 'סטטוס',
      width: '140px',
      render: (row) => row.status ? <StatusBadge status={row.status} /> : '—',
    },
    {
      header: 'שם מודעה',
      accessor: 'facebook_ad_name',
      width: '150px',
      render: (row) => {
        const adName = row.facebook_ad_name;
        if (!adName) return <span className="text-muted-foreground/40 text-sm">-</span>;
        return <span className="text-sm text-foreground/80 line-clamp-2 leading-snug" title={adName}>{adName}</span>;
      },
    },
    ...(isTasksView ? [] : [{
      header: 'SLA',
      accessor: 'sla_status',
      width: '128px',
      render: (row) => {
        if (isLeadHandled(row)) return <span className="text-xs text-muted-foreground/70">טופל</span>;
        const anchor = getLeadSlaAnchor(row);
        if (!anchor) return <span className="text-xs text-muted-foreground/70">-</span>;
        const now = new Date();
        const diffMinutes = Math.floor((now - anchor) / 1000 / 60);
        let color = 'text-green-600';
        if (diffMinutes > SLA_THRESHOLDS.AMBER_MAX_MINUTES) color = 'text-red-600';
        else if (diffMinutes > SLA_THRESHOLDS.GREEN_MAX_MINUTES) color = 'text-amber-600';
        let label;
        if (diffMinutes < 60) {
          label = diffMinutes === 1 ? 'דקה אחת' : `${diffMinutes} דקות`;
        } else if (diffMinutes < 1440) {
          const hours = Math.floor(diffMinutes / 60);
          const mins = diffMinutes % 60;
          const hoursText = hours === 1 ? 'שעה אחת' : `${hours} שעות`;
          label = mins === 0 ? hoursText : `${hoursText} ו-${mins === 1 ? 'דקה' : `${mins} דקות`}`;
        } else {
          const days = Math.floor(diffMinutes / 1440);
          const hours = Math.floor((diffMinutes % 1440) / 60);
          const daysText = days === 1 ? 'יום אחד' : `${days} ימים`;
          label = hours === 0 ? daysText : `${daysText} ו-${hours === 1 ? 'שעה' : `${hours} שעות`}`;
        }
        return <span className={`block text-sm font-medium whitespace-nowrap truncate ${color}`} title={label}>{label}</span>;
      },
    }]),
    {
      header: isTasksView ? 'מקור הגעה' : 'מקור',
      width: '120px',
      render: (row) => (
        <SourceBadge source={row.source} />
      ),
    },
    {
      header: isTasksView ? 'נציג' : 'נציג מטפל',
      accessor: 'rep1',
      width: isTasksView ? '150px' : '160px',
      render: (row) => {
        // Three states, not two. A lead offered to a rep who hasn't picked it up
        // yet still has no owner — rep1 is empty, so it counts as unassigned
        // everywhere else on this screen — and reads as "ממתין" rather than as
        // that rep's lead. Same distinction the mobile card draws.
        if (!row.rep1) {
          const pending = row.pending_rep_email;
          if (!pending) return <span className="text-xs font-medium text-amber-700">לא משויך</span>;
          const pendingName = repNameByEmail.get(pending) || pending;
          return (
            <span className="flex items-center gap-1 text-xs text-amber-700 min-w-0" title={`ממתין לשיוך: ${pendingName}`}>
              <AlertCircle className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">ממתין: {pendingName}</span>
            </span>
          );
        }
        const name = repNameByEmail.get(row.rep1) || row.rep1;
        // The rep's own colour + icon, unique to them across the team, so a
        // manager scanning the column recognises the owner before reading the
        // name. Falls back to a synthetic user when the caller didn't pass a
        // roster — the identity is keyed on the email either way.
        const rep = userByEmail.get(row.rep1) || { email: row.rep1, full_name: name };
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            <UserAvatar user={rep} size="xs" />
            <span className="text-sm truncate" title={name}>{name}</span>
          </div>
        );
      },
    },
    {
      header: 'משימה הבאה',
      accessor: 'next_active_task',
      width: '230px',
      render: (row) => {
        const task = nextActiveTaskByLead.get(row.id);
        if (!task) {
          return <span className="text-xs text-muted-foreground/70">—</span>;
        }
        const TYPE_META = {
          call: { Icon: Phone, label: 'שיחה', color: 'text-blue-600' },
          meeting: { Icon: Users, label: 'פגישה', color: 'text-amber-600' },
          quote_preparation: { Icon: FileText, label: 'הצעת מחיר', color: 'text-primary' },
          close_order: { Icon: ShoppingCart, label: 'סגירת הזמנה', color: 'text-emerald-600' },
          whatsapp: { Icon: MessageCircle, label: 'וואטסאפ', color: 'text-green-600' },
        };
        const meta = TYPE_META[task.task_type] || { Icon: Phone, label: ALL_TASK_TYPE_LABELS[task.task_type] || task.task_type, color: 'text-muted-foreground' };
        const due = task.due_date ? new Date(task.due_date) : null;
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart.getTime() + 86400000);
        const overdueDays = due && due.getTime() < todayStart.getTime()
          ? Math.floor((todayStart.getTime() - due.getTime()) / 86400000)
          : 0;
        const isToday = due && due.getTime() >= todayStart.getTime() && due.getTime() < todayEnd.getTime();
        let timeLabel = '—';
        if (due) {
          if (overdueDays > 0) timeLabel = `בפיגור ${overdueDays} ימים`;
          else if (isToday) timeLabel = `היום ${formatInTimeZone(due, 'Asia/Jerusalem', 'HH:mm')}`;
          else timeLabel = formatInTimeZone(due, 'Asia/Jerusalem', 'dd/MM HH:mm');
        }
        const handleQuickComplete = (e) => {
          e.stopPropagation();
          setCompletingTask({ ...task, rep1: task.rep1 || row.rep1, rep2: task.rep2 || row.rep2 });
        };
        // The design stacks the task over its time — "שיחת היכרות" then
        // "היום | 10:00" — and closing a task moves to the row menu, so the
        // column stays two clean lines instead of a line plus a button.
        if (isTasksView) {
          const dayLabel = due
            ? (overdueDays > 0
              ? `בפיגור ${overdueDays} ימים`
              : isToday ? 'היום' : formatInTimeZone(due, 'Asia/Jerusalem', 'dd/MM'))
            : '';
          return (
            <div className="flex flex-col justify-center gap-1 min-w-0 min-h-[44px] text-center">
              <div className="flex items-center justify-center gap-1.5 text-sm min-w-0">
                <span className="font-semibold truncate">{task.summary?.split('\n')[0] || meta.label}</span>
                <meta.Icon className={`h-3.5 w-3.5 flex-shrink-0 ${meta.color}`} />
              </div>
              {due ? (
                <div className="flex items-center justify-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                  <span>{formatInTimeZone(due, 'Asia/Jerusalem', 'HH:mm')}</span>
                  <span className="text-border" aria-hidden="true">|</span>
                  <span className={overdueDays > 0 ? 'text-red-600 font-medium' : ''}>{dayLabel}</span>
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col justify-center gap-1 min-w-0 min-h-[44px]">
            <div className="flex items-center gap-1.5 text-sm min-w-0 flex-wrap">
              <meta.Icon className={`h-3.5 w-3.5 flex-shrink-0 ${meta.color}`} />
              <span className="font-medium flex-shrink-0">{meta.label}</span>
              <span className={`text-xs font-medium whitespace-nowrap truncate ${
                overdueDays > 0 ? 'text-red-600' : isToday ? 'text-amber-600' : 'text-muted-foreground'
              }`}>
                {timeLabel}
              </span>
            </div>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] w-fit" onClick={handleQuickComplete}>
              סיים משימה
            </Button>
          </div>
        );
      },
    },
    {
      header: isTasksView ? 'תאריך יצירה' : 'תאריך פעילות',
      // Wider than the date alone needs: the time sits beside it, and a column
      // that wraps "14:32" onto its own line reads as a second date.
      width: '140px',
      render: (row) => {
        try {
          const d = isTasksView ? row.created_date : (row.effective_sort_date || row.created_date);
          if (!d) return '—';
          const at = new Date(d);
          return (
            <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-xs text-muted-foreground">{format(at, 'dd/MM/yyyy')}</span>
              {/* Smaller and lighter: the hour answers "when in the day", which
                  is a follow-up question to the date, not competition for it. */}
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">{format(at, 'HH:mm')}</span>
            </span>
          );
        } catch { return '—'; }
      },
    },
    {
      header: 'פעולות',
      align: 'center',
      width: '72px',
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
          <QuickActions
            type="lead"
            data={row}
            hideContactButtons={true}
            onView={() => onRowClick(row)}
          />
        </div>
      ),
    },
  ];
  // The design reads ליד → סטטוס → מקור הגעה → שם מודעה; the historical order
  // put the ad before the source. Swapping here keeps both views honest
  // instead of forking the column list.
  const orderedColumns = (() => {
    if (!isTasksView) return columns;
    const indexOf = (header) => columns.findIndex((column) => column.header === header);
    const source = indexOf('מקור הגעה');
    const ad = indexOf('שם מודעה');
    if (source === -1 || ad === -1) return columns;
    const next = [...columns];
    [next[ad], next[source]] = [next[source], next[ad]];
    return next;
  })();

  return (
    <>
    {/* Desktop table + mobile cards — same responsive component the Leads
        page used, so reps on a phone get the card view instead of a
        1400px-wide horizontal scroll. */}
    <ResponsiveLeadsTable
      columns={orderedColumns}
      data={orderedLeads}
      isLoading={isLoading}
      selectedIds={selectedLeads}
      users={users}
      onToggleSelect={(row, checked) => toggleOne(row.id, checked)}
      onOpenLead={(row) => onRowClick(row)}
      highlightId={highlightId}
      repeatEnquiries={repeatEnquiries}
      onClickToCall={(phone) => handleClickToCall(phone)}
      rowClassName={(row) => (
        isTaskDueNow(nextActiveTaskByLead.get(row.id), now) ? 'bg-amber-50 hover:bg-amber-100/70' : ''
      )}
      cardClassName={(row) => (
        isTaskDueNow(nextActiveTaskByLead.get(row.id), now) ? 'bg-amber-50' : ''
      )}
    />
    {/* Complete-task dialog opened by the "סיים משימה" button in the
        "משימה הבאה" column */}
    <CompleteTaskDialog
      isOpen={!!completingTask}
      task={completingTask}
      onClose={() => setCompletingTask(null)}
      onCompleted={() => queryClient.invalidateQueries({ queryKey: ['leads-active-tasks'] })}
    />
    </>
  );
}
