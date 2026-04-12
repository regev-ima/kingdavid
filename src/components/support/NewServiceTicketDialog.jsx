import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertTriangle, Clock } from "lucide-react";
import { addHours, differenceInDays } from 'date-fns';

const WARRANTY_ISSUE_LABELS = {
  mattress_sag: 'שקיעה במזרן',
  spring_defect: 'תקלת קפיצים',
  fabric_tear: 'קריעת בד',
  stitching_issue: 'בעיית תפרים',
  frame_damage: 'נזק לשלדה',
  mechanism_failure: 'תקלת מנגנון',
  stain_defect: 'כתם/פגם מיצרן',
  other: 'אחר',
};

const SLA_HOURS = { urgent: 4, high: 24, medium: 48, low: 72 };

export default function NewServiceTicketDialog({ open, onOpenChange, order, currentUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const trialInfo = useMemo(() => {
    if (!order?.trial_30d_enabled) return { isInTrial: false, daysLeft: null };
    if (!order.trial_start_date || !order.trial_end_date) return { isInTrial: false, daysLeft: null };
    const now = new Date();
    const end = new Date(order.trial_end_date);
    const daysLeft = differenceInDays(end, now);
    return { isInTrial: daysLeft >= 0, daysLeft: Math.max(0, daysLeft) };
  }, [order]);

  const [formData, setFormData] = useState({
    category: trialInfo.isInTrial ? 'trial' : 'warranty',
    priority: trialInfo.isInTrial ? 'high' : 'medium',
    subject: '',
    description: '',
    warranty_issue_type: '',
    is_within_trial: trialInfo.isInTrial,
  });

  const set = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const tickets = await base44.entities.SupportTicket.list('-created_date', 1);
      const lastNum = tickets[0]?.ticket_number?.replace('TKT', '') || '1000';
      const ticketNumber = `TKT${parseInt(lastNum) + 1}`;
      const slaDue = addHours(new Date(), SLA_HOURS[data.priority]).toISOString();

      return base44.entities.SupportTicket.create({
        ...data,
        ticket_number: ticketNumber,
        order_id: order.id,
        lead_id: order.lead_id || '',
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_email: order.customer_email || '',
        assigned_to: currentUser?.email,
        sla_due_date: slaDue,
        status: 'open',
      });
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries(['tickets']);
      onOpenChange(false);
      navigate(createPageUrl('TicketDetails') + `?id=${ticket.id}`);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>פתיחת קריאת שירות</DialogTitle>
        </DialogHeader>

        {/* Trial period banner */}
        {trialInfo.isInTrial && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-amber-800">
              ההזמנה בתוך תקופת 30 ימי ניסיון – נותרו <strong>{trialInfo.daysLeft} ימים</strong>
            </span>
          </div>
        )}

        {/* Order info summary */}
        <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
          <p><span className="text-muted-foreground">הזמנה:</span> #{order?.order_number}</p>
          <p><span className="text-muted-foreground">לקוח:</span> {order?.customer_name} · {order?.customer_phone}</p>
          <div className="flex gap-2 mt-1">
            {order?.items?.map((item, i) => (
              <Badge key={i} variant="secondary" className="text-xs">{item.name}</Badge>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>סוג פנייה *</Label>
              <Select value={formData.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">ניסיון 30 יום</SelectItem>
                  <SelectItem value="warranty">אחריות</SelectItem>
                  <SelectItem value="quality">איכות</SelectItem>
                  <SelectItem value="delivery">משלוח</SelectItem>
                  <SelectItem value="return">החזרה</SelectItem>
                  <SelectItem value="billing">חיוב</SelectItem>
                  <SelectItem value="other">אחר</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>עדיפות *</Label>
              <Select value={formData.priority} onValueChange={(v) => set('priority', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">נמוך (72 שעות)</SelectItem>
                  <SelectItem value="medium">בינוני (48 שעות)</SelectItem>
                  <SelectItem value="high">גבוה (24 שעות)</SelectItem>
                  <SelectItem value="urgent">דחוף (4 שעות)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Warranty issue type - only show when warranty selected */}
          {formData.category === 'warranty' && (
            <div className="space-y-2">
              <Label>סוג בעיית אחריות</Label>
              <Select value={formData.warranty_issue_type} onValueChange={(v) => set('warranty_issue_type', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר סוג בעיה..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WARRANTY_ISSUE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Trial info - show when trial selected but order is NOT in trial */}
          {formData.category === 'trial' && !trialInfo.isInTrial && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span className="text-red-800">
                שים לב: תקופת 30 ימי הניסיון {order?.trial_30d_enabled ? 'הסתיימה' : 'לא הופעלה'} בהזמנה זו
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label>נושא *</Label>
            <Input
              value={formData.subject}
              onChange={(e) => set('subject', e.target.value)}
              required
              placeholder="תאר את הבעיה בקצרה..."
            />
          </div>

          <div className="space-y-2">
            <Label>תיאור מפורט</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="פרט את הבעיה, מה קרה, מתי..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !formData.subject}>
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
              ) : null}
              פתח קריאת שירות
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}