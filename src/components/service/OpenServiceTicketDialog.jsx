import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Clock, User, UserCheck, X, ShieldCheck, Info, AlertCircle, CheckCircle2 } from 'lucide-react';
import { addHours, differenceInDays } from '@/lib/safe-date-fns';
import ServicePhotoUploader from '@/components/service/ServicePhotoUploader';
import {
  REQUEST_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  SLA_HOURS,
  DIAGNOSTIC_QUESTIONS,
  nextTicketNumber,
  normalizePhone,
} from '@/constants/serviceOptions';

// Rep-facing "open a service ticket" dialog for the new Service Center. A
// richer sibling of the legacy NewServiceTicketDialog (kept untouched): adds
// problem photos, the general/trial/warranty classification, warranty age, and
// the diagnostic questions. Opening a ticket NEVER edits the order — the order
// block here is read-only.
export default function OpenServiceTicketDialog({ open, onOpenChange, order, customer, currentUser, onCreated }) {
  const queryClient = useQueryClient();

  const trialInfo = useMemo(() => {
    if (!order?.trial_30d_enabled || !order.trial_start_date || !order.trial_end_date) {
      return { isInTrial: false, daysLeft: null };
    }
    const daysLeft = differenceInDays(new Date(order.trial_end_date), new Date());
    return { isInTrial: daysLeft >= 0, daysLeft: Math.max(0, daysLeft) };
  }, [order]);

  const initialName = order?.customer_name || customer?.full_name || '';
  const initialPhone = order?.customer_phone || customer?.phone || '';
  const initialEmail = order?.customer_email || customer?.email || '';

  const emptyForm = {
    request_type: trialInfo.isInTrial ? 'trial_30d' : 'general',
    priority: trialInfo.isInTrial ? 'high' : 'medium',
    subject: '',
    description: '',
    product_name: order?.items?.[0]?.name || '',
    warranty_years: '',
    complaint_age_months: '',
    customer_name: initialName,
    customer_phone: initialPhone,
    customer_email: initialEmail,
    customer_id: order?.customer_id || customer?.id || null,
    lead_id: order?.lead_id || null,
    issue_answers: {},
    photo_urls: [],
  };

  const [formData, setFormData] = useState(emptyForm);
  const [error, setError] = useState('');
  const [photosUploading, setPhotosUploading] = useState(false);
  const [confirmNoPhotos, setConfirmNoPhotos] = useState(false);
  const [createdTicket, setCreatedTicket] = useState(null);
  const set = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));
  const setAnswer = (key, value) =>
    setFormData((prev) => ({ ...prev, issue_answers: { ...prev.issue_answers, [key]: value } }));

  // Re-seed the form whenever the dialog (re)opens for a different order/customer.
  useEffect(() => {
    if (open) {
      setFormData(emptyForm);
      setError('');
      setCreatedTicket(null);
      setConfirmNoPhotos(false);
      setPhotosUploading(false);
    }
  }, [open, order?.id, customer?.id]);

  // After a successful create, show the success screen for a moment, then close
  // the popup so the rep lands back on the list (no navigation away).
  useEffect(() => {
    if (!createdTicket) return undefined;
    const t = setTimeout(() => onOpenChange(false), 3500);
    return () => clearTimeout(t);
  }, [createdTicket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Standalone phone lookup (only when there's no order/customer context yet).
  const [debouncedPhone, setDebouncedPhone] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(normalizePhone(formData.customer_phone)), 350);
    return () => clearTimeout(t);
  }, [formData.customer_phone]);

  const lookupEnabled = open && !order && !customer && !formData.customer_id && !formData.lead_id && debouncedPhone.length >= 7;
  const { data: phoneMatches } = useQuery({
    queryKey: ['serviceTicketPhoneLookup', debouncedPhone],
    enabled: lookupEnabled,
    staleTime: 60_000,
    queryFn: async () => {
      const tail = debouncedPhone.slice(-9);
      const pattern = `%${tail}%`;
      const [{ data: customers }, { data: leads }] = await Promise.all([
        base44.supabase.from('customers').select('id, full_name, phone, email').ilike('phone', pattern).limit(5),
        base44.supabase.from('leads').select('id, full_name, phone, email').ilike('phone', pattern).limit(5),
      ]);
      return [
        ...(customers || []).map((r) => ({ kind: 'customer', ...r })),
        ...(leads || []).map((r) => ({ kind: 'lead', ...r })),
      ];
    },
  });
  const matches = phoneMatches || [];

  const applyMatch = (m) => {
    setFormData((prev) => ({
      ...prev,
      customer_name: m.full_name || prev.customer_name,
      customer_email: m.email || prev.customer_email,
      customer_phone: m.phone || prev.customer_phone,
      customer_id: m.kind === 'customer' ? m.id : null,
      lead_id: m.kind === 'lead' ? m.id : null,
    }));
  };

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const recent = await base44.entities.SupportTicket.list('-created_date', 1);
      const ticketNumber = nextTicketNumber(recent[0]?.ticket_number);
      const slaDue = addHours(new Date(), SLA_HOURS[data.priority] || 48).toISOString();

      const payload = {
        ticket_number: ticketNumber,
        order_id: order?.id || null,
        customer_id: data.customer_id || null,
        lead_id: data.lead_id || null,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        customer_email: data.customer_email || '',
        category: data.request_type === 'trial_30d' ? 'trial' : data.request_type === 'warranty' ? 'warranty' : 'other',
        request_type: data.request_type,
        priority: data.priority,
        subject: data.subject,
        description: data.description,
        product_name: data.product_name || '',
        warranty_years: data.warranty_years ? Number(data.warranty_years) : null,
        complaint_age_months: data.complaint_age_months ? Number(data.complaint_age_months) : null,
        issue_answers: data.issue_answers || {},
        photo_urls: data.photo_urls || [],
        status: 'open',
        source: 'agent_manual',
        opened_by_customer: false,
        created_by_rep: currentUser?.email || null,
        created_by_name: currentUser?.full_name || null,
        assigned_to: currentUser?.email || null,
        sla_due_date: slaDue,
      };
      return base44.entities.SupportTicket.create(payload);
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      // Embedded callers can take over (and close); the default flow shows an
      // in-popup success screen that auto-closes, leaving the rep on the list.
      if (onCreated) { onOpenChange(false); onCreated(ticket); return; }
      setCreatedTicket(ticket);
    },
    onError: (err) => {
      console.error('[OpenServiceTicketDialog] create failed', err);
      setError(err?.message || 'פתיחת הפנייה נכשלה');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.customer_name?.trim()) return setError('יש למלא שם לקוח');
    if (!formData.customer_phone?.trim()) return setError('יש למלא טלפון');
    if (!formData.subject?.trim()) return setError('יש למלא נושא');
    if (photosUploading) return setError('יש להמתין לסיום העלאת הקבצים');
    setError('');
    // Nudge the rep to attach evidence — confirm once before opening empty-handed.
    if ((formData.photo_urls?.length || 0) === 0 && !confirmNoPhotos) {
      setConfirmNoPhotos(true);
      return;
    }
    createMutation.mutate(formData);
  };

  const linked = formData.customer_id || formData.lead_id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{createdTicket ? 'הפנייה נפתחה' : 'פתיחת פניית שירות'}</DialogTitle>
        </DialogHeader>

        {createdTicket ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h3 className="text-lg font-bold text-foreground">הפנייה נפתחה בהצלחה!</h3>
            <p className="text-sm text-muted-foreground">פנייה #{createdTicket.ticket_number} נוספה למרכז השירות.</p>
            <p className="text-xs text-muted-foreground">החלון ייסגר אוטומטית…</p>
            <div className="flex justify-center pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>סגירה וחזרה לרשימה</Button>
            </div>
          </div>
        ) : (
        <>
        {trialInfo.isInTrial && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-amber-800">
              ההזמנה בתוך 30 ימי ניסיון — נותרו <strong>{trialInfo.daysLeft} ימים</strong>
            </span>
          </div>
        )}

        {/* Read-only order context — opening a ticket never edits the order. */}
        {order && (
          <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
            <p><span className="text-muted-foreground">הזמנה:</span> #{order.order_number}</p>
            <p><span className="text-muted-foreground">לקוח:</span> {order.customer_name} · {order.customer_phone}</p>
            {order.items?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {order.items.map((item, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{item.name}</Badge>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground/70 pt-1">פתיחת פנייה אינה עורכת את ההזמנה.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer fields (editable only when there's no order context) */}
          {!order && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>שם לקוח *</Label>
                  <Input value={formData.customer_name} onChange={(e) => set('customer_name', e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>טלפון *</Label>
                  <Input
                    value={formData.customer_phone}
                    onChange={(e) => setFormData((p) => ({ ...p, customer_phone: e.target.value, customer_id: null, lead_id: null }))}
                    required
                  />
                </div>
              </div>
              {linked ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 flex items-center justify-between text-sm text-emerald-800">
                  <span className="flex items-center gap-1.5"><UserCheck className="h-4 w-4" />{formData.customer_id ? 'הפנייה משויכת ללקוח קיים' : 'הפנייה משויכת לליד קיים'}</span>
                  <button type="button" onClick={() => setFormData((p) => ({ ...p, customer_id: null, lead_id: null }))} className="text-emerald-700 inline-flex items-center gap-1 text-xs hover:underline">
                    בטל שיוך <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : matches.length > 0 ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 space-y-2">
                  <div className="space-y-0.5">
                    <p className="text-xs text-blue-900 font-semibold flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      נמצאו אנשי קשר עם טלפון דומה
                    </p>
                    <p className="text-[11px] text-blue-700/90">זו הצעה בלבד. הפנייה לא תשויך עד שתבחר/י לשייך אותה.</p>
                  </div>
                  {matches.map((m) => (
                    <div
                      key={`${m.kind}-${m.id}`}
                      className="rounded-md bg-white border border-blue-100 px-2.5 py-2 flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate text-sm font-medium">{m.full_name || '(ללא שם)'}</span>
                        <span className="text-xs text-muted-foreground" dir="ltr">{m.phone}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${m.kind === 'customer' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{m.kind === 'customer' ? 'לקוח' : 'ליד'}</span>
                      </span>
                      <Button type="button" size="sm" className="h-7 shrink-0 gap-1 px-2.5" onClick={() => applyMatch(m)}>
                        <UserCheck className="h-3.5 w-3.5" /> שייך פנייה
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Request type */}
          <div className="space-y-2">
            <Label>סוג הפנייה *</Label>
            <div className="grid grid-cols-3 gap-2">
              {REQUEST_TYPE_OPTIONS.map((opt) => {
                const selected = formData.request_type === opt.value;
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
          {formData.request_type === 'warranty' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> שנות אחריות</Label>
                <Input type="number" min="0" placeholder="למשל 10" value={formData.warranty_years} onChange={(e) => set('warranty_years', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>זמן מאז הרכישה (חודשים)</Label>
                <Input type="number" min="0" placeholder="למשל 36" value={formData.complaint_age_months} onChange={(e) => set('complaint_age_months', e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>עדיפות *</Label>
              <Select value={formData.priority} onValueChange={(v) => set('priority', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label} ({p.slaHours} שעות)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>מוצר</Label>
              <Input value={formData.product_name} onChange={(e) => set('product_name', e.target.value)} placeholder="שם המוצר" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>נושא *</Label>
            <Input value={formData.subject} onChange={(e) => set('subject', e.target.value)} required placeholder="תאר את הבעיה בקצרה" />
          </div>

          <div className="space-y-1.5">
            <Label>תיאור הבעיה</Label>
            <Textarea value={formData.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="פרט את הבעיה" />
          </div>

          {/* Diagnostic questions — same set the customer sees in the public link */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
            <p className="text-sm font-medium">שאלות אבחון</p>
            {DIAGNOSTIC_QUESTIONS.filter((q) => q.key !== 'product').map((q) => (
              <div key={q.key} className="space-y-1">
                <Label className="text-xs">{q.label}</Label>
                {q.type === 'select' ? (
                  <Select value={formData.issue_answers[q.key] || ''} onValueChange={(v) => setAnswer(q.key, v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="בחר..." /></SelectTrigger>
                    <SelectContent>
                      {q.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : q.type === 'textarea' ? (
                  <Textarea rows={2} value={formData.issue_answers[q.key] || ''} onChange={(e) => setAnswer(q.key, e.target.value)} placeholder={q.placeholder} />
                ) : (
                  <Input value={formData.issue_answers[q.key] || ''} onChange={(e) => setAnswer(q.key, e.target.value)} placeholder={q.placeholder} />
                )}
              </div>
            ))}
          </div>

          {/* Photos / short videos */}
          <div className="space-y-1.5">
            <Label>תמונות / סרטון של הבעיה</Label>
            <ServicePhotoUploader
              value={formData.photo_urls}
              onChange={(urls) => { set('photo_urls', urls); if (urls.length) setConfirmNoPhotos(false); }}
              onUploadingChange={setPhotosUploading}
            />
          </div>

          {confirmNoPhotos && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
              <p className="text-amber-800 flex items-start gap-1.5"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> לא צורפו תמונות. תמונות/סרטון עוזרים להבין ולטפל בבעיה מהר יותר — לפתוח בכל זאת?</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => createMutation.mutate(formData)} disabled={createMutation.isPending}>פתח בכל זאת</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmNoPhotos(false)}>הוסף תמונות</Button>
              </div>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button type="submit" disabled={createMutation.isPending || photosUploading}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {photosUploading ? 'ממתין להעלאה…' : 'פתח פנייה'}
            </Button>
          </div>
        </form>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
