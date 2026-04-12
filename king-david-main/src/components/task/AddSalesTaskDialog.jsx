import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { X, Phone, Users, FileText, ShoppingCart } from "lucide-react";
// import { TASK_TYPE_OPTIONS, TASK_STATUS_OPTIONS } from '@/constants/leadOptions';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import { canAccessSalesWorkspace, filterLeadsForUser, isAdmin as isAdminUser } from '@/components/shared/rbac';

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

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-task'],
    queryFn: () => base44.entities.Lead.list('-created_date', 500),
    enabled: isOpen && canAccessSales,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: isOpen && isAdmin,
  });

  useEffect(() => {
    if (preSelectedLead) {
      setFormData(prev => ({
        ...prev,
        lead_id: preSelectedLead.id,
        rep1: preSelectedLead.rep1 || prev.rep1,
        status: preSelectedLead.status || '',
      }));
    }
  }, [preSelectedLead]);

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

  const scopedLeads = filterLeadsForUser(effectiveUser, leads);
  const selectedLead = scopedLeads.find(l => l.id === formData.lead_id);
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
          {!preSelectedLead ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">ליד *</Label>
              <Select value={formData.lead_id} onValueChange={(value) => {
                const selectedLd = leads.find(l => l.id === value);
                setFormData({ ...formData, lead_id: value, rep1: selectedLd?.rep1 || formData.rep1, status: selectedLd?.status || '' });
              }}>
                <SelectTrigger className="bg-muted">
                  <SelectValue placeholder="בחר ליד..." />
                </SelectTrigger>
                <SelectContent>
                  {scopedLeads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.full_name || lead.phone}{lead.phone ? ` · ${lead.phone}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLead && (
                <p className="text-xs text-muted-foreground pr-1">
                  {selectedLead.phone}{selectedLead.city ? ` · ${selectedLead.city}` : ''}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-gradient-to-l from-blue-50 to-primary/5 border border-blue-100 rounded-xl p-4">
              <p className="font-bold text-foreground text-base">{preSelectedLead.full_name}</p>
              {preSelectedLead.phone && <p className="text-sm text-muted-foreground mt-0.5">📞 {preSelectedLead.phone}</p>}
              {preSelectedLead.email && <p className="text-sm text-muted-foreground">✉️ {preSelectedLead.email}</p>}
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