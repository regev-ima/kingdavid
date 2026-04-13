import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Phone, PhoneOff, CheckCircle2, XCircle, Clock, Voicemail, PhoneCall, Calendar } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import { Switch } from "@/components/ui/switch";
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';

const CALL_RESULTS = [
  { value: 'answered_positive', label: 'עניתי - חיובי', icon: CheckCircle2, color: 'text-green-600' },
  { value: 'answered_neutral', label: 'עניתי - נייטרלי', icon: Phone, color: 'text-blue-600' },
  { value: 'answered_negative', label: 'עניתי - שלילי', icon: XCircle, color: 'text-orange-600' },
  { value: 'no_answer', label: 'לא ענה', icon: PhoneOff, color: 'text-muted-foreground' },
  { value: 'busy', label: 'תפוס', icon: PhoneCall, color: 'text-amber-600' },
  { value: 'voicemail_left', label: 'השארתי הודעה', icon: Voicemail, color: 'text-primary' },
  { value: 'callback_requested', label: 'ביקש התקשרות חוזרת', icon: Clock, color: 'text-purple-600' },
  { value: 'not_interested', label: 'לא מעוניין', icon: XCircle, color: 'text-red-600' },
];

export default function CallLogger({ lead, salesTask, isOpen, onClose }) {
  const { effectiveUser } = useEffectiveCurrentUser(isOpen);
  const [callStartTime] = useState(new Date());
  const [selectedResult, setSelectedResult] = useState('');
  const [notes, setNotes] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const queryClient = useQueryClient();

  // Auto-enable follow-up for callback_requested
  useEffect(() => {
    if (selectedResult === 'callback_requested' && !createFollowUp) {
      setCreateFollowUp(true);
    }
  }, [selectedResult, createFollowUp]);

  const logCallMutation = useMutation({
    mutationFn: async (callData) => {
      const callLog = await base44.entities.CallLog.create(callData);
      
      // Update first_action_at if not set
      if (!lead.first_action_at) {
        await base44.entities.Lead.update(lead.id, {
          first_action_at: new Date().toISOString(),
          status: 'contacted'
        });
      }

      // Auto WhatsApp for no_answer/busy
      if (callData.call_result === 'no_answer' || callData.call_result === 'busy') {
        setTimeout(async () => {
          await base44.entities.WhatsAppMessageLog.create({
            lead_id: lead.id,
            sales_task_id: salesTask?.id,
            rep_id: callData.rep_id,
            message_type: 'auto',
            template_name: 'no_answer_followup',
            trigger_reason: callData.call_result,
            sent_at: new Date().toISOString(),
            status: 'sent'
          });
        }, 90000); // 90 seconds delay
      }

      // Auto WhatsApp for voicemail
      if (callData.call_result === 'voicemail_left') {
        await base44.entities.WhatsAppMessageLog.create({
          lead_id: lead.id,
          sales_task_id: salesTask?.id,
          rep_id: callData.rep_id,
          message_type: 'auto',
          template_name: 'voicemail_left',
          trigger_reason: 'voicemail_left',
          sent_at: new Date().toISOString(),
          status: 'sent'
        });
      }

      // Create Follow-up Task
      if (callData.create_follow_up && callData.callback_time) {
        await base44.entities.SalesTask.create({
          lead_id: lead.id,
          rep1: callData.rep_id,
          task_type: 'followup',
          task_status: 'not_completed',
          due_date: new Date(callData.callback_time).toISOString(),
          summary: `Follow-up from call: ${callData.call_notes || 'No notes'}`,
          status: lead.status // Keep same status or update if needed
        });
      }

      return callLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['lead', lead.id]);
      queryClient.invalidateQueries(['callLogs']);
      queryClient.invalidateQueries(['callLogs', lead.id]);
      queryClient.invalidateQueries(['communications', lead.id]);
      onClose();
    },
  });

  const handleSubmit = async () => {
    if (!selectedResult) return;

    const callEndTime = new Date();
    const durationSeconds = Math.floor((callEndTime - callStartTime) / 1000);

    await logCallMutation.mutateAsync({
      call_id: `CALL_${Date.now()}`,
      lead_id: lead.id,
      sales_task_id: salesTask?.id,
      rep_id: effectiveUser?.email,
      call_started_at: callStartTime.toISOString(),
      call_ended_at: callEndTime.toISOString(),
      call_duration_seconds: durationSeconds,
      call_direction: 'outbound',
      call_result: selectedResult,
      call_notes: notes,
      callback_time: callbackTime || null,
      create_follow_up: createFollowUp,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-right">רישום שיחה - {lead.full_name}</DialogTitle>
          <DialogDescription className="text-right">
            תיעוד שיחה מ-{format(callStartTime, 'HH:mm')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <Label className="mb-3 block">תוצאת שיחה *</Label>
            <div className="grid grid-cols-2 gap-2">
              {CALL_RESULTS.map((result) => {
                const Icon = result.icon;
                return (
                  <Button
                    key={result.value}
                    variant={selectedResult === result.value ? "default" : "outline"}
                    className={`justify-start gap-2 ${selectedResult === result.value ? '' : result.color}`}
                    onClick={() => setSelectedResult(result.value)}
                  >
                    <Icon className="h-4 w-4" />
                    {result.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 p-3 bg-muted rounded-lg border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label className="cursor-pointer" onClick={() => setCreateFollowUp(!createFollowUp)}>
                  תזמן משימת המשך (פולאפ)
                </Label>
              </div>
              <Switch 
                checked={createFollowUp} 
                onCheckedChange={setCreateFollowUp} 
              />
            </div>

            {createFollowUp && (
              <div className="space-y-2 pt-2 border-t">
                <Label>מתי לחזור ללקוח?</Label>
                <Input
                  type="datetime-local"
                  value={callbackTime}
                  onChange={(e) => setCallbackTime(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>הערות שיחה</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="תקציר השיחה, התנגדויות, הבטחות..."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              ביטול
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedResult || logCallMutation.isPending}
            >
              {logCallMutation.isPending ? 'שומר...' : 'שמור שיחה'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
