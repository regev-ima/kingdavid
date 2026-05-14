import { useEffect, useState } from 'react';
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
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { createPageUrl } from '@/utils';
import {
  TASK_COMPLETION_FLOWS,
  TONE_CLASSES,
  resolveOutcomeStatus,
  computeNextTaskDueDate,
} from '@/lib/taskCompletionFlow';

// The "מה קרה?" dialog. Opens after a rep clicks a quick-action on a
// task (e.g. "התקשרתי" or "התקיים"), shows the outcomes valid for that
// task type, and on confirm:
//   1. Marks the current task as completed.
//   2. Updates the lead's status per the chosen outcome (when defined).
//   3. Optionally creates the follow-up task that the outcome implies.
//   4. Optionally navigates to NewOrder when the outcome closes the deal.
//
// Pure UI — does not modify the dialog the rep was on before. Caller is
// responsible for opening this dialog with a hydrated task object (must
// include id, task_type, lead_id, rep1/rep2 and optionally a status).

export default function CompleteTaskDialog({ isOpen, onClose, task, onCompleted }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [manualDateTime, setManualDateTime] = useState('');
  const [notes, setNotes] = useState('');

  // Reset on open/close or when switching to a different task.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedOutcome(null);
    setManualDateTime('');
    setNotes('');
  }, [isOpen, task?.id]);

  const outcomes = TASK_COMPLETION_FLOWS[task?.task_type] || [];

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!task || !selectedOutcome) throw new Error('Missing task or outcome');
      const currentLeadStatus = task.status || task.lead?.status || null;
      const nextLeadStatus = resolveOutcomeStatus(selectedOutcome, currentLeadStatus);
      const nextTaskDue = computeNextTaskDueDate(selectedOutcome, manualDateTime);

      if (selectedOutcome.nextTask?.askForDateTime && !nextTaskDue) {
        throw new Error('יש לבחור תאריך ושעה למשימה הבאה');
      }

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

      // 3. Create the follow-up task when configured.
      if (selectedOutcome.nextTask && nextTaskDue) {
        await base44.entities.SalesTask.create({
          lead_id: task.lead_id,
          rep1: task.rep1,
          rep2: task.rep2,
          task_type: selectedOutcome.nextTask.task_type,
          task_status: 'not_completed',
          status: nextLeadStatus || currentLeadStatus || null,
          due_date: nextTaskDue,
          work_start_date: new Date().toISOString(),
          summary: selectedOutcome.nextTask.summary || '',
        });
      }

      return { redirectTo: selectedOutcome.redirectTo };
    },
    onSuccess: ({ redirectTo }) => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks-counts'] });
      queryClient.invalidateQueries({ queryKey: ['salesTasks-tab'] });
      queryClient.invalidateQueries({ queryKey: ['leads-for-paginated-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['lead'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('המשימה הושלמה');
      onCompleted?.();
      onClose();
      if (redirectTo === 'NewOrder' && task?.lead_id) {
        navigate(`${createPageUrl('NewOrder')}?lead_id=${task.lead_id}`);
      }
    },
    onError: (err) => {
      toast.error(err?.message || 'שמירה נכשלה');
    },
  });

  if (!task) return null;

  const requiresDateTime = selectedOutcome?.nextTask?.askForDateTime;
  const canSave =
    !!selectedOutcome &&
    !completeMutation.isPending &&
    (!requiresDateTime || !!manualDateTime);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            מה קרה?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {outcomes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              אין זרימת השלמה מוגדרת לסוג המשימה הזה.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {outcomes.map((outcome) => {
                const isSelected = selectedOutcome?.id === outcome.id;
                const base = TONE_CLASSES[outcome.tone] || TONE_CLASSES.neutral;
                return (
                  <button
                    key={outcome.id}
                    type="button"
                    onClick={() => setSelectedOutcome(outcome)}
                    className={`w-full px-4 py-3 rounded-xl border-2 text-sm font-semibold text-start transition-all ${base} ${
                      isSelected ? 'ring-2 ring-offset-1 ring-primary' : ''
                    }`}
                  >
                    {outcome.label}
                  </button>
                );
              })}
            </div>
          )}

          {requiresDateTime && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                מתי לקבוע את המשימה הבאה?
              </Label>
              <DateTimePicker
                value={manualDateTime}
                onChange={setManualDateTime}
                placeholder="בחר תאריך ושעה"
              />
            </div>
          )}

          {selectedOutcome && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                הערה (אופציונלי)
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="פרטים נוספים שירשמו על המשימה"
                rows={3}
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={completeMutation.isPending}>
            ביטול
          </Button>
          <Button onClick={() => completeMutation.mutate()} disabled={!canSave}>
            {completeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin me-2" />
            ) : null}
            סיים
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
