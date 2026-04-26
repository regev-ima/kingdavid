import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { X, Phone, Users, FileText, ShoppingCart, Search, UserCheck } from "lucide-react";

// Strip everything but digits, then drop a leading country prefix so any
// stored form ("0537772829", "053-777-2829", "+972537772829") matches.
function normalizePhoneForLeadLookup(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}
// import { TASK_TYPE_OPTIONS, TASK_STATUS_OPTIONS } from '@/constants/leadOptions';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import { canAccessSalesWorkspace, isAdmin as isAdminUser } from '@/components/shared/rbac';

const TASK_TYPE_OPTIONS = [
  { value: 'call', label: 'שיחה', emoji: '📞' },
  { value: 'meeting', label: 'פגישה', emoji: '🤝' },
  { value: 'quote_preparation', label: 'הצעת מחיר', emoji: '📝' },
  { value: 'close_order', label: 'סגירת הזמנה', emoji: '✅' },
];

const TASK_STATUS_OPTIONS = [
  { value: 'not_completed', label: 'ממתין' },
  { value: 'completed', label: 'בוצע' },
  { value: 'not_done', label: 'לא בוצע' },
  { value: 'cancelled', label: 'בוטל' },
];

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

export default function AddSalesTaskDialog({ isOpen, onClose, preSelectedLead, effectiveUser: effectiveUserProp }) {
  const queryClient = useQueryClient();
  const { effectiveUser: effectiveUserFromHook } = useEffectiveCurrentUser(isOpen);
  const effectiveUser = effectiveUserProp || effectiveUserFromHook;
  const isAdmin = isAdminUser(effectiveUser);
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);
  const [formData, setFormData] = useState({
    lead_id: preSelectedLead?.id || '',
    status: '',
    task_type: 'call',
    task_status: 'not_completed',
    rep1: '',
    rep2: '',
    work_start_date: new Date().toISOString(),
    due_date: '',
    manual_created_date: '',
    summary: '',
  });
  const [validationError, setValidationError] = useState('');

  // Lead picker — search by phone or name against the entire DB (the previous
  // .list(500) dropdown couldn't reach a 100k-row leads table). Picked lead is
  // stored in `pickedLead` so the form can show it pinned without doing a
  // second lookup; clearing the pick re-enables search.
  const [leadSearch, setLeadSearch] = useState('');
  const [debouncedLeadSearch, setDebouncedLeadSearch] = useState('');
  const [pickedLead, setPickedLead] = useState(preSelectedLead || null);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLeadSearch(leadSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [leadSearch]);

  const phoneTail = useMemo(() => {
    const norm = normalizePhoneForLeadLookup(debouncedLeadSearch);
    return norm.length >= 4 ? norm.slice(-9) : '';
  }, [debouncedLeadSearch]);

  const lookupEnabled = isOpen && canAccessSales && !pickedLead && debouncedLeadSearch.length >= 2;

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
    enabled: isOpen && isAdmin,
  });

  useEffect(() => {
    if (preSelectedLead) {
      setPickedLead(preSelectedLead);
      setFormData(prev => ({
        ...prev,
        lead_id: preSelectedLead.id,
        rep1: preSelectedLead.rep1 || prev.rep1,
        status: preSelectedLead.status || '',
      }));
    }
  }, [preSelectedLead]);

  // Reset all the lookup state along with the form when the dialog closes.
  useEffect(() => {
    if (!isOpen) {
      setLeadSearch('');
      setDebouncedLeadSearch('');
      if (!preSelectedLead) setPickedLead(null);
    }
  }, [isOpen, preSelectedLead]);

  const handlePickLead = (lead) => {
    setPickedLead(lead);
    setFormData(prev => ({
      ...prev,
      lead_id: lead.id,
      rep1: lead.rep1 || prev.rep1,
      status: lead.status || '',
    }));
    setLeadSearch('');
    setDebouncedLeadSearch('');
  };

  const handleClearPickedLead = () => {
    setPickedLead(null);
    setFormData(prev => ({ ...prev, lead_id: '', status: '' }));
  };

  useEffect(() => {
    if (isOpen && effectiveUser && !isAdmin && !formData.rep1) {
      setFormData(prev => ({ ...prev, rep1: effectiveUser.email }));
    }
  }, [isOpen, effectiveUser, isAdmin, formData.rep1]);

  const createTaskMutation = useMutation({
    mutationFn: (data) => base44.entities.SalesTask.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
      queryClient.invalidateQueries({ queryKey: ['taskCounters'] });
      handleClose();
    },
  });

  const handleClose = () => {
    setFormData({
      lead_id: '',
      status: '',
      task_type: 'call',
      task_status: 'not_completed',
      rep1: '',
      rep2: '',
      work_start_date: '',
      due_date: '',
      manual_created_date: '',
      summary: '',
    });
    setValidationError('');
    onClose();
  };

  const handleSubmit = () => {
    if (!formData.lead_id) { setValidationError('יש לבחור ליד'); return; }
    if (!formData.summary) { setValidationError('יש למלא תוכן משימה'); return; }
    if (!formData.rep1) { setValidationError('יש לבחור נציג ראשי'); return; }
    setValidationError('');
    createTaskMutation.mutate({
      ...formData,
      rep1: formData.rep1 || effectiveUser?.email || '',
      rep2: isAdmin ? formData.rep2 : '',
      manual_created_date: new Date().toISOString(),
    });
  };

  const salesUsers = users.filter(u => u.role === 'user' || u.role === 'admin');

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-foreground">משימת מכירה חדשה</DialogTitle>
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* ליד */}
          {pickedLead ? (
            <div className="bg-gradient-to-l from-blue-50 to-primary/5 border border-blue-100 rounded-xl p-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-foreground text-base flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-emerald-600" />
                  {pickedLead.full_name || '(ללא שם)'}
                </p>
                {pickedLead.phone && <p className="text-sm text-muted-foreground mt-0.5">📞 {pickedLead.phone}</p>}
                {pickedLead.email && <p className="text-sm text-muted-foreground">✉️ {pickedLead.email}</p>}
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

          {/* סוג משימה */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">סוג משימה</Label>
            <div className="grid grid-cols-4 gap-2">
              {TASK_TYPE_OPTIONS.map((type) => {
                const isSelected = formData.task_type === type.value;
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
                    onClick={() => setFormData({ ...formData, task_type: type.value })}
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

          {/* סטטוס משימה */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">סטטוס משימה</Label>
            <div className="flex gap-2 flex-wrap">
              {TASK_STATUS_OPTIONS.map((status) => {
                const isSelected = formData.task_status === status.value;
                const styles = TASK_STATUS_STYLES[status.value] || TASK_STATUS_STYLES.not_completed;
                return (
                  <button
                    key={status.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, task_status: status.value })}
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

          {/* תוכן המשימה */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">תוכן המשימה *</Label>
            <Textarea
              placeholder="הקלד את תוכן המשימה והפרטים כאן..."
              value={formData.summary}
              onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
              className="min-h-[100px] bg-muted resize-none"
            />
          </div>

          {/* תאריכים */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">תאריך יצירה</Label>
              <DateTimePicker
                value={formData.manual_created_date}
                onChange={(value) => setFormData({ ...formData, manual_created_date: value })}
                placeholder="בחר תאריך"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">תחילת עבודה</Label>
              <DateTimePicker
                value={formData.work_start_date}
                onChange={(value) => setFormData({ ...formData, work_start_date: value })}
                placeholder="בחר תאריך"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">תאריך יעד</Label>
              <DateTimePicker
                value={formData.due_date}
                onChange={(value) => setFormData({ ...formData, due_date: value })}
                placeholder="בחר תאריך"
              />
            </div>
          </div>

          {/* נציגים */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">נציג ראשי *</Label>
              <Select
                value={formData.rep1}
                onValueChange={(value) => setFormData({ ...formData, rep1: value })}
                disabled={!isAdmin}
              >
                <SelectTrigger className="bg-muted">
                  <SelectValue placeholder="בחר נציג..." />
                </SelectTrigger>
                <SelectContent>
                  {salesUsers.map((u) => (
                    <SelectItem key={u.id} value={u.email}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">נציג משני</Label>
              <Select
                value={formData.rep2 || '__none__'}
                onValueChange={(value) => setFormData({ ...formData, rep2: value === '__none__' ? '' : value })}
                disabled={!isAdmin}
              >
                <SelectTrigger className="bg-muted">
                  <SelectValue placeholder="ללא" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">ללא</SelectItem>
                  {salesUsers.map((u) => (
                    <SelectItem key={u.id} value={u.email}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* שגיאת ולידציה */}
          {validationError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {validationError}
            </div>
          )}

          {/* כפתורי פעולה */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={handleClose} className="px-6">
              ביטול
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createTaskMutation.isPending}
              className="px-8"
            >
              {createTaskMutation.isPending ? 'שומר...' : 'צור משימה'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}