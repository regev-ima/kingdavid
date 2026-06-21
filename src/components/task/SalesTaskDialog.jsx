import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Phone, FileText, Users, ShoppingCart, Plus, Clock, Tag, Megaphone, UserPlus, Download, ExternalLink, Search, UserCheck, X } from "lucide-react";
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import { cancelOpenTasksForClosedDeal } from '@/lib/dealClose';
import { format, isValid, addHours, addDays, startOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { TASK_TYPE_OPTIONS, TASK_STATUS_OPTIONS, SOURCE_LABELS } from '@/constants/leadOptions';
import { useHiddenStatuses, getVisibleStatusOptions } from '@/hooks/useHiddenStatuses';
import { useClosureChecker } from '@/hooks/useCompanyClosures';
import { parseTimeToMinutes } from '@/lib/companyClosures';
import SLABadge from '@/components/sla/SLABadge';
import StatusOptionRow from '@/components/shared/StatusOptionRow';
import NewQuote from '@/pages/NewQuote';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import { isAdmin as isAdminUser, canAccessSalesWorkspace } from '@/components/shared/rbac';

// Strip everything but digits, then drop a leading country prefix so any
// stored form ("0537772829", "053-777-2829", "+972537772829") matches.
function normalizePhoneForLeadLookup(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

const TASK_STATUS_STYLES = {
  not_completed: { on: 'border-amber-400/50 bg-amber-50 text-amber-700', off: 'border-border hover:border-amber-300 hover:bg-amber-50/50 text-muted-foreground' },
  completed: { on: 'border-emerald-400/50 bg-emerald-50 text-emerald-700', off: 'border-border hover:border-emerald-300 hover:bg-emerald-50/50 text-muted-foreground' },
  not_done: { on: 'border-red-400/50 bg-red-50 text-red-700', off: 'border-border hover:border-red-300 hover:bg-red-50/50 text-muted-foreground' },
  cancelled: { on: 'border-border bg-muted text-foreground', off: 'border-border hover:border-border/80 hover:bg-muted/50 text-muted-foreground' },
};

// Touches every react-query cache key the SalesTasks page (and lead/leads
// surfaces) relies on. The flows here used to invalidate `['salesTasks']`,
// which never matched the parent's `['salesTasks-counts', ...]` and
// `['salesTasks-tab', ...]` keys — so the dialog appeared to "do nothing"
// even after a successful write.
const invalidateTaskCaches = (queryClient) => {
  queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
  queryClient.invalidateQueries({ queryKey: ['salesTasks-counts'] });
  queryClient.invalidateQueries({ queryKey: ['salesTasks-tab'] });
  queryClient.invalidateQueries({ queryKey: ['leads-for-paginated-tasks'] });
  queryClient.invalidateQueries({ queryKey: ['taskCounters'] });
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
  queryClient.invalidateQueries({ queryKey: ['leadActivityLogs'] });
  queryClient.invalidateQueries({ queryKey: ['lead'] });
  queryClient.invalidateQueries({ queryKey: ['leads'] });
};

const safeFormat = (dateStr, fmt) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isValid(d) ? format(d, fmt) : dateStr;
};

const NO_ANSWER_STATUSES = {
  no_answer_1: 'ללא מענה 1',
  no_answer_2: 'ללא מענה 2',
  no_answer_3: 'ללא מענה 3',
  no_answer_4: 'ללא מענה 4',
};

const blankTask = (preSelectedLead, repEmail) => ({
  task_type: 'call',
  task_status: 'not_completed',
  status: preSelectedLead?.status || '',
  lead_id: preSelectedLead?.id || '',
  lead: preSelectedLead || null,
  rep1: preSelectedLead?.rep1 || repEmail || '',
  rep2: '',
  due_date: '',
  work_start_date: '',
  summary: '',
});

/**
 * The single source of truth for the sales-task screen. Used for BOTH creating
 * a new task (`task` omitted) and editing/viewing an existing one (`task`
 * provided). Whatever changes in the task body — the smart lead-status flows,
 * task type, scheduling, quote shortcut — changes everywhere the dialog is
 * mounted (SalesTasks, LeadDetails, SalesDashboard), because there is now one
 * component instead of two that drifted apart.
 *
 * Create vs. edit differences are intentionally small:
 *  - create shows a lead search (when opened without `preSelectedLead`) and a
 *    "צור משימה" footer; no delete / no timestamps (nothing to delete yet).
 *  - edit keeps the 3 tabs (task / lead / rep), delete, and the created/updated
 *    metadata.
 */
export default function SalesTaskDialog({ isOpen, onClose, task = null, preSelectedLead = null, effectiveUser: effectiveUserProp }) {
  const isCreate = !task;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { openLead } = useLeadModal();
  const { hiddenStatuses } = useHiddenStatuses();
  const { evaluate: evaluateClosure } = useClosureChecker();
  const { effectiveUser: effectiveUserFromHook } = useEffectiveCurrentUser(isOpen);
  const effectiveUser = effectiveUserProp || effectiveUserFromHook;
  const isAdmin = isAdminUser(effectiveUser);
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  const [editingTask, setEditingTask] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCompletedFlow, setShowCompletedFlow] = useState(false);
  const [showNextTaskForm, setShowNextTaskForm] = useState(false);
  const [nextTask, setNextTask] = useState({ task_type: 'call', due_date: '', due_hours: null });
  const [originalLeadStatus, setOriginalLeadStatus] = useState('');
  const [noAnswerFlow, setNoAnswerFlow] = useState(null); // { status, label, selectedHours }
  const [followupFlow, setFollowupFlow] = useState(null); // { selectedDate, selectedHour, status }
  const [isSavingFollowup, setIsSavingFollowup] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);

  // Lead picker (create mode only). Search by phone or name against the entire
  // DB so it scales past a few hundred leads. Once a lead is chosen it lives on
  // editingTask.lead / lead_id, so the rest of the form is mode-agnostic.
  const [leadSearch, setLeadSearch] = useState('');
  const [debouncedLeadSearch, setDebouncedLeadSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLeadSearch(leadSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [leadSearch]);

  const phoneTail = useMemo(() => {
    const norm = normalizePhoneForLeadLookup(debouncedLeadSearch);
    return norm.length >= 4 ? norm.slice(-9) : '';
  }, [debouncedLeadSearch]);

  const currentLeadId = editingTask?.lead_id || '';
  const currentLead = editingTask?.lead || null;

  const lookupEnabled = isCreate && isOpen && canAccessSales && !currentLeadId && debouncedLeadSearch.length >= 2;
  const { data: leadMatches = [] } = useQuery({
    queryKey: ['leads-for-task-lookup', debouncedLeadSearch],
    enabled: lookupEnabled,
    staleTime: 60_000,
    queryFn: () => base44.entities.Lead.filter(
      {
        $or: [
          { full_name: { $regex: debouncedLeadSearch, $options: 'i' } },
          { phone:     { $regex: phoneTail || debouncedLeadSearch, $options: 'i' } },
          { email:     { $regex: debouncedLeadSearch, $options: 'i' } },
        ],
      },
      '-created_date',
      8,
    ),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: isOpen && (isAdmin || task?.task_type === 'assignment'),
  });

  const leadIdForQuotes = editingTask?.lead_id || task?.lead_id || '';
  const { data: leadQuotes = [] } = useQuery({
    queryKey: ['quotes', leadIdForQuotes],
    queryFn: () => base44.entities.Quote.filter({ lead_id: leadIdForQuotes }),
    enabled: isOpen && !!leadIdForQuotes,
  });

  // (Re)initialize when the dialog opens, or when a different task is opened.
  // Keyed on isOpen + task?.id (undefined in create) so a parent re-render that
  // swaps the preSelectedLead reference mid-edit doesn't wipe the form.
  useEffect(() => {
    if (!isOpen) return;
    if (task) {
      const leadStatus = task.lead?.status || task.status || '';
      setEditingTask({ ...task, status: leadStatus });
      setOriginalLeadStatus(leadStatus);
    } else {
      const repEmail = !isAdmin ? (effectiveUser?.email || '') : '';
      setEditingTask(blankTask(preSelectedLead, repEmail));
      setOriginalLeadStatus(preSelectedLead?.status || '');
    }
    setValidationError('');
    setShowDeleteConfirm(false);
    setShowCompletedFlow(false);
    setShowNextTaskForm(false);
    setNextTask({ task_type: 'call', due_date: '', due_hours: null });
    setNoAnswerFlow(null);
    setFollowupFlow(null);
    setIsAssigning(false);
    setShowQuoteDialog(false);
    setLeadSearch('');
    setDebouncedLeadSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, task?.id]);

  // Non-admin reps create tasks assigned to themselves.
  useEffect(() => {
    if (isCreate && isOpen && effectiveUser && !isAdmin && editingTask && !editingTask.rep1) {
      setEditingTask(prev => ({ ...prev, rep1: effectiveUser.email }));
    }
  }, [isCreate, isOpen, effectiveUser, isAdmin, editingTask]);

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SalesTask.update(id, data),
    onSuccess: () => {
      invalidateTaskCaches(queryClient);
      toast.success('המשימה נשמרה');
      onClose();
    },
    onError: (err) => {
      console.error('SalesTask update failed', err);
      toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async ({ taskData, leadId, newStatus, originalStatus }) => {
      if (leadId && newStatus && newStatus !== originalStatus) {
        await base44.entities.Lead.update(leadId, { status: newStatus });
      }
      return base44.entities.SalesTask.create(taskData);
    },
    onSuccess: () => {
      invalidateTaskCaches(queryClient);
      toast.success('המשימה נוצרה');
      onClose();
    },
    onError: (err) => {
      console.error('SalesTask create failed', err);
      toast.error(`יצירה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id) => base44.entities.SalesTask.delete(id),
    onSuccess: () => {
      invalidateTaskCaches(queryClient);
      onClose();
    },
    onError: (err) => {
      toast.error(`מחיקה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    },
  });

  const handleCreateTask = () => {
    if (!editingTask) return;
    if (!currentLeadId) { setValidationError('יש לבחור ליד'); return; }
    if (!editingTask.task_type) { setValidationError('יש לבחור סוג משימה'); return; }
    if (!editingTask.rep1) { setValidationError('יש לבחור נציג ראשי'); return; }
    setValidationError('');
    const now = new Date().toISOString();
    createTaskMutation.mutate({
      taskData: {
        lead_id: currentLeadId,
        task_type: editingTask.task_type,
        summary: editingTask.summary || '',
        rep1: editingTask.rep1 || effectiveUser?.email || '',
        rep2: isAdmin ? (editingTask.rep2 || '') : '',
        task_status: 'not_completed',
        status: editingTask.status || null,
        work_start_date: now,
        due_date: editingTask.due_date || now,
        manual_created_date: now,
      },
      leadId: currentLeadId,
      newStatus: editingTask.status,
      originalStatus: originalLeadStatus,
    });
  };

  const handleUpdateTask = async () => {
    if (!editingTask) return;
    if (!editingTask.task_type) { setValidationError('יש לבחור סוג משימה'); return; }
    // task_status is hidden from the form and managed by the automation
    // flows. Default it to 'not_completed' if somehow missing so a save
    // never silently no-ops behind a hidden validation error.
    const task_status = editingTask.task_status || 'not_completed';

    // Validate next task if form is showing
    if (showNextTaskForm) {
      if (!nextTask.task_type) { setValidationError('יש לבחור סוג למשימה הבאה'); return; }
      if (!nextTask.due_date && !nextTask.due_hours) { setValidationError('יש לבחור תאריך יעד או טווח למשימה הבאה'); return; }
    }

    setValidationError('');

    // When the rep flips this task's lead-status snapshot to "נסגרה
    // עסקה", we (a) cancel every other open task for the lead — the
    // deal is done, follow-ups are moot — and (b) jump to NewOrder
    // pre-filled, matching the LeadDetails / QuoteDetails / Complete-
    // TaskDialog flows.
    const dealJustClosed =
      editingTask.status === 'deal_closed' &&
      originalLeadStatus !== 'deal_closed' &&
      !!editingTask.lead_id;

    try {
      // Always update the Lead entity status to match
      const leadId = editingTask.lead_id;
      if (editingTask.status && leadId && editingTask.status !== originalLeadStatus) {
        await base44.entities.Lead.update(leadId, { status: editingTask.status });
        queryClient.invalidateQueries({ queryKey: ['lead'] });
        queryClient.invalidateQueries({ queryKey: ['leads'] });
      }

      if (dealJustClosed) {
        await cancelOpenTasksForClosedDeal(leadId, editingTask.id);
      }

      // Create next task if requested
      if (showNextTaskForm) {
        const dueDate = nextTask.due_hours
          ? addHours(new Date(), nextTask.due_hours).toISOString()
          : nextTask.due_date;

        await base44.entities.SalesTask.create({
          lead_id: leadId,
          rep1: editingTask.rep1,
          rep2: editingTask.rep2,
          task_type: nextTask.task_type,
          task_status: 'not_completed',
          status: editingTask.status,
          due_date: dueDate,
          work_start_date: new Date().toISOString(),
          summary: nextTask.summary || '',
        });
      }
    } catch (err) {
      console.error('Pre-save step failed', err);
      toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
      return;
    }

    // Whitelist editable columns. Spreading the entire editingTask used
    // to drag along read-only / computed columns (e.g. created_date,
    // updated_date, id mirrors, JOIN snapshots) which sometimes made
    // PostgREST reject the PATCH — and the rejection looked to the
    // user like "clicking save did nothing".
    const updateData = {
      task_type: editingTask.task_type,
      task_status,
      due_date: editingTask.due_date ?? null,
      work_start_date: editingTask.work_start_date ?? null,
      summary: editingTask.summary ?? null,
      status: editingTask.status ?? null,
      manual_created_date: editingTask.manual_created_date ?? null,
    };
    if (isAdmin) {
      updateData.rep1 = editingTask.rep1 ?? null;
      updateData.rep2 = editingTask.rep2 ?? null;
    }

    updateTaskMutation.mutate(
      { id: editingTask.id, data: updateData },
      {
        onSuccess: () => {
          if (dealJustClosed) {
            navigate(`${createPageUrl('NewOrder')}?leadId=${editingTask.lead_id}`);
          }
        },
      },
    );
  };

  // Shared between create and edit: when the rep picks a "ללא מענה" status, log
  // the (now-completed, in edit) attempt and schedule a callback in N hours. In
  // create mode there is no prior attempt task, so we only schedule the callback
  // and snapshot the lead status.
  const confirmNoAnswer = async () => {
    if (!noAnswerFlow?.selectedHours) return;
    if (!currentLeadId) { setValidationError('יש לבחור ליד'); return; }
    setIsSavingFollowup(true);
    try {
      const now = new Date().toISOString();
      await base44.entities.Lead.update(currentLeadId, { status: noAnswerFlow.status });
      if (!isCreate) {
        await base44.entities.SalesTask.update(editingTask.id, {
          task_status: 'completed',
          status: noAnswerFlow.status,
        });
      }
      const dueDate = addHours(new Date(), noAnswerFlow.selectedHours);
      await base44.entities.SalesTask.create({
        lead_id: currentLeadId,
        rep1: editingTask.rep1,
        rep2: editingTask.rep2,
        task_type: 'call',
        task_status: 'not_completed',
        status: noAnswerFlow.status,
        due_date: dueDate.toISOString(),
        work_start_date: now,
        summary: `חזור ללקוח ${currentLead?.full_name || ''} - ${noAnswerFlow.label}`,
      });
      invalidateTaskCaches(queryClient);
      toast.success(isCreate ? 'נקבעה משימת חזרה ללקוח' : 'המשימה נשמרה ונקבעה משימה חדשה');
      onClose();
    } catch (err) {
      console.error('No-answer save failed', err);
      toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    } finally {
      setIsSavingFollowup(false);
    }
  };

  const confirmFollowup = async () => {
    if (!followupFlow?.selectedDate || followupFlow.selectedHour == null) return;
    if (!currentLeadId) { setValidationError('יש לבחור ליד'); return; }
    setIsSavingFollowup(true);
    try {
      const dueDate = new Date(followupFlow.selectedDate);
      dueDate.setHours(followupFlow.selectedHour, 0, 0, 0);
      const now = new Date().toISOString();
      const statusLabel = followupFlow.status === 'followup_after_quote' ? 'אחרי הצעת מחיר' : 'לפני הצעת מחיר';

      await base44.entities.Lead.update(currentLeadId, { status: followupFlow.status });
      if (!isCreate) {
        await base44.entities.SalesTask.update(editingTask.id, {
          task_status: 'completed',
          status: followupFlow.status,
        });
      }
      await base44.entities.SalesTask.create({
        lead_id: currentLeadId,
        rep1: editingTask.rep1,
        rep2: editingTask.rep2,
        task_type: 'call',
        task_status: 'not_completed',
        status: followupFlow.status,
        due_date: dueDate.toISOString(),
        work_start_date: now,
        summary: `פולואפ - חזור ללקוח ${currentLead?.full_name || ''} ${statusLabel}`,
      });
      invalidateTaskCaches(queryClient);
      toast.success(isCreate ? 'נקבעה משימת פולואפ' : 'המשימה נשמרה ונקבעה משימה חדשה');
      onClose();
    } catch (err) {
      console.error('Followup save failed', err);
      toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    } finally {
      setIsSavingFollowup(false);
    }
  };

  // Assign a rep from the "משימת שיוך" flow: stamp the lead's owner, complete
  // this assignment task, and open a call task for the rep to phone the
  // customer. Guarded by isAssigning so a slow network can't turn impatient
  // double-clicks into duplicate call tasks.
  const handleAssignRep = async () => {
    if (isAssigning || !editingTask?.rep1) return;
    setIsAssigning(true);
    try {
      if (editingTask.lead_id) {
        await base44.entities.Lead.update(editingTask.lead_id, { rep1: editingTask.rep1 });
        queryClient.invalidateQueries({ queryKey: ['lead'] });
        queryClient.invalidateQueries({ queryKey: ['leads'] });
      }
      await base44.entities.SalesTask.create({
        lead_id: editingTask.lead_id,
        rep1: editingTask.rep1,
        rep2: editingTask.rep2,
        task_type: 'call',
        task_status: 'not_completed',
        status: editingTask.lead?.status || 'new_lead',
        work_start_date: new Date().toISOString(),
        due_date: new Date().toISOString(),
        summary: `יש להתקשר ללקוח ${editingTask.lead?.full_name || ''}`.trim(),
      });
      await base44.entities.SalesTask.update(editingTask.id, { task_status: 'completed' });
      invalidateTaskCaches(queryClient);
      toast.success('הנציג שויך והמשימה נוצרה');
      onClose();
    } catch (err) {
      console.error('Assign rep failed', err);
      toast.error(`שיוך נכשל: ${err?.message || 'שגיאה לא ידועה'}`);
      setIsAssigning(false);
    }
  };

  // Status dropdown handler — picking a no-answer / followup status opens its
  // scheduling sub-flow; anything else just sets the status.
  const handleStatusChange = (val) => {
    setEditingTask({ ...editingTask, status: val });
    if (NO_ANSWER_STATUSES[val]) {
      setNoAnswerFlow({ status: val, label: NO_ANSWER_STATUSES[val], selectedHours: null });
      setFollowupFlow(null);
    } else if (val === 'followup_before_quote' || val === 'followup_after_quote') {
      setFollowupFlow({ selectedDate: null, selectedHour: null, status: val });
      setNoAnswerFlow(null);
    } else {
      setNoAnswerFlow(null);
      setFollowupFlow(null);
    }
  };

  const handlePickLead = (lead) => {
    setEditingTask(prev => ({
      ...prev,
      lead,
      lead_id: lead.id,
      status: lead.status || '',
      rep1: lead.rep1 || prev.rep1,
    }));
    setOriginalLeadStatus(lead.status || '');
    setLeadSearch('');
    setDebouncedLeadSearch('');
  };

  const handleClearPickedLead = () => {
    setEditingTask(prev => ({ ...prev, lead: null, lead_id: '', status: '' }));
    setOriginalLeadStatus('');
    setNoAnswerFlow(null);
    setFollowupFlow(null);
  };

  const handleCall = async (phone) => {
    if (!phone) return;
    try { await base44.functions.invoke('clickToCall', { customerPhone: phone }); } catch {}
  };

  if (!editingTask) return null;

  const leadPhone = editingTask.lead?.phone;
  const repName = users.find(u => u.email === editingTask.rep1)?.full_name || editingTask.rep1;
  const rep2Name = users.find(u => u.email === editingTask.rep2)?.full_name || editingTask.rep2;
  const flowActive = !!noAnswerFlow || !!followupFlow;

  // ----- Shared: the reps selector (admin) / read-only (rep). Rendered inline
  // in create mode and inside the "rep_details" tab in edit mode.
  const repsControl = isAdmin ? (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">נציג ראשי</Label>
        <Select
          value={editingTask.rep1 || 'unassigned'}
          onValueChange={(val) => setEditingTask({ ...editingTask, rep1: val === 'unassigned' ? '' : val })}
        >
          <SelectTrigger className="bg-muted"><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">-- ללא שיוך --</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.email}>
                {u.full_name || u.email}{u.department === 'factory' ? ' (מפעל)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">נציג משני</Label>
        <Select
          value={editingTask.rep2 || 'unassigned'}
          onValueChange={(val) => setEditingTask({ ...editingTask, rep2: val === 'unassigned' ? '' : val })}
        >
          <SelectTrigger className="bg-muted"><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">-- ללא שיוך --</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.email}>{u.full_name || u.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">נציג ראשי</Label>
        <div className="rounded-lg border bg-muted px-3 py-2 text-sm">{repName || 'ללא שיוך'}</div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">נציג משני</Label>
        <div className="rounded-lg border bg-muted px-3 py-2 text-sm">{rep2Name || 'ללא שיוך'}</div>
      </div>
    </div>
  );

  // ----- Shared: the task body (smart lead-status control + scheduling flows +
  // task type + scheduling + quote shortcut + summary). This is THE thing that
  // must be identical between "new task" and the Sales-Tasks task screen.
  const taskDetailsBody = editingTask.task_type !== 'assignment' && (
    <>
      {/* סטטוס ליד - highlighted - למעלה */}
      <div className="border border-primary/20 bg-primary/5 rounded-xl p-4 space-y-2">
        <Label className="text-xs font-semibold text-primary uppercase tracking-wider">סטטוס ליד</Label>
        <Select value={editingTask.status || ''} onValueChange={handleStatusChange}>
          <SelectTrigger className="bg-white border-primary/20"><SelectValue placeholder="בחר סטטוס ליד..." /></SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {getVisibleStatusOptions(hiddenStatuses, editingTask.lead?.status).map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                <StatusOptionRow status={opt.value} label={opt.label} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* No-answer automation flow */}
      {noAnswerFlow && (
        <div className="border border-amber-300 bg-amber-50/60 rounded-xl p-4 space-y-4">
          <div className="text-center">
            <p className="text-sm font-bold text-amber-800">
              הסטטוס ישתנה ל: <span className="text-amber-900">{noAnswerFlow.label}</span>
            </p>
            <p className="text-xs text-amber-600 mt-1">בחר מתי לחזור ללקוח:</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[2, 3, 4, 5].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setNoAnswerFlow({ ...noAnswerFlow, selectedHours: h })}
                className={`py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                  noAnswerFlow.selectedHours === h
                    ? 'border-amber-500 bg-amber-100 text-amber-800 shadow-sm'
                    : 'border-border bg-white hover:border-amber-300 hover:bg-amber-50 text-muted-foreground'
                }`}
              >
                בעוד {h} שעות
              </button>
            ))}
          </div>
          <Button className="w-full" disabled={!noAnswerFlow.selectedHours || isSavingFollowup} onClick={confirmNoAnswer}>
            {isSavingFollowup ? 'שומר...' : 'אישור'}
          </Button>
        </div>
      )}

      {/* Followup (before / after quote) flow */}
      {followupFlow && (
        <div className="border border-blue-300 bg-blue-50/60 rounded-xl p-4 space-y-4">
          <div className="text-center">
            <p className="text-sm font-bold text-blue-800">
              תזמון חזרה ללקוח - {followupFlow.status === 'followup_after_quote' ? 'פולואפ אחרי הצעה' : 'פולואפ לפני הצעה'}
            </p>
            <p className="text-xs text-blue-600 mt-1">בחר יום ושעה לחזרה:</p>
          </div>

          {/* Day selection - next 5 working days (no Saturday) */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-blue-700">יום</span>
            <div className="grid grid-cols-5 gap-1.5">
              {(() => {
                const days = [];
                let d = startOfDay(new Date());
                let guard = 0;
                // Next 5 *open* days — skips שבת, חגים, and admin-defined closures.
                while (days.length < 5 && guard < 90) {
                  if (evaluateClosure(d).status !== 'closed') days.push(new Date(d));
                  d = addDays(d, 1);
                  guard++;
                }
                return days;
              })().map((day) => {
                const dayKey = day.toISOString();
                const dayName = format(day, 'EEEE', { locale: he });
                const dateLabel = format(day, 'd/M');
                const isSelected = followupFlow.selectedDate === dayKey;
                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => {
                      // Drop a previously-picked hour if it falls after the new
                      // day's half-day cutoff, so the confirm button can't
                      // submit a blocked time.
                      const ev = evaluateClosure(day);
                      const cutoff = ev.status === 'half_day' && ev.until ? parseTimeToMinutes(ev.until) : null;
                      const keepHour = followupFlow.selectedHour != null && (cutoff == null || followupFlow.selectedHour * 60 < cutoff);
                      setFollowupFlow({ ...followupFlow, selectedDate: dayKey, selectedHour: keepHour ? followupFlow.selectedHour : null });
                    }}
                    className={`flex flex-col items-center py-2.5 px-1 rounded-xl border-2 text-xs font-bold transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-100 text-blue-800 shadow-sm'
                        : 'border-border bg-white hover:border-blue-300 hover:bg-blue-50 text-muted-foreground'
                    }`}
                  >
                    <span className="leading-tight">{dayName}</span>
                    <span className="text-[10px] font-normal mt-0.5 opacity-70">{dateLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hour selection */}
          {followupFlow.selectedDate && (() => {
            // On a half-day (ערב חג / חצי-יום סגירה) only offer hours before the cutoff.
            const dayEval = evaluateClosure(new Date(followupFlow.selectedDate));
            const cutoffMin = dayEval.status === 'half_day' && dayEval.until ? parseTimeToMinutes(dayEval.until) : null;
            return (
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-blue-700">שעה</span>
                {cutoffMin != null && (
                  <p className="text-[11px] text-amber-600">
                    {dayEval.label || 'חצי יום'} — ניתן לקבוע עד {dayEval.until}
                  </p>
                )}
                <div className="grid grid-cols-5 gap-1.5">
                  {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((hour) => {
                    const isSelected = followupFlow.selectedHour === hour;
                    const blocked = cutoffMin != null && hour * 60 >= cutoffMin;
                    return (
                      <button
                        key={hour}
                        type="button"
                        disabled={blocked}
                        onClick={() => setFollowupFlow({ ...followupFlow, selectedHour: hour })}
                        className={`py-2 rounded-lg border-2 text-sm font-bold transition-all ${
                          blocked
                            ? 'border-border bg-muted/40 text-muted-foreground/40 cursor-not-allowed line-through'
                            : isSelected
                            ? 'border-blue-500 bg-blue-100 text-blue-800 shadow-sm'
                            : 'border-border bg-white hover:border-blue-300 hover:bg-blue-50 text-muted-foreground'
                        }`}
                      >
                        {String(hour).padStart(2, '0')}:00
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <Button
            className="w-full bg-blue-600 hover:bg-blue-700"
            disabled={!followupFlow.selectedDate || followupFlow.selectedHour == null || isSavingFollowup}
            onClick={confirmFollowup}
          >
            {isSavingFollowup ? 'שומר...' : 'אישור'}
          </Button>
        </div>
      )}

      {/* Rest of form - hidden when a scheduling flow is active */}
      {!flowActive && (
        <>
          {/* סוג משימה */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">סוג משימה</Label>
            <div className="grid grid-cols-4 gap-2">
              {TASK_TYPE_OPTIONS.map((type) => {
                const isSelected = editingTask.task_type === type.value;
                const Icon = {
                  call: Phone,
                  meeting: Users,
                  quote_preparation: FileText,
                  close_order: ShoppingCart,
                }[type.value] || Phone;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setEditingTask({ ...editingTask, task_type: type.value })}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
                      isSelected
                        ? 'icon-option-selected text-primary'
                        : 'border-transparent bg-muted/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium leading-tight text-center">{type.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* מועד המשימה — תאריך + שעה */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {editingTask.task_type === 'meeting'
                ? 'מועד הפגישה'
                : editingTask.task_type === 'call'
                ? 'מתי להתקשר?'
                : 'מועד יעד'}
            </Label>
            <DateTimePicker
              value={editingTask.due_date || ''}
              onChange={(value) => setEditingTask({ ...editingTask, due_date: value })}
              placeholder="בחר תאריך ושעה"
            />
          </div>

          {/* סטטוס משימה - hidden, managed automatically by status flows */}
          <div className="space-y-2 hidden">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">סטטוס משימה</Label>
            <div className="flex gap-2 flex-wrap">
              {TASK_STATUS_OPTIONS.map((status) => {
                const isSelected = editingTask.task_status === status.value;
                const styles = TASK_STATUS_STYLES[status.value] || TASK_STATUS_STYLES.not_completed;
                return (
                  <button
                    key={status.value}
                    type="button"
                    onClick={() => {
                      setEditingTask({ ...editingTask, task_status: status.value });
                      if (status.value === 'completed') {
                        setShowCompletedFlow(true);
                      } else {
                        setShowCompletedFlow(false);
                        setShowNextTaskForm(false);
                      }
                    }}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                      isSelected ? styles.on : `bg-white ${styles.off}`
                    }`}
                  >
                    {status.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Completed flow: change lead status + offer new task */}
          {showCompletedFlow && (
            <div className="border border-emerald-200/60 bg-emerald-50/30 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-emerald-800">המשימה הושלמה! רוצה להקים משימה חדשה?</p>
                <Button
                  type="button"
                  size="sm"
                  variant={showNextTaskForm ? "secondary" : "default"}
                  onClick={() => setShowNextTaskForm(!showNextTaskForm)}
                >
                  <Plus className="h-4 w-4 me-1" />
                  {showNextTaskForm ? 'ביטול משימה חדשה' : 'משימה חדשה'}
                </Button>
              </div>

              {showNextTaskForm && (
                <div className="space-y-4 pt-2 border-t border-emerald-200/40">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">סוג משימה</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {TASK_TYPE_OPTIONS.map((type) => {
                        const isSelected = nextTask.task_type === type.value;
                        const Icon = {
                          call: Phone, meeting: Users,
                          quote_preparation: FileText, close_order: ShoppingCart,
                        }[type.value] || Phone;
                        return (
                          <button
                            key={type.value}
                            type="button"
                            onClick={() => setNextTask({ ...nextTask, task_type: type.value })}
                            className={`flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-lg border transition-all text-xs ${
                              isSelected
                                ? 'icon-option-selected text-primary'
                                : 'border-transparent bg-muted/50 hover:bg-muted text-muted-foreground'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <span className="font-medium leading-tight text-center">{type.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">תאריך יעד</Label>
                    <DateTimePicker
                      value={nextTask.due_date}
                      onChange={(value) => setNextTask({ ...nextTask, due_date: value, due_hours: null })}
                      placeholder="בחר תאריך יעד"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-green-700 uppercase tracking-wider">או טווח משימה (תוספת שעות מעכשיו)</Label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5, 6].map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setNextTask({ ...nextTask, due_hours: h, due_date: '' })}
                          className={`flex-1 py-2 rounded-lg border-2 text-sm font-bold transition-all ${
                            nextTask.due_hours === h
                              ? 'border-green-500 bg-green-100 text-green-700'
                              : 'border-border bg-white hover:border-border/80 text-muted-foreground'
                          }`}
                        >
                          {h} שע׳
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* כפתורי פעולה מהירה לפי סוג משימה */}
          {editingTask.task_type === 'call' && leadPhone && (
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCall(leadPhone)}
              className="w-full text-emerald-600 border-emerald-200 hover:bg-emerald-50 gap-2"
            >
              <Phone className="h-4 w-4" /> התקשר ל{editingTask.lead?.full_name || 'ליד'} ({leadPhone})
            </Button>
          )}
          {editingTask.task_type === 'quote_preparation' && currentLeadId && (
            <Button
              type="button"
              variant="outline"
              className="w-full text-primary border-primary/20 hover:bg-primary/5 gap-2"
              onClick={() => setShowQuoteDialog(true)}
            >
              <FileText className="h-4 w-4" /> צור הצעת מחיר ל{editingTask.lead?.full_name || 'ליד'}
            </Button>
          )}

          {/* Linked quotes */}
          {leadQuotes.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">הצעות מחיר</Label>
              <div className="space-y-1.5">
                {leadQuotes.map((q) => (
                  <div key={q.id} className="flex items-center justify-between bg-muted/50 border rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{q.quote_number || `הצעה #${q.id}`}</span>
                      <span className="text-xs text-muted-foreground">₪{Math.round(q.total || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {q.pdf_url && (
                        <a href={q.pdf_url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-background transition-colors" title="הורד PDF">
                          <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      )}
                      <Link to={createPageUrl('QuoteDetails') + `?id=${q.id}`} onClick={onClose} className="p-1.5 rounded-md hover:bg-background transition-colors" title="צפה בהצעה">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* תיאור / סיכום המשימה — always editable (create AND when viewing an
              existing task) so the rep can record what happened. Saved to
              `summary`, the same field the completion flow appends notes to. */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">תיאור / סיכום המשימה</Label>
            <Textarea
              placeholder="מה היה במשימה? לדוגמה: הלקוח ביקש שנחזור אליו מחר, נשמע מעוניין לסגור..."
              value={editingTask.summary || ''}
              onChange={(e) => setEditingTask({ ...editingTask, summary: e.target.value })}
              className="min-h-[100px] bg-muted resize-none"
            />
          </div>
        </>
      )}
    </>
  );

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          {isCreate ? (
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold text-foreground">משימת מכירה חדשה</DialogTitle>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <DialogTitle className="text-xl font-bold text-foreground">פרטי משימה</DialogTitle>
          )}
        </DialogHeader>

        {isCreate ? (
          /* ===== CREATE: single screen — lead picker, then the shared body ===== */
          <div className="space-y-5 pt-2">
            {/* ליד — picked card or search */}
            {currentLeadId ? (
              <div className="bg-gradient-to-l from-blue-50 to-primary/5 border border-blue-100 rounded-xl p-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-foreground text-base flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-emerald-600" />
                    {editingTask.lead?.full_name || '(ללא שם)'}
                  </p>
                  {editingTask.lead?.phone && <p className="text-sm text-muted-foreground mt-0.5">📞 {editingTask.lead.phone}</p>}
                  {editingTask.lead?.email && <p className="text-sm text-muted-foreground">✉️ {editingTask.lead.email}</p>}
                </div>
                {!preSelectedLead && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearPickedLead} className="h-7 px-2">
                    <X className="h-3.5 w-3.5 me-1" />
                    שנה
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">ליד *</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    placeholder="הקלד טלפון או שם לחיפוש ליד..."
                    className="pr-10 bg-muted"
                    autoFocus
                  />
                </div>
                {debouncedLeadSearch.length >= 2 ? (
                  leadMatches.length > 0 ? (
                    <div className="rounded-md border border-border bg-white max-h-64 overflow-y-auto divide-y divide-border/50">
                      {leadMatches.map((lead) => (
                        <button
                          key={lead.id}
                          type="button"
                          onClick={() => handlePickLead(lead)}
                          className="w-full text-right px-3 py-2 hover:bg-muted/60 transition-colors"
                        >
                          <div className="text-sm font-medium truncate">{lead.full_name || '(ללא שם)'}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {lead.phone || '-'}
                            {lead.email ? ` • ${lead.email}` : ''}
                            {lead.city ? ` • ${lead.city}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground pr-1">לא נמצא ליד תואם.</p>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground pr-1">הקלד לפחות 2 תווים — חיפוש על כל הלידים בבסיס הנתונים.</p>
                )}
              </div>
            )}

            {/* Task body + reps — only once a lead is chosen */}
            {currentLeadId && (
              <>
                {taskDetailsBody}
                {!flowActive && repsControl}
              </>
            )}

            {validationError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                {validationError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" onClick={onClose} className="px-6">ביטול</Button>
              {!flowActive && (
                <Button onClick={handleCreateTask} disabled={createTaskMutation.isPending} className="px-8">
                  {createTaskMutation.isPending ? 'שומר...' : 'צור משימה'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* ===== EDIT: tabbed task / lead / rep screen ===== */
          <>
          <Tabs defaultValue="task_details" className="w-full mt-2" dir="rtl">
            {editingTask.task_type !== 'assignment' && (
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="task_details" className="text-sm">פרטי משימה</TabsTrigger>
                <TabsTrigger value="lead_details" className="text-sm">פרטי ליד</TabsTrigger>
                <TabsTrigger value="rep_details" className="text-sm">פרטי נציג מטפל</TabsTrigger>
              </TabsList>
            )}

            {validationError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mb-4">
                {validationError}
              </div>
            )}

            <TabsContent value="task_details" className="space-y-5 mt-0">
              {/* הודעה על ליד לא משוייך + שיוך נציג */}
              {editingTask.task_type === 'assignment' && !editingTask.rep1 && (
                <div className="border border-red-300 bg-red-50/60 rounded-xl p-3 text-center">
                  <p className="text-sm font-bold text-red-700">לא ניתן להתקדם עם הליד ללא שיוך נציג</p>
                  <p className="text-xs text-red-600 mt-1">יש לבחור נציג מהרשימה למטה ולאשר את השיוך</p>
                </div>
              )}

              {/* שיוך נציג - מוצג רק במשימת שיוך */}
              {editingTask.task_type === 'assignment' && (
                <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 space-y-3">
                  <Label className="text-xs font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    שיוך נציג לליד
                  </Label>
                  <Select
                    value={editingTask.rep1 || 'unassigned'}
                    onValueChange={(val) => setEditingTask({ ...editingTask, rep1: val === 'unassigned' ? '' : val })}
                  >
                    <SelectTrigger className="bg-white border-blue-200">
                      <SelectValue placeholder="בחר נציג לשיוך..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">-- ללא שיוך --</SelectItem>
                      {users.map(u => (
                        <SelectItem key={u.id} value={u.email}>
                          {u.full_name || u.email}{u.department === 'factory' ? ' (מפעל)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editingTask.rep1 && (
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      disabled={isAssigning}
                      onClick={handleAssignRep}
                    >
                      {isAssigning ? 'משייך...' : 'אשר שיוך והמשך'}
                    </Button>
                  )}
                </div>
              )}

              {taskDetailsBody}
            </TabsContent>

            <TabsContent value="lead_details" className="space-y-4 mt-0">
              {/* כרטיס ליד ראשי */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="bg-gradient-to-l from-blue-50/80 to-primary/5 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base">
                      {(editingTask.lead?.full_name || '?')[0]}
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-base leading-tight">
                        {editingTask.lead?.full_name || editingTask.lead_id}
                      </p>
                      {leadPhone && (
                        <button
                          onClick={() => handleCall(leadPhone)}
                          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium mt-0.5"
                        >
                          <Phone className="h-3 w-3" /> {leadPhone}
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { onClose(); openLead(editingTask.lead_id); }}
                    className="text-xs text-primary hover:text-primary/80 font-medium whitespace-nowrap focus:outline-none focus:underline"
                  >
                    עבור לליד ←
                  </button>
                </div>

                {editingTask.lead && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">נכנס:</span>
                      <span className="text-sm font-semibold text-foreground">
                        {safeFormat(editingTask.lead.created_date, 'dd/MM/yyyy HH:mm')}
                      </span>
                    </div>
                    <SLABadge lead={editingTask.lead} />
                  </div>
                )}

                <div className="grid grid-cols-2 border-t border-border/50">
                  <div className="px-4 py-3 border-e border-border/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Megaphone className="h-3 w-3 text-violet-500" />
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">מודעה</span>
                    </div>
                    <p className={`text-xs font-semibold leading-snug line-clamp-2 ${editingTask.lead?.facebook_ad_name ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                      {editingTask.lead?.facebook_ad_name || '-'}
                    </p>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Tag className="h-3 w-3 text-blue-500" />
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">מקור</span>
                    </div>
                    <p className={`text-sm font-semibold leading-snug ${(editingTask.lead?.utm_source || editingTask.lead?.source) ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                      {editingTask.lead?.utm_source || SOURCE_LABELS[editingTask.lead?.source] || editingTask.lead?.source || '-'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCall(leadPhone)}
                  className="flex-1 h-10 text-emerald-600 border-emerald-200 hover:bg-emerald-50 font-semibold"
                >
                  <Phone className="h-4 w-4 me-1.5" /> התקשר
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-10 text-primary border-primary/20 hover:bg-primary/5 font-semibold"
                  onClick={() => setShowQuoteDialog(true)}
                >
                  <FileText className="h-4 w-4 me-1.5" /> הצעת מחיר
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">סטטוס ליד</Label>
                <Select value={editingTask.status || ''} onValueChange={(val) => setEditingTask({ ...editingTask, status: val })}>
                  <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {getVisibleStatusOptions(hiddenStatuses, editingTask.lead?.status).map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <StatusOptionRow status={opt.value} label={opt.label} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="rep_details" className="space-y-5 mt-0">
              {repsControl}
            </TabsContent>
          </Tabs>

          <div className="space-y-5 mt-4">
            {/* מטא-דאטה */}
            <div className="text-xs text-muted-foreground/70 space-y-0.5 pt-2 border-t">
              {editingTask.created_date && <p>נוצרה: {safeFormat(editingTask.created_date, 'dd/MM/yyyy HH:mm')}</p>}
              {editingTask.updated_date && <p>עודכנה: {safeFormat(editingTask.updated_date, 'dd/MM/yyyy HH:mm')}</p>}
            </div>

            {/* כפתורי פעולה */}
            {editingTask.task_type === 'assignment' ? (
              <div className="flex justify-end pt-2 border-t">
                <Button variant="outline" onClick={onClose}>סגור</Button>
              </div>
            ) : (
              <div className="flex justify-between gap-2 pt-2 border-t">
                {isAdmin && (
                  showDeleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-600 font-medium">בטוח למחוק?</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteTaskMutation.mutate(editingTask.id)}
                        disabled={deleteTaskMutation.isPending}
                        className="text-red-600 border-red-500 bg-red-50 hover:bg-red-100"
                      >
                        {deleteTaskMutation.isPending ? 'מוחק...' : 'כן, מחק'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleteTaskMutation.isPending}>
                        ביטול
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-600 border-red-200 hover:bg-red-50 gap-1.5"
                    >
                      מחק
                    </Button>
                  )
                )}
                <div className="flex gap-2 ms-auto">
                  <Button variant="outline" onClick={onClose}>ביטול</Button>
                  <Button onClick={handleUpdateTask} disabled={updateTaskMutation.isPending} className="px-6 gap-1.5">
                    {updateTaskMutation.isPending ? 'שומר...' : 'שמור שינויים'}
                  </Button>
                </div>
              </div>
            )}
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* Quote creation dialog */}
    <Dialog open={showQuoteDialog} onOpenChange={setShowQuoteDialog}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl" onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">הצעת מחיר חדשה - {editingTask?.lead?.full_name || ''}</DialogTitle>
        </DialogHeader>
        <NewQuote
          asDialog
          dialogLeadId={editingTask?.lead_id}
          onDialogClose={() => {
            queryClient.invalidateQueries({ queryKey: ['lead'] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['quotes'] });
            queryClient.invalidateQueries({ queryKey: ['quotes', editingTask?.lead_id] });
            setEditingTask(prev => ({ ...prev, status: 'followup_after_quote' }));
            setFollowupFlow({ status: 'followup_after_quote', selectedDate: null, selectedHour: null });
            setNoAnswerFlow(null);
            setShowQuoteDialog(false);
          }}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
