import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import {
  Loader2,
  CheckCircle2,
  CalendarPlus,
  Phone,
  MessageCircle,
  Mail,
  Users,
  FileText,
  RefreshCw,
  Paperclip,
  ShoppingCart,
} from 'lucide-react';
import { createPageUrl } from '@/utils';
import {
  TASK_COMPLETION_FLOWS,
  TONE_CLASSES,
  resolveOutcomeStatus,
} from '@/lib/taskCompletionFlow';

// The "מה קרה?" dialog. Opens after a rep clicks "סיים משימה" on a task.
// Flow:
//   1. Pick the outcome (e.g. answered-interested / no-answer / sent-WA).
//      That outcome dictates the lead's next status and *suggests* a
//      follow-up task, but the rep stays in control:
//   2. Optionally tweak / disable / enable / re-author the follow-up task
//      (type, due date, summary). Previously this was hardcoded per
//      outcome and the rep had no override.
//   3. Optionally add a closing note that's appended to the task summary.
//   4. On save: close the current task, update the lead status, create
//      the configured follow-up (if any), and redirect to NewOrder when
//      the outcome closes the deal.

const TASK_TYPE_OPTIONS = [
  { value: 'call', label: 'שיחה', Icon: Phone, color: 'text-blue-600' },
  { value: 'whatsapp', label: 'וואטסאפ', Icon: MessageCircle, color: 'text-green-600' },
  { value: 'email', label: 'מייל', Icon: Mail, color: 'text-purple-600' },
  { value: 'meeting', label: 'פגישה', Icon: Users, color: 'text-amber-600' },
  { value: 'quote_preparation', label: 'הצעת מחיר', Icon: FileText, color: 'text-indigo-600' },
  { value: 'close_order', label: 'סגירת הזמנה', Icon: ShoppingCart, color: 'text-emerald-600' },
  { value: 'followup', label: 'מעקב', Icon: RefreshCw, color: 'text-orange-600' },
  { value: 'other', label: 'אחר', Icon: Paperclip, color: 'text-muted-foreground' },
];

const TASK_TYPE_META = Object.fromEntries(TASK_TYPE_OPTIONS.map((o) => [o.value, o]));

const computeDueDateFromOutcome = (outcome) => {
  const nt = outcome?.nextTask;
  if (!nt) return '';
  if (nt.askForDateTime) return '';
  const d = new Date();
  if (nt.delayHours) d.setHours(d.getHours() + nt.delayHours);
  else if (nt.delayDays) d.setDate(d.getDate() + nt.delayDays);
  else return '';
  return d.toISOString();
};

const defaultFollowUpDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
};

export default function CompleteTaskDialog({ isOpen, onClose, task, onCompleted }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [notes, setNotes] = useState('');
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpType, setFollowUpType] = useState('call');
  const [followUpDueDate, setFollowUpDueDate] = useState('');
  const [followUpSummary, setFollowUpSummary] = useState('');

  // Reset on open/close or when switching to a different task.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedOutcome(null);
    setNotes('');
    setFollowUpEnabled(false);
    setFollowUpType('call');
    setFollowUpDueDate('');
    setFollowUpSummary('');
  }, [isOpen, task?.id]);

  // When the rep picks an outcome, seed the follow-up form from the
  // outcome's preset (if any) so they only have to edit what changed.
  // Reps can always toggle the section off, or on for outcomes without a
  // preset, and freely override every field.
  useEffect(() => {
    if (!selectedOutcome) return;
    const nt = selectedOutcome.nextTask;
    if (nt) {
      setFollowUpEnabled(true);
      setFollowUpType(nt.task_type || 'call');
      setFollowUpSummary(nt.summary || '');
      setFollowUpDueDate(computeDueDateFromOutcome(selectedOutcome));
    } else {
      setFollowUpEnabled(false);
      setFollowUpType('call');
      setFollowUpSummary('');
      setFollowUpDueDate('');
    }
  }, [selectedOutcome]);

  const outcomes = TASK_COMPLETION_FLOWS[task?.task_type] || [];
  const currentTaskMeta = TASK_TYPE_META[task?.task_type];

  const handleToggleFollowUp = (checked) => {
    setFollowUpEnabled(checked);
    if (checked && !followUpDueDate) {
      setFollowUpDueDate(defaultFollowUpDate());
    }
  };

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!task || !selectedOutcome) throw new Error('Missing task or outcome');
      if (followUpEnabled && !followUpDueDate) {
        throw new Error('יש לבחור תאריך ושעה למשימת ההמשך');
      }
      const currentLeadStatus = task.status || task.lead?.status || null;
      const nextLeadStatus = resolveOutcomeStatus(selectedOutcome, currentLeadStatus);

      // 1. Update the lead's status (when the outcome dictates one).
      if (task.lead_id && nextLeadStatus && nextLeadStatus !== currentLeadStatus) {
        await base44.entities.Lead.update(task.lead_id, { status: nextLeadStatus });
      }

      // 2. Close the current task.
      const taskUpdate = {
        task_status: 'completed',
        ...(nextLeadStatus ? { status: nextLeadStatus } : {}),
      };
      if (notes.trim()) {
        const previous = task.summary || '';
        taskUpdate.summary = previous
          ? `${previous}\n— ${notes.trim()}`
          : notes.trim();
      }
      await base44.entities.SalesTask.update(task.id, taskUpdate);

      // 3. Create the rep-configured follow-up task (when enabled).
      if (followUpEnabled && followUpDueDate) {
        await base44.entities.SalesTask.create({
          lead_id: task.lead_id,
          rep1: task.rep1,
          rep2: task.rep2,
          task_type: followUpType,
          task_status: 'not_completed',
          status: nextLeadStatus || currentLeadStatus || null,
          due_date: followUpDueDate,
          work_start_date: new Date().toISOString(),
          summary: followUpSummary || '',
        });
      }

      return { redirectTo: selectedOutcome.redirectTo };
    },
    onSuccess: ({ redirectTo }) => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks-counts'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks-tab'] });
      queryClient.invalidateQueries({ queryKey: ['leads-for-paginated-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['leads-active-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('המשימה הושלמה');
      onCompleted?.();
      onClose();
      if (redirectTo === 'NewOrder' && task?.lead_id) {
        // NewOrder reads `?leadId=` (camelCase); the earlier `?lead_id=`
        // form was silently ignored and the form didn't pre-fill.
        navigate(`${createPageUrl('NewOrder')}?leadId=${task.lead_id}`);
      }
    },
    onError: (err) => {
      toast.error(err?.message || 'שמירה נכשלה');
    },
  });

  const headerSubtitle = useMemo(() => {
    const bits = [];
    if (currentTaskMeta) bits.push(currentTaskMeta.label);
    if (task?.lead?.full_name) bits.push(task.lead.full_name);
    return bits.join(' · ');
  }, [currentTaskMeta, task?.lead?.full_name]);

  if (!task) return null;

  const canSave =
    !!selectedOutcome &&
    !completeMutation.isPending &&
    (!followUpEnabled || !!followUpDueDate);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" dir="rtl">
        {/* Header — task context up front so the rep knows what they're closing */}
        <div className="bg-gradient-to-l from-emerald-50 via-card to-card px-6 py-4 border-b border-border">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-start">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
              <span>מה קרה במשימה?</span>
            </DialogTitle>
            {headerSubtitle && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1 text-start">
                {currentTaskMeta && <currentTaskMeta.Icon className={`h-3.5 w-3.5 ${currentTaskMeta.color}`} />}
                <span className="font-medium text-foreground/80">{headerSubtitle}</span>
              </div>
            )}
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {outcomes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              אין זרימת השלמה מוגדרת לסוג המשימה הזה.
            </p>
          ) : (
            <div className="space-y-2">
              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                בחר תוצאה
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {outcomes.map((outcome) => {
                  const isSelected = selectedOutcome?.id === outcome.id;
                  const base = TONE_CLASSES[outcome.tone] || TONE_CLASSES.neutral;
                  return (
                    <button
                      key={outcome.id}
                      type="button"
                      onClick={() => setSelectedOutcome(outcome)}
                      className={`w-full px-4 py-3 rounded-xl border-2 text-sm font-semibold text-start transition-all flex items-center justify-between gap-2 ${base} ${
                        isSelected ? 'ring-2 ring-offset-1 ring-primary scale-[0.99]' : 'hover:scale-[1.005]'
                      }`}
                    >
                      <span>{outcome.label}</span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedOutcome && (
            <>
              {/* Closing note for the current task */}
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  הערה על המשימה (אופציונלי)
                </Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="פרטים נוספים שירשמו על המשימה"
                  rows={2}
                />
              </div>

              {/* Follow-up task — always available, pre-seeded from the
                  outcome's preset when there is one, freely editable */}
              <div className="rounded-xl border border-border bg-muted/30">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <CalendarPlus className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <Label className="text-sm font-semibold cursor-pointer" onClick={() => handleToggleFollowUp(!followUpEnabled)}>
                        משימת המשך
                      </Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {followUpEnabled ? 'תיווצר אוטומטית אחרי הסיום' : 'אין משימת המשך'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={followUpEnabled}
                    onCheckedChange={handleToggleFollowUp}
                    aria-label="הפעל משימת המשך"
                  />
                </div>

                {followUpEnabled && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border/60 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        סוג משימה
                      </Label>
                      <Select value={followUpType} onValueChange={setFollowUpType}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <span className="inline-flex items-center gap-2">
                                <opt.Icon className={`h-3.5 w-3.5 ${opt.color}`} />
                                {opt.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        מתי
                      </Label>
                      <DateTimePicker
                        value={followUpDueDate}
                        onChange={setFollowUpDueDate}
                        placeholder="בחר תאריך ושעה"
                      />
                      {!followUpDueDate && (
                        <p className="text-[11px] text-amber-600">חובה לבחור תאריך ושעה למשימה</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        סיכום
                      </Label>
                      <Textarea
                        value={followUpSummary}
                        onChange={(e) => setFollowUpSummary(e.target.value)}
                        placeholder="מה צריך לעשות במשימה הבאה"
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/20 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={completeMutation.isPending}>
            ביטול
          </Button>
          <Button onClick={() => completeMutation.mutate()} disabled={!canSave} className="gap-1.5">
            {completeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            סיים
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
