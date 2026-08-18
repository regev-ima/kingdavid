import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StatusBadge from '@/components/shared/StatusBadge';
import SourceBadge from '@/components/shared/SourceBadge';
import { format } from '@/lib/safe-date-fns';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { createPageUrl } from '@/utils';
import { formatIsraeliPhone } from '@/utils/phoneUtils';
import { getRepDisplayName } from '@/lib/repDisplay';
import { ALL_TASK_TYPE_LABELS, LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { isAdmin as isAdminUser } from '@/lib/userScope';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, ArrowLeft, Check, ClipboardCheck, Loader2, Phone, Trash2, X } from 'lucide-react';

// One column per fact that TELLS THE RECORDS APART. The person's name and
// phone are the same on every row by definition — they are what ties the rows
// together — so they sit in the header once instead of down a column each.
const COLUMNS = [
  { key: 'select',   label: '',            width: 'w-10' },
  { key: 'created',  label: 'שעת כניסה',   width: 'min-w-[130px]' },
  { key: 'source',   label: 'מקור הגעה',   width: 'min-w-[130px]' },
  { key: 'landing',  label: 'דף נחיתה',    width: 'min-w-[150px]' },
  { key: 'campaign', label: 'שם קמפיין',   width: 'min-w-[150px]' },
  { key: 'task',     label: 'משימה פתוחה', width: 'min-w-[150px]' },
  { key: 'rep',      label: 'נציג אחראי',  width: 'min-w-[120px]' },
  { key: 'status',   label: 'סטטוס',       width: 'min-w-[110px]' },
  { key: 'open',     label: '',            width: 'w-[76px]' },
];

const Cell = ({ value, className = '' }) => {
  const text = value == null || String(value).trim() === '' ? '' : String(value);
  return text ? (
    <span className={`block truncate ${className}`} title={text}>{text}</span>
  ) : (
    <span className="text-muted-foreground/50">—</span>
  );
};

/**
 * Every lead record of one person, in a table — what the "ליד כפול" badge
 * opens.
 *
 * A repeat enquiry deliberately becomes its own lead row (the daily count has
 * to match what Facebook and Google report), and the rows are tied together by
 * `contact_id`. Clicking the warning used to do what clicking anywhere else on
 * the row does — open that one lead — which answered the question the warning
 * raises ("which OTHER records exist?") with the record the rep was already
 * looking at.
 *
 * The columns are only what differs between the records: when it came in, off
 * which campaign and landing page, who owns it, where it stands, and whether
 * someone already has an open task on it — the last one being the thing that
 * decides whether to call at all, since a colleague may be mid-conversation
 * with this person on another record.
 *
 * The row the rep came from is marked and not linked — it is the page they are
 * on. Every other row opens that lead.
 */
export default function DuplicateLeadsDialog({ open, onOpenChange, contactId, currentLeadId, name, phone }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // The hook hands back `effectiveUser` (impersonation included), not `data` —
  // reading `data` made every user look like a rep, which is why the menu had
  // only one item.
  const { effectiveUser } = useEffectiveCurrentUser(!!open);
  const isManager = isAdminUser(effectiveUser);

  // Which records the rep ticked, and what they want done with them.
  const [selectedIds, setSelectedIds] = useState([]);
  const [action, setAction] = useState('status');
  const [actionValue, setActionValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A fresh open is a fresh decision — never inherit a selection or a
  // half-picked action from the last time this dialog was up.
  useEffect(() => {
    if (open) return;
    setSelectedIds([]);
    setAction('status');
    setActionValue('');
    setConfirmDelete(false);
  }, [open]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['lead-duplicate-records', contactId],
    enabled: !!open && !!contactId,
    staleTime: 60_000,
    queryFn: async () => {
      const list = await base44.entities.Lead.filter({ contact_id: contactId });
      if (!Array.isArray(list)) return [];
      return list.slice().sort((a, b) => {
        // Newest first, matching the leads list and the enquiries card, so the
        // rep reads the three screens in one order.
        const da = parseDbTimestamp(a?.effective_sort_date || a?.created_date);
        const db = parseDbTimestamp(b?.effective_sort_date || b?.created_date);
        return (db?.getTime() || 0) - (da?.getTime() || 0);
      });
    },
  });

  // Shares the ['users'] key the rest of the app already loads, so rep1 turns
  // from an email into a name without a request of its own.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !!open,
  });

  // Same shape the lead screen uses for its rep pickers: the people a lead can
  // actually be assigned to.
  const salesReps = useMemo(
    () => (users || []).filter((u) => u?.email && (u.role === 'user' || u.role === 'admin')),
    [users],
  );

  const leadIds = useMemo(() => rows.map((r) => r?.id).filter(Boolean), [rows]);

  // Open tasks across all of the person's records, in one batched query — the
  // same shape the leads table uses for its "משימה הבאה" column.
  const { data: openTasks = [] } = useQuery({
    queryKey: ['duplicate-lead-tasks', leadIds.join(',')],
    enabled: !!open && leadIds.length > 0,
    staleTime: 30_000,
    queryFn: () => base44.entities.SalesTask.filter(
      { lead_id: { $in: leadIds }, task_status: 'not_completed' },
      'due_date',
      leadIds.length * 5,
    ),
  });

  const nextTaskByLead = useMemo(() => {
    const map = new Map();
    for (const task of openTasks || []) {
      if (!task?.lead_id) continue;
      // Assignment tasks are retired — a leftover row is nobody's next task.
      if (task.task_type === 'assignment') continue;
      const existing = map.get(task.lead_id);
      if (!existing) { map.set(task.lead_id, task); continue; }
      const a = task.due_date ? new Date(task.due_date).getTime() : Infinity;
      const b = existing.due_date ? new Date(existing.due_date).getTime() : Infinity;
      if (a < b) map.set(task.lead_id, task);
    }
    return map;
  }, [openTasks]);

  const toggleOne = (id, checked) => {
    setSelectedIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };
  const allSelected = leadIds.length > 0 && selectedIds.length === leadIds.length;

  // Status and rep assignment are ordinary field updates the app already
  // performs one lead at a time; doing them here saves opening each duplicate
  // to repeat the same edit. Deletion is the one that removes rows, so it is
  // managers only and it asks first.
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (action === 'delete') {
        await Promise.all(selectedIds.map((id) => base44.entities.Lead.delete(id)));
        return;
      }
      const fields = action === 'rep1' ? { rep1: actionValue } : { status: actionValue };
      await Promise.all(selectedIds.map((id) => base44.entities.Lead.update(id, fields)));
    },
    onSuccess: () => {
      const count = selectedIds.length;
      if (action === 'delete') {
        toast({ title: 'הפניות נמחקו', description: `${count} פניות הוסרו מהמערכת` });
      } else {
        const label = action === 'rep1'
          ? getRepDisplayName(actionValue, users)
          : (LEAD_STATUS_OPTIONS.find((o) => o.value === actionValue)?.label || actionValue);
        toast({
          title: action === 'rep1' ? 'הפניות שויכו' : 'הסטטוס עודכן',
          description: `${count} פניות · ${label}`,
        });
      }
      setConfirmDelete(false);
      setSelectedIds([]);
      setActionValue('');
      queryClient.invalidateQueries({ queryKey: ['lead-duplicate-records', contactId] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast({
        title: action === 'delete' ? 'המחיקה נכשלה' : 'העדכון נכשל',
        description: err?.message || 'שגיאה לא צפויה',
        variant: 'destructive',
      });
    },
  });

  const actionOptions = action === 'rep1'
    ? salesReps.map((rep) => ({ value: rep.email, label: rep.full_name || rep.email }))
    : LEAD_STATUS_OPTIONS;
  // Deleting takes no second value — the rows themselves are the argument.
  const needsValue = action !== 'delete';
  const canApply = selectedIds.length > 0 && (needsValue ? !!actionValue : true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The badge lives inside a clickable lead row, and a portal still
          bubbles clicks up the React tree — without stopPropagation, closing
          the dialog navigates into the lead behind it. */}
      <DialogContent
        dir="rtl"
        className="max-w-[min(1100px,95vw)] p-0 gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-5 py-4 pe-14 border-b border-border text-start space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">פניות כפולות{name ? ` — ${name}` : ''}</span>
            {rows.length > 0 ? (
              <span className="inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] h-5 text-[11px] font-bold bg-amber-100 text-amber-700">
                {rows.length}
              </span>
            ) : null}
          </DialogTitle>
          {phone ? (
            <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Phone className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="tabular-nums" dir="ltr">{formatIsraeliPhone(phone)}</span>
            </span>
          ) : null}
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען פניות…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            לא נמצאו פניות נוספות מאותו לקוח.
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.width} text-start font-medium text-[11px] text-muted-foreground whitespace-nowrap px-3 py-2 border-b border-border`}
                    >
                      {col.key === 'select' ? (
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(c) => setSelectedIds(c ? leadIds : [])}
                          aria-label="בחר את כל הפניות"
                        />
                      ) : col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const when = parseDbTimestamp(row.effective_sort_date || row.created_date);
                  const isCurrent = row.id === currentLeadId;
                  // The same person can be written down twice under two
                  // spellings ("דורון בן אבי" / "Doron Ben-Avi"). The name is
                  // in the header, so it earns a line here only when this
                  // record disagrees with it.
                  const ownName = String(row.full_name || '').trim();
                  const differentName = ownName && ownName !== String(name || '').trim() ? ownName : '';
                  const task = nextTaskByLead.get(row.id);
                  const taskDue = task?.due_date ? parseDbTimestamp(task.due_date) : null;
                  const overdue = taskDue ? taskDue.getTime() < Date.now() : false;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-border/50 last:border-b-0 ${isCurrent ? 'bg-amber-50/70' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-3 py-2 align-top">
                        <Checkbox
                          checked={selectedIds.includes(row.id)}
                          onCheckedChange={(c) => toggleOne(row.id, !!c)}
                          aria-label="בחר פנייה"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="whitespace-nowrap tabular-nums text-xs">
                            {when ? format(when, 'dd/MM/yyyy HH:mm') : '—'}
                          </span>
                          {isCurrent ? (
                            <span className="flex-none rounded-md bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 whitespace-nowrap">
                              הפנייה הנוכחית
                            </span>
                          ) : null}
                        </div>
                        {differentName ? (
                          <span className="block text-[10px] text-muted-foreground/70 truncate" title={differentName}>
                            נרשם כ־{differentName}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <SourceBadge source={row.source} />
                      </td>
                      <td className="px-3 py-2 align-top max-w-[220px] text-xs">
                        {row.landing_page ? (
                          <a
                            href={row.landing_page}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-primary hover:underline"
                            title={row.landing_page}
                          >
                            {row.landing_page}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top max-w-[220px] text-xs">
                        <Cell value={row.utm_campaign || row.facebook_campaign_name} />
                      </td>
                      <td className="px-3 py-2 align-top max-w-[200px] text-xs">
                        {task ? (
                          <span className="flex items-center gap-1.5 min-w-0" title={String(task.summary || '').trim() || undefined}>
                            <ClipboardCheck className={`h-3.5 w-3.5 flex-none ${overdue ? 'text-rose-600' : 'text-primary'}`} />
                            <span className="min-w-0 truncate">
                              {String(task.summary || '').split('\n')[0]
                                || ALL_TASK_TYPE_LABELS[task.task_type]
                                || 'משימה פתוחה'}
                            </span>
                            {taskDue ? (
                              <span className={`flex-none tabular-nums text-[11px] ${overdue ? 'text-rose-600 font-medium' : 'text-muted-foreground'}`}>
                                {format(taskDue, 'dd/MM')}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top max-w-[180px] text-xs">
                        <Cell value={getRepDisplayName(row.rep1, users)} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <StatusBadge status={row.status} className="whitespace-nowrap" />
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {isCurrent ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <Link
                            to={`${createPageUrl('LeadDetails')}?id=${row.id}`}
                            onClick={() => onOpenChange(false)}
                            className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 whitespace-nowrap"
                          >
                            פתח
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* What to do with the records once you can see them all. Both actions
            are the ones the app already has for a lead — its status and who
            owns it — applied to everything ticked instead of one lead at a
            time. Nothing here deletes or merges anything. */}
        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                {selectedIds.length}
              </span>
              נבחרו
            </span>

            {/* A rep can move these records along; only a manager can hand them
                to someone else or remove them. */}
            <Select
              value={action}
              onValueChange={(v) => { setAction(v); setActionValue(''); }}
            >
              <SelectTrigger className="h-9 w-40 bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="status">שינוי סטטוס</SelectItem>
                {isManager ? <SelectItem value="rep1">הקצאה לנציג</SelectItem> : null}
                {isManager ? <SelectItem value="delete">מחיקת פניות</SelectItem> : null}
              </SelectContent>
            </Select>

            {needsValue ? (
              <Select value={actionValue} onValueChange={setActionValue}>
                <SelectTrigger className="h-9 w-56 bg-card">
                  <SelectValue placeholder={action === 'rep1' ? 'בחר נציג…' : 'בחר סטטוס…'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {actionOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <Button
              size="sm"
              variant={action === 'delete' ? 'destructive' : 'default'}
              className="h-9 gap-1.5"
              disabled={!canApply || applyMutation.isPending}
              onClick={() => (action === 'delete' ? setConfirmDelete(true) : applyMutation.mutate())}
            >
              {applyMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : action === 'delete'
                  ? <Trash2 className="h-3.5 w-3.5" />
                  : <Check className="h-3.5 w-3.5" />}
              {action === 'delete' ? `מחק ${selectedIds.length}` : 'החל'}
            </Button>

            <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={() => setSelectedIds([])}>
              <X className="h-3.5 w-3.5" />
              בטל בחירה
            </Button>
          </div>
        ) : null}
      </DialogContent>

      {/* Deleting a lead takes its calls, tasks and history with it and cannot
          be undone, so it is stated plainly and asked once. */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק {selectedIds.length} פניות?</AlertDialogTitle>
            <AlertDialogDescription>
              הפניות יימחקו לצמיתות, יחד עם המשימות והפעילות שרשומות עליהן. לא ניתן לשחזר.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyMutation.isPending}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={applyMutation.isPending}
              onClick={(e) => { e.preventDefault(); applyMutation.mutate(); }}
            >
              {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : null}
              מחק לצמיתות
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
