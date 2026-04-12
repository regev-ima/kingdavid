import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Phone, MessageCircle, Mail, Users, ArrowUp, ArrowDown, Calendar } from "lucide-react";
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';

export default function AddCommunication({ leadId, isOpen, onClose }) {
  const queryClient = useQueryClient();
  const { effectiveUser } = useEffectiveCurrentUser(isOpen);

  const [formData, setFormData] = useState({
    type: 'call',
    direction: 'outbound',
    subject: '',
    content: '',
    outcome: 'sent',
    duration_seconds: 0,
    notes: '',
    create_follow_up: false,
    follow_up_date: '',
  });

  const createCommunicationMutation = useMutation({
    mutationFn: async (data) => {
      // Create communication log
      const log = await base44.entities.CommunicationLog.create({
        type: data.type,
        direction: data.direction,
        subject: data.subject,
        content: data.content,
        outcome: data.outcome,
        duration_seconds: data.duration_seconds,
        notes: data.notes,
        lead_id: leadId,
        rep_id: effectiveUser?.email,
      });

      // Create follow-up task if requested
      if (data.create_follow_up && data.follow_up_date) {
        // Fetch lead to get status
        const leads = await base44.entities.Lead.filter({ id: leadId });
        const lead = leads[0];
        
        await base44.entities.SalesTask.create({
          lead_id: leadId,
          rep1: effectiveUser?.email,
          task_type: 'followup',
          task_status: 'not_completed',
          due_date: new Date(data.follow_up_date).toISOString(),
          summary: `Follow-up: ${data.subject}`,
          status: lead?.status || 'new_lead'
        });
      }

      return log;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['communications', leadId]);
      onClose();
      setFormData({
        type: 'call',
        direction: 'outbound',
        subject: '',
        content: '',
        outcome: 'sent',
        duration_seconds: 0,
        notes: '',
        create_follow_up: false,
        follow_up_date: '',
      });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createCommunicationMutation.mutate(formData);
  };

  const communicationTypes = [
    { value: 'call', label: 'שיחה', icon: Phone, color: 'text-blue-600 bg-blue-50' },
    { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: 'text-green-600 bg-green-50' },
    { value: 'email', label: 'אימייל', icon: Mail, color: 'text-purple-600 bg-purple-50' },
    { value: 'meeting', label: 'פגישה', icon: Users, color: 'text-primary bg-primary/5' },
  ];

  const directions = [
    { value: 'outbound', label: 'יוצא', icon: ArrowUp, color: 'text-green-600 bg-green-50' },
    { value: 'inbound', label: 'נכנס', icon: ArrowDown, color: 'text-blue-600 bg-blue-50' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">הוסף רשומת תקשורת</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground/80">סוג תקשורת *</Label>
              <div className="grid grid-cols-2 gap-2">
                {communicationTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = formData.type === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, type: type.value })}
                      className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
                        isSelected
                          ? 'border-primary/30 bg-gradient-to-br from-primary/5 to-primary/[0.02] shadow-[0_0_0_1px_hsl(var(--primary)/0.2),0_2px_8px_hsl(var(--primary)/0.1)]'
                          : 'border-border hover:border-border/80 bg-white'
                      }`}
                    >
                      <div className={`p-1.5 rounded ${isSelected ? type.color : 'bg-muted text-muted-foreground'}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className={`text-sm font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {type.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {formData.type !== 'meeting' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground/80">כיוון</Label>
                <div className="grid grid-cols-2 gap-2">
                  {directions.map((dir) => {
                    const Icon = dir.icon;
                    const isSelected = formData.direction === dir.value;
                    return (
                      <button
                        key={dir.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, direction: dir.value })}
                        className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
                          isSelected
                            ? 'border-primary/30 bg-gradient-to-br from-primary/5 to-primary/[0.02] shadow-[0_0_0_1px_hsl(var(--primary)/0.2),0_2px_8px_hsl(var(--primary)/0.1)]'
                            : 'border-border hover:border-border/80 bg-white'
                        }`}
                      >
                        <div className={`p-1.5 rounded ${isSelected ? dir.color : 'bg-muted text-muted-foreground'}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className={`text-sm font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {dir.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground/80">נושא</Label>
            <Input
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="לדוגמא: מעקב לאחר הצעת מחיר"
              className="text-right"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground/80">תוכן *</Label>
            <Textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="תאר את התקשורת - מה נאמר, מה התוצאה..."
              rows={4}
              required
              className="text-right resize-none"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground/80">תוצאה</Label>
              <Select
                value={formData.outcome}
                onValueChange={(val) => setFormData({ ...formData, outcome: val })}
              >
                <SelectTrigger className="text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="answered_positive">נענה - חיובי</SelectItem>
                  <SelectItem value="answered_neutral">נענה - ניטרלי</SelectItem>
                  <SelectItem value="answered_negative">נענה - שלילי</SelectItem>
                  <SelectItem value="no_answer">לא נענה</SelectItem>
                  <SelectItem value="voicemail">הותיר הודעה</SelectItem>
                  <SelectItem value="sent">נשלח</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.type === 'call' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground/80">משך שיחה (שניות)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.duration_seconds}
                  onChange={(e) => setFormData({ ...formData, duration_seconds: parseInt(e.target.value) || 0 })}
                  className="text-right"
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground/80">הערות נוספות</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="הערות פנימיות..."
              rows={2}
              className="text-right resize-none"
            />
          </div>

          <div className="space-y-3 p-3 bg-muted rounded-lg border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label className="cursor-pointer" onClick={() => setFormData({ ...formData, create_follow_up: !formData.create_follow_up })}>
                  תזמן משימת המשך (פולאפ)
                </Label>
              </div>
              <Switch 
                checked={formData.create_follow_up} 
                onCheckedChange={(val) => setFormData({ ...formData, create_follow_up: val })} 
              />
            </div>

            {formData.create_follow_up && (
              <div className="space-y-2 pt-2 border-t">
                <Label>מתי לחזור ללקוח?</Label>
                <Input
                  type="datetime-local"
                  value={formData.follow_up_date}
                  onChange={(e) => setFormData({ ...formData, follow_up_date: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="min-w-[100px]">
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={createCommunicationMutation.isPending}
              className="min-w-[100px]"
            >
              {createCommunicationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  שומר...
                </>
              ) : (
                'שמור'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
