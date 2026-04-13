import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Phone, FileText, Users, ShoppingCart, Plus, Clock, Tag, Megaphone, UserPlus, Download, ExternalLink } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, isValid, addHours, addDays, startOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { LEAD_STATUS_OPTIONS, TASK_TYPE_OPTIONS, TASK_STATUS_OPTIONS, SOURCE_LABELS } from '@/constants/leadOptions';
import { useHiddenStatuses, getVisibleStatusOptions } from '@/hooks/useHiddenStatuses';
import SLABadge from '@/components/sla/SLABadge';
import { formatPhoneForWhatsApp } from '@/utils/phoneUtils';
import NewQuote from '@/pages/NewQuote';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import { isAdmin as isAdminUser } from '@/components/shared/rbac';

const TASK_TYPE_COLORS = {
  call: 'border-blue-500 bg-blue-50 text-blue-600',
  meeting: 'border-amber-500 bg-amber-50 text-amber-600',
  quote_preparation: 'border-primary/50 bg-primary/5 text-primary',
  close_order: 'border-emerald-500 bg-emerald-50 text-emerald-600',
};

const TASK_STATUS_STYLES = {
  not_completed: { on: 'border-amber-400/50 bg-amber-50 text-amber-700', off: 'border-border hover:border-amber-300 hover:bg-amber-50/50 text-muted-foreground' },
  completed: { on: 'border-emerald-400/50 bg-emerald-50 text-emerald-700', off: 'border-border hover:border-emerald-300 hover:bg-emerald-50/50 text-muted-foreground' },
  not_done: { on: 'border-red-400/50 bg-red-50 text-red-700', off: 'border-border hover:border-red-300 hover:bg-red-50/50 text-muted-foreground' },
  cancelled: { on: 'border-border bg-muted text-foreground', off: 'border-border hover:border-border/80 hover:bg-muted/50 text-muted-foreground' },
};

const safeFormat = (dateStr, fmt) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isValid(d) ? format(d, fmt) : dateStr;
};

const toISO = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isValid(d) ? d.toISOString() : '';
};

const NO_ANSWER_STATUSES = {
  no_answer_1: 'ללא מענה 1',
  no_answer_2: 'ללא מענה 2',
  no_answer_3: 'ללא מענה 3',
  no_answer_4: 'ללא מענה 4',
};

export default function EditSalesTaskDialog({ isOpen, onClose, task, effectiveUser: effectiveUserProp }) {
  const queryClient = useQueryClient();
  const { hiddenStatuses } = useHiddenStatuses();
  const { effectiveUser: effectiveUserFromHook } = useEffectiveCurrentUser(isOpen);
  const effectiveUser = effectiveUserProp || effectiveUserFromHook;
  const isAdmin = isAdminUser(effectiveUser);
  const [editingTask, setEditingTask] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCompletedFlow, setShowCompletedFlow] = useState(false);
  const [showNextTaskForm, setShowNextTaskForm] = useState(false);
  const [nextTask, setNextTask] = useState({ task_type: 'call', due_date: '', due_hours: null });
  const [originalLeadStatus, setOriginalLeadStatus] = useState('');
  const [noAnswerFlow, setNoAnswerFlow] = useState(null); // { status, label, selectedHours }
  const [followupFlow, setFollowupFlow] = useState(null); // { selectedDate, selectedHour }
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: isOpen && (isAdmin || task?.task_type === 'assignment'),
  });

  const { data: leadQuotes = [] } = useQuery({
    queryKey: ['quotes', task?.lead_id],
    queryFn: () => base44.entities.Quote.filter({ lead_id: task.lead_id }),
    enabled: isOpen && !!task?.lead_id,
  });

  useEffect(() => {
    if (task) {
      const leadStatus = task.lead?.status || task.status || '';
      setEditingTask({
        ...task,
        status: leadStatus,
      });
      setOriginalLeadStatus(leadStatus);
      setValidationError('');
      setShowDeleteConfirm(false);
      setShowCompletedFlow(false);
      setShowNextTaskForm(false);
      setNextTask({ task_type: 'call', due_date: '', due_hours: null });
      setNoAnswerFlow(null);
      setFollowupFlow(null);
    }
  }, [task]);

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SalesTask.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['taskCounters'] });
      onClose();
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id) => base44.entities.SalesTask.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['taskCounters'] });
      onClose();
    },
  });

  const handleUpdateTask = async () => {
    if (!editingTask) return;
    if (!editingTask.task_type) { setValidationError('יש לבחור סוג משימה'); return; }
    if (!editingTask.task_status) { setValidationError('יש לבחור סטטוס משימה'); return; }
    
    // Validate next task if form is showing
    if (showNextTaskForm) {
      if (!nextTask.task_type) { setValidationError('יש לבחור סוג למשימה הבאה'); return; }
      if (!nextTask.due_date && !nextTask.due_hours) { setValidationError('יש לבחור תאריך יעד או טווח למשימה הבאה'); return; }
    }
    
    setValidationError('');

    // Always update the Lead entity status to match
    const leadId = editingTask.lead_id;
    if (editingTask.status && leadId && editingTask.status !== originalLeadStatus) {
      await base44.entities.Lead.update(leadId, { status: editingTask.status });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
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

    // Extract only SalesTask fields — exclude the nested `lead` object
    const { lead, id, ...taskFields } = editingTask;
    const updateData = isAdmin
      ? taskFields
      : { ...taskFields, rep1: task?.rep1 || taskFields.rep1, rep2: task?.rep2 || taskFields.rep2 };

    updateTaskMutation.mutate({ id: editingTask.id, data: updateData });
  };

  const handleCall = async (phone) => {
    if (!phone) return;
    try { await base44.functions.invoke('clickToCall', { customerPhone: phone }); } catch {}
  };

  const handleWhatsApp = (phone) => {
    if (!phone) return;
    const wp = formatPhoneForWhatsApp(phone);
    if (wp) window.open(`https://wa.me/${wp}`, '_blank');
  };

  if (!editingTask) return null;

  const leadPhone = editingTask.lead?.phone;
  const repName = users.find(u => u.email === editingTask.rep1)?.full_name || editingTask.rep1;
  const rep2Name = users.find(u => u.email === editingTask.rep2)?.full_name || editingTask.rep2;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">פרטי משימה</DialogTitle>
        </DialogHeader>

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
                    disabled={updateTaskMutation.isPending}
                    onClick={async () => {
                      if (editingTask.lead_id) {
                        await base44.entities.Lead.update(editingTask.lead_id, { rep1: editingTask.rep1 });
                        queryClient.invalidateQueries({ queryKey: ['lead'] });
                        queryClient.invalidateQueries({ queryKey: ['leads'] });
                      }
                      await base44.entities.SalesTask.create({
                        lead_id: editingTask.lead_id,
                        rep1: editingTask.rep1,
                        task_type: 'call',
                        task_status: 'not_completed',
                        status: editingTask.status || editingTask.lead?.status || 'new_lead',
                        due_date: addHours(new Date(), 3).toISOString(),
                        work_start_date: new Date().toISOString(),
                        summary: `ליצור קשר עם ${editingTask.lead?.full_name || 'הליד'}`,
                      });
                      const { lead, id, ...taskFields } = editingTask;
                      updateTaskMutation.mutate({
                        id: editingTask.id,
                        data: { ...taskFields, task_status: 'completed' },
                      });
                    }}
                  >
                    {updateTaskMutation.isPending ? 'משייך...' : 'אישור שיוך'}
                  </Button>
                )}
              </div>
            )}

            {editingTask.task_type !== 'assignment' && <>
            {/* סטטוס ליד - highlighted - למעלה */}
            <div className="border border-primary/20 bg-primary/5 rounded-xl p-4 space-y-2">
              <Label className="text-xs font-semibold text-primary uppercase tracking-wider">סטטוס ליד</Label>
              <Select value={editingTask.status || ''} onValueChange={(val) => {
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
              }}>
                <SelectTrigger className="bg-white border-primary/20"><SelectValue placeholder="בחר סטטוס ליד..." /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {getVisibleStatusOptions(hiddenStatuses, editingTask.lead?.status).map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
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
                <Button
                  className="w-full"
                  disabled={!noAnswerFlow.selectedHours || updateTaskMutation.isPending}
                  onClick={async () => {
                    if (!noAnswerFlow.selectedHours) return;
                    const now = new Date().toISOString();

                    // 1. Update lead status
                    if (editingTask.lead_id) {
                      await base44.entities.Lead.update(editingTask.lead_id, { status: noAnswerFlow.status });
                      queryClient.invalidateQueries({ queryKey: ['lead'] });
                      queryClient.invalidateQueries({ queryKey: ['leads'] });
                    }

                    // 2. Mark current task as completed with timestamp
                    const { lead: _lead, id: _id, ...noAnswerTaskFields } = editingTask;
                    await base44.entities.SalesTask.update(editingTask.id, {
                      ...noAnswerTaskFields,
                      task_status: 'completed',
                      status: noAnswerFlow.status,
                      completed_date: now,
                    });

                    // 3. Create new call task with selected hours
                    const dueDate = addHours(new Date(), noAnswerFlow.selectedHours);
                    await base44.entities.SalesTask.create({
                      lead_id: editingTask.lead_id,
                      rep1: editingTask.rep1,
                      rep2: editingTask.rep2,
                      task_type: 'call',
                      task_status: 'not_completed',
                      status: noAnswerFlow.status,
                      due_date: dueDate.toISOString(),
                      work_start_date: now,
                      created_date: now,
                      summary: `חזור ללקוח ${editingTask.lead?.full_name || ''} - ${noAnswerFlow.label}`,
                    });

                    // 4. Refresh and close
                    queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
                    queryClient.invalidateQueries({ queryKey: ['tasks'] });
                    queryClient.invalidateQueries({ queryKey: ['taskCounters'] });
                    onClose();
                  }}
                >
                  {updateTaskMutation.isPending ? 'שומר...' : 'אישור'}
                </Button>
              </div>
            )}

            {/* Followup before quote flow */}
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
                      while (days.length < 5) {
                        if (d.getDay() !== 6) days.push(new Date(d));
                        d = addDays(d, 1);
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
                          onClick={() => setFollowupFlow({ ...followupFlow, selectedDate: dayKey })}
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
                {followupFlow.selectedDate && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-blue-700">שעה</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((hour) => {
                        const isSelected = followupFlow.selectedHour === hour;
                        return (
                          <button
                            key={hour}
                            type="button"
                            onClick={() => setFollowupFlow({ ...followupFlow, selectedHour: hour })}
                            className={`py-2 rounded-lg border-2 text-sm font-bold transition-all ${
                              isSelected
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
                )}

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={!followupFlow.selectedDate || followupFlow.selectedHour == null || updateTaskMutation.isPending}
                  onClick={async () => {
                    const dueDate = new Date(followupFlow.selectedDate);
                    dueDate.setHours(followupFlow.selectedHour, 0, 0, 0);

                    const now = new Date().toISOString();
                    const statusLabel = followupFlow.status === 'followup_after_quote' ? 'אחרי הצעת מחיר' : 'לפני הצעת מחיר';

                    // 1. Update lead status
                    if (editingTask.lead_id) {
                      await base44.entities.Lead.update(editingTask.lead_id, { status: followupFlow.status });
                      queryClient.invalidateQueries({ queryKey: ['lead'] });
                      queryClient.invalidateQueries({ queryKey: ['leads'] });
                    }

                    // 2. Mark current task as completed with timestamp
                    const { lead, id, ...taskFields } = editingTask;
                    await base44.entities.SalesTask.update(editingTask.id, {
                      ...taskFields,
                      task_status: 'completed',
                      status: followupFlow.status,
                      completed_date: now,
                    });

                    // 3. Create new followup call task
                    await base44.entities.SalesTask.create({
                      lead_id: editingTask.lead_id,
                      rep1: editingTask.rep1,
                      rep2: editingTask.rep2,
                      task_type: 'call',
                      task_status: 'not_completed',
                      status: followupFlow.status,
                      due_date: dueDate.toISOString(),
                      work_start_date: now,
                      created_date: now,
                      summary: `פולואפ - חזור ללקוח ${editingTask.lead?.full_name || ''} ${statusLabel}`,
                    });

                    // 4. Refresh and close
                    queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
                    queryClient.invalidateQueries({ queryKey: ['tasks'] });
                    queryClient.invalidateQueries({ queryKey: ['taskCounters'] });
                    onClose();
                  }}
                >
                  {updateTaskMutation.isPending ? 'שומר...' : 'אישור'}
                </Button>
              </div>
            )}

            {/* Rest of form - hidden when a scheduling flow is active */}
            {!noAnswerFlow && !followupFlow && <>
            {/* סוג משימה */}
            <div className={`space-y-2 ${editingTask.task_type === 'assignment' && !editingTask.rep1 ? 'opacity-50 pointer-events-none' : ''}`}>
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

            {/* שיוך נציג הועבר למעלה - מתחת להודעה האדומה */}

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
                        // When clicking "completed", show the next step flow
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
                    className={showNextTaskForm ? "" : ""}
                  >
                    <Plus className="h-4 w-4 me-1" />
                    {showNextTaskForm ? 'ביטול משימה חדשה' : 'משימה חדשה'}
                  </Button>
                </div>

                {showNextTaskForm && (
                  <div className="space-y-4 pt-2 border-t border-emerald-200/40">
                    {/* סוג משימה חדשה */}
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

                    {/* תאריך יעד */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">תאריך יעד</Label>
                      <DateTimePicker
                        value={nextTask.due_date}
                        onChange={(value) => setNextTask({ ...nextTask, due_date: value, due_hours: null })}
                        placeholder="בחר תאריך יעד"
                      />
                    </div>

                    {/* טווח משימה - שעות */}
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
            {editingTask.task_type === 'quote_preparation' && editingTask.lead_id && (
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

            {/* תוכן המשימה - read only */}
            {editingTask.summary && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">תוכן המשימה</Label>
                <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2">{editingTask.summary}</p>
              </div>
            )}
            </>}
            </>}
          </TabsContent>

          <TabsContent value="lead_details" className="space-y-4 mt-0">
            {/* כרטיס ליד ראשי */}
            <div className="rounded-xl border border-border overflow-hidden">
              {/* Header עם שם + טלפון + לינק */}
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
                <Link
                  to={createPageUrl('LeadDetails') + `?id=${editingTask.lead_id}`}
                  onClick={onClose}
                  className="text-xs text-primary hover:text-primary/80 font-medium whitespace-nowrap"
                >
                  עבור לליד ←
                </Link>
              </div>

              {/* SLA + שעת הליד - שורה בולטת */}
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

              {/* כרטיסיות מידע */}
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

            {/* פעולות מהירות */}
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

            {/* סטטוס ליד */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">סטטוס ליד</Label>
              <Select value={editingTask.status || ''} onValueChange={(val) => setEditingTask({ ...editingTask, status: val })}>
                <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {getVisibleStatusOptions(hiddenStatuses, editingTask.lead?.status).map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="rep_details" className="space-y-5 mt-0">
            {/* נציגים */}
            {isAdmin ? (
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
            )}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleteTaskMutation.isPending}
                  >
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
                <Button
                onClick={handleUpdateTask}
                disabled={updateTaskMutation.isPending}
                className="px-6 gap-1.5"
                >
                {updateTaskMutation.isPending ? 'שומר...' : 'שמור שינויים'}
                </Button>
                </div>
          </div>
          )}
        </div>
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
          onDialogClose={(quote) => {
            queryClient.invalidateQueries({ queryKey: ['lead'] });
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            queryClient.invalidateQueries({ queryKey: ['quotes'] });
            queryClient.invalidateQueries({ queryKey: ['quotes', editingTask?.lead_id] });
            setEditingTask(prev => ({ ...prev, status: 'followup_after_quote' }));
            setFollowupFlow({ status: 'followup_after_quote', selectedDate: null, selectedHour: null });
          }}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}