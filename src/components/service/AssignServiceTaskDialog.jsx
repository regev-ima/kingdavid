import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Loader2, LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';

// Service-manager action: hand a service ticket to a rep as a follow-up task.
// The task is a SalesTask with task_type='service' so it surfaces in that
// rep's "משימות מכירה" list in its own colour, linked back to the ticket via
// service_ticket_id. The ticket itself stays in the service desk's queue.
export default function AssignServiceTaskDialog({ open, onOpenChange, ticket, currentUser }) {
  const queryClient = useQueryClient();

  const defaultSummary = ticket
    ? `פניית שירות #${ticket.ticket_number || ''} — ${ticket.subject || ''}. ליצור קשר עם ${ticket.customer_name || 'הלקוח'} (${ticket.customer_phone || ''}).`
    : '';

  const [rep, setRep] = useState('');
  const [summary, setSummary] = useState(defaultSummary);
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (open) {
      setRep('');
      setSummary(defaultSummary);
      // Default the follow-up to tomorrow morning.
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      setDueDate(d.toISOString());
    }
  }, [open, ticket?.id]);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: open,
    staleTime: 300000,
  });
  const salesUsers = users.filter((u) => u.role === 'user' || u.role === 'admin');

  const assignMutation = useMutation({
    mutationFn: async () => {
      // 1. Create the rep's follow-up task.
      const task = await base44.entities.SalesTask.create({
        task_type: 'service',
        task_status: 'not_completed',
        rep1: rep,
        lead_id: ticket?.lead_id || null,
        service_ticket_id: ticket?.id || null,
        summary,
        work_start_date: new Date().toISOString(),
        due_date: dueDate || null,
        manual_created_date: new Date().toISOString(),
      });

      // 2. Link it back on the ticket + log an internal note.
      const note = {
        at: new Date().toISOString(),
        by: currentUser?.full_name || currentUser?.email || 'מנהל שירות',
        text: `שויכה משימת שירות לנציג ${rep}`,
      };
      const notes = Array.isArray(ticket?.service_notes) ? [...ticket.service_notes, note] : [note];
      await base44.entities.SupportTicket.update(ticket.id, {
        service_task_id: task.id,
        service_notes: notes,
      });

      // 3. Best-effort in-app notification for the rep.
      try {
        const repUser = salesUsers.find((u) => u.email === rep);
        if (repUser?.id) {
          await base44.functions.invoke('createNotification', {
            userId: repUser.id,
            type: 'service_task',
            title: 'משימת שירות חדשה',
            message: `פניית שירות #${ticket?.ticket_number || ''} — ${ticket?.customer_name || ''}`,
            link: '/SalesTasks',
            entityType: 'support_ticket',
            entityId: ticket?.id,
          });
        }
      } catch {
        /* notification is best-effort */
      }

      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salesTasks'] });
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['service-ticket', ticket?.id] });
      toast.success('משימת השירות שויכה לנציג');
      onOpenChange(false);
    },
    onError: (err) => {
      console.error('[AssignServiceTaskDialog] failed', err);
      toast.error('שיוך המשימה נכשל');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-rose-500" />
            שיוך משימת שירות לנציג
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>נציג מטפל *</Label>
            <Select value={rep} onValueChange={setRep}>
              <SelectTrigger><SelectValue placeholder="בחר נציג..." /></SelectTrigger>
              <SelectContent>
                {salesUsers.map((u) => (
                  <SelectItem key={u.id} value={u.email}>{u.full_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">המשימה תופיע אצל הנציג ב״משימות מכירה״ בצבע ייעודי של פניית שירות.</p>
          </div>

          <div className="space-y-1.5">
            <Label>תוכן המשימה *</Label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className="resize-none" />
          </div>

          <div className="space-y-1.5">
            <Label>תאריך יעד</Label>
            <DateTimePicker value={dueDate} onChange={setDueDate} placeholder="בחר תאריך" />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button onClick={() => assignMutation.mutate()} disabled={!rep || !summary.trim() || assignMutation.isPending}>
              {assignMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              שייך משימה
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
