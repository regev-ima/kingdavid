import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  REQUEST_TYPE_OPTIONS, PRIORITY_OPTIONS, DIAGNOSTIC_QUESTIONS, CONTACT_PREFERENCE_OPTIONS,
} from '@/constants/serviceOptions';

// Edit an existing service ticket in place (from inside the ticket view). Covers
// the fields a service manager actually adjusts; status / photos / notes are
// edited directly on the detail screen, and the linked order is never touched.
export default function EditServiceTicketDialog({ open, onOpenChange, ticket, currentUser }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  // Re-seed from the ticket each time the dialog opens.
  useEffect(() => {
    if (open && ticket) {
      setForm({
        request_type: ticket.request_type || 'general',
        priority: ticket.priority || 'medium',
        subject: ticket.subject || '',
        description: ticket.description || '',
        product_name: ticket.product_name || '',
        warranty_years: ticket.warranty_years ?? '',
        complaint_age_months: ticket.complaint_age_months ?? '',
        customer_name: ticket.customer_name || '',
        customer_phone: ticket.customer_phone || '',
        customer_email: ticket.customer_email || '',
        contact_preference: ticket.contact_preference || '',
        issue_answers: ticket.issue_answers && typeof ticket.issue_answers === 'object' ? { ...ticket.issue_answers } : {},
      });
      setError('');
    }
  }, [open, ticket]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setAnswer = (key, value) => setForm((prev) => ({ ...prev, issue_answers: { ...prev.issue_answers, [key]: value } }));

  const saveMutation = useMutation({
    mutationFn: (patch) => base44.entities.SupportTicket.update(ticket.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-ticket', ticket.id] });
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('הפנייה עודכנה');
      onOpenChange(false);
    },
    onError: (err) => {
      console.error('[EditServiceTicketDialog] update failed', err);
      setError(err?.message || 'עדכון הפנייה נכשל');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.customer_name?.trim()) return setError('יש למלא שם לקוח');
    if (!form.customer_phone?.trim()) return setError('יש למלא טלפון');
    if (!form.subject?.trim()) return setError('יש למלא נושא');
    setError('');

    const entry = { at: new Date().toISOString(), by: currentUser?.full_name || currentUser?.email, text: 'פרטי הפנייה עודכנו', type: 'note' };
    const notes = Array.isArray(ticket.service_notes) ? [...ticket.service_notes, entry] : [entry];

    saveMutation.mutate({
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email || '',
      request_type: form.request_type,
      category: form.request_type === 'trial_30d' ? 'trial' : form.request_type === 'warranty' ? 'warranty' : 'other',
      priority: form.priority,
      subject: form.subject,
      description: form.description,
      product_name: form.product_name || '',
      warranty_years: form.warranty_years ? Number(form.warranty_years) : null,
      complaint_age_months: form.complaint_age_months ? Number(form.complaint_age_months) : null,
      contact_preference: form.contact_preference || null,
      issue_answers: form.issue_answers || {},
      service_notes: notes,
      updated_date: new Date().toISOString(),
    });
  };

  if (!form) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת פנייה #{ticket?.ticket_number}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>שם לקוח *</Label>
              <Input value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>טלפון *</Label>
              <Input value={form.customer_phone} onChange={(e) => set('customer_phone', e.target.value)} dir="ltr" className="text-right" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>אימייל</Label>
            <Input value={form.customer_email} onChange={(e) => set('customer_email', e.target.value)} dir="ltr" className="text-right" />
          </div>

          {/* Request type */}
          <div className="space-y-2">
            <Label>סוג הפנייה *</Label>
            <div className="grid grid-cols-3 gap-2">
              {REQUEST_TYPE_OPTIONS.map((opt) => {
                const selected = form.request_type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('request_type', opt.value)}
                    className={`rounded-xl border p-2.5 text-center transition-all ${selected ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border bg-muted/30 hover:bg-muted'}`}
                  >
                    <opt.Icon className={`h-5 w-5 mx-auto ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="text-xs font-medium mt-1.5">{opt.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Warranty extra fields */}
          {form.request_type === 'warranty' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> שנות אחריות</Label>
                <Input type="number" min="0" className="text-right" value={form.warranty_years} onChange={(e) => set('warranty_years', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>זמן מאז הרכישה (חודשים)</Label>
                <Input type="number" min="0" className="text-right" value={form.complaint_age_months} onChange={(e) => set('complaint_age_months', e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>עדיפות *</Label>
              <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>מוצר</Label>
              <Input value={form.product_name} onChange={(e) => set('product_name', e.target.value)} placeholder="שם המוצר" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>נושא *</Label>
            <Input value={form.subject} onChange={(e) => set('subject', e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label>תיאור הבעיה</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} className="text-right" />
          </div>

          {/* Diagnostic answers */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
            <p className="text-sm font-medium">שאלות אבחון</p>
            {DIAGNOSTIC_QUESTIONS.filter((q) => q.key !== 'product').map((q) => (
              <div key={q.key} className="space-y-1">
                <Label className="text-xs">{q.label}</Label>
                {q.type === 'select' ? (
                  <Select value={form.issue_answers[q.key] || ''} onValueChange={(v) => setAnswer(q.key, v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="בחר..." /></SelectTrigger>
                    <SelectContent>
                      {q.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input className="text-right" value={form.issue_answers[q.key] || ''} onChange={(e) => setAnswer(q.key, e.target.value)} placeholder={q.placeholder} />
                )}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>העדפת יצירת קשר</Label>
            <Select value={form.contact_preference} onValueChange={(v) => set('contact_preference', v)}>
              <SelectTrigger><SelectValue placeholder="בחר..." /></SelectTrigger>
              <SelectContent>
                {CONTACT_PREFERENCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              שמירת שינויים
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
