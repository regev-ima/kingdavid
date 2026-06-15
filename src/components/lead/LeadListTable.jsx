import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import StatusBadge from '@/components/shared/StatusBadge';
import ResponsiveLeadsTable from '@/components/lead/ResponsiveLeadsTable';
import QuickActions from '@/components/shared/QuickActions';
import CompleteTaskDialog from '@/components/sales/CompleteTaskDialog';
import { Phone, Users, FileText, ShoppingCart, MessageCircle, UserPlus } from 'lucide-react';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { format } from '@/lib/safe-date-fns';
import { getLeadSlaAnchor, isLeadHandled } from '@/utils/leadStatus';
import { ALL_TASK_TYPE_LABELS, SOURCE_LABELS, SLA_THRESHOLDS } from '@/constants/leadOptions';

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
}) {
  const queryClient = useQueryClient();
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
      const existing = map.get(t.lead_id);
      if (!existing) { map.set(t.lead_id, t); continue; }
      const a = t.due_date ? new Date(t.due_date).getTime() : Infinity;
      const b = existing.due_date ? new Date(existing.due_date).getTime() : Infinity;
      if (a < b) map.set(t.lead_id, t);
    }
    return map;
  }, [leadActiveTasks]);
  const [completingTask, setCompletingTask] = useState(null);

  const toggleAll = (checked) => {
    onSelectionChange?.(checked ? leads.map((l) => l.id) : []);
  };
  const toggleOne = (id, checked) => {
    onSelectionChange?.(checked
      ? [...selectedLeads, id]
      : selectedLeads.filter((x) => x !== id));
  };
  const formatPhone = (p) => {
    if (!p) return '';
    const cleaned = p.replace(/\D/g, '');
    return cleaned.length === 10 ? `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}` : p;
  };
  const columns = [
    ...(isAdmin && onSelectionChange ? [{
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
      header: 'לקוח',
      accessor: 'full_name',
      width: '260px',
      render: (row) => (
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" title={row.full_name || ''}>{row.full_name || '—'}</p>
          <p className="text-xs text-muted-foreground truncate" dir="ltr" title={row.phone || ''}>{formatPhone(row.phone)}</p>
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
    {
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
    },
    {
      header: 'מקור',
      width: '120px',
      render: (row) => (
        <p className="text-xs text-muted-foreground truncate" title={row.source ? (SOURCE_LABELS[row.source] || row.source) : ''}>
          {row.source ? (SOURCE_LABELS[row.source] || row.source) : '—'}
        </p>
      ),
    },
    {
      header: 'נציג מטפל',
      width: '160px',
      render: (row) => {
        if (!row.rep1) return <span className="text-xs text-amber-700">לא משויך</span>;
        const name = repNameByEmail.get(row.rep1) || row.rep1;
        return <p className="text-sm truncate" title={name}>{name}</p>;
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
          assignment: { Icon: UserPlus, label: 'שיוך', color: 'text-violet-600' },
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
        return (
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col justify-center gap-1 min-w-0 min-h-[44px]">
            <div className="flex items-center gap-1.5 text-sm min-w-0">
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
      header: 'תאריך פעילות',
      width: '120px',
      render: (row) => {
        try {
          const d = row.effective_sort_date || row.created_date;
          return d ? <span className="text-xs text-muted-foreground">{format(new Date(d), 'dd/MM/yyyy')}</span> : '—';
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
  return (
    <>
    {/* Desktop table + mobile cards — same responsive component the Leads
        page used, so reps on a phone get the card view instead of a
        1400px-wide horizontal scroll. */}
    <ResponsiveLeadsTable
      columns={columns}
      data={leads}
      isLoading={isLoading}
      selectedIds={selectedLeads}
      users={users}
      onToggleSelect={(row, checked) => toggleOne(row.id, checked)}
      onOpenLead={(row) => onRowClick(row)}
      highlightId={highlightId}
      onClickToCall={(phone) => handleClickToCall(phone)}
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
