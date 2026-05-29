import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowRight, Loader2, ShoppingCart, ShieldCheck, MessageSquare, LifeBuoy, Phone, Mail, Calendar, User, Image as ImageIcon, Clock, MessageSquarePlus, UserPlus, SendHorizonal, CircleDot } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { toast } from 'sonner';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessServiceWorkspace, canManageService } from '@/lib/rbac';
import { getRepDisplayName } from '@/lib/repDisplay';
import {
  REQUEST_TYPE_LABELS, SERVICE_STATUS_OPTIONS, SERVICE_STATUS_LABELS,
  SOURCE_LABELS, SOURCE_CHIP, PRIORITY_LABELS, DIAGNOSTIC_QUESTIONS,
} from '@/constants/serviceOptions';
import ServicePhotoUploader from '@/components/service/ServicePhotoUploader';
import AssignServiceTaskDialog from '@/components/service/AssignServiceTaskDialog';
import SendServiceSmsDialog from '@/components/service/SendServiceSmsDialog';

const QUESTION_LABELS = Object.fromEntries(DIAGNOSTIC_QUESTIONS.map((q) => [q.key, q.label]));

// Per-event-type styling for the handling timeline.
const TIMELINE_META = {
  created:    { Icon: CircleDot,          color: 'text-blue-600',    ring: 'bg-blue-100' },
  sms:        { Icon: SendHorizonal,      color: 'text-indigo-600',  ring: 'bg-indigo-100' },
  customer:   { Icon: User,               color: 'text-violet-600',  ring: 'bg-violet-100' },
  status:     { Icon: Clock,              color: 'text-amber-600',   ring: 'bg-amber-100' },
  assignment: { Icon: UserPlus,           color: 'text-rose-600',    ring: 'bg-rose-100' },
  note:       { Icon: MessageSquarePlus,  color: 'text-slate-500',   ring: 'bg-slate-100' },
};

// Small labelled field used across the details tab.
function Field({ icon: Icon, label, children, ltr }) {
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />}
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate" dir={ltr ? 'ltr' : undefined}>{children || '—'}</p>
      </div>
    </div>
  );
}

// The full service-ticket detail view, shared by the standalone page
// (ServiceRequestDetails) and the in-list popup (ServiceRequestModal). Laid out
// in tabs (פרטים / תמונות / ציר זמן) so there's no long scroll. When `onClose`
// is set we're in a popup — the Dialog supplies its own close button, so we
// only show the back arrow on the standalone page.
export default function ServiceRequestDetailContent({ ticketId, onClose }) {
  const queryClient = useQueryClient();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const canAccess = canAccessServiceWorkspace(effectiveUser);
  const canManage = canManageService(effectiveUser);

  const [note, setNote] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [showSms, setShowSms] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['service-ticket', ticketId],
    queryFn: async () => {
      const res = await base44.entities.SupportTicket.filter({ id: ticketId });
      return res[0] || null;
    },
    enabled: !!ticketId && canAccess,
  });

  const { data: order } = useQuery({
    queryKey: ['service-ticket-order', ticket?.order_id],
    queryFn: async () => {
      const res = await base44.entities.Order.filter({ id: ticket.order_id });
      return res[0] || null;
    },
    enabled: !!ticket?.order_id,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: canAccess,
  });

  const updateMutation = useMutation({
    mutationFn: (patch) => base44.entities.SupportTicket.update(ticketId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
    },
  });

  const changeStatus = (status) => {
    if (!ticket || status === ticket.status) return;
    const label = SERVICE_STATUS_LABELS[status] || status;
    const entry = { at: new Date().toISOString(), by: effectiveUser?.full_name || effectiveUser?.email, text: `הסטטוס שונה ל“${label}”`, type: 'status' };
    const notes = Array.isArray(ticket?.service_notes) ? [...ticket.service_notes, entry] : [entry];
    updateMutation.mutate({ status, service_notes: notes, updated_date: new Date().toISOString() });
  };

  const addNote = () => {
    if (!note.trim()) return;
    const entry = { at: new Date().toISOString(), by: effectiveUser?.full_name || effectiveUser?.email, text: note.trim(), type: 'note' };
    const notes = Array.isArray(ticket?.service_notes) ? [...ticket.service_notes, entry] : [entry];
    updateMutation.mutate({ service_notes: notes }, { onSuccess: () => { setNote(''); toast.success('ההערה נוספה'); } });
  };

  const savePhotos = (urls) => updateMutation.mutate({ photo_urls: urls });

  const timeline = useMemo(() => {
    if (!ticket) return [];
    const events = [];
    if (ticket.created_date) {
      events.push({
        at: ticket.created_date,
        by: ticket.created_by_name || (ticket.opened_by_customer ? 'הלקוח' : (ticket.created_by_rep ? getRepDisplayName(ticket.created_by_rep, users) : '')),
        text: 'הפנייה נפתחה',
        type: 'created',
      });
    }
    if (ticket.public_sent_at) events.push({ at: ticket.public_sent_at, text: 'נשלח קישור SMS ללקוח', type: 'sms' });
    if (ticket.public_submitted_at) events.push({ at: ticket.public_submitted_at, by: 'הלקוח', text: 'הלקוח מילא את טופס הפנייה', type: 'customer' });
    for (const n of (Array.isArray(ticket.service_notes) ? ticket.service_notes : [])) {
      events.push({ at: n.at, by: n.by, text: n.text, type: n.type || 'note' });
    }
    return events.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [ticket, users]);

  if (isLoadingUser || isLoading) return <div className="text-center py-12">טוען...</div>;
  if (!canAccess) return <div className="text-center py-12"><p className="text-muted-foreground">אין הרשאה</p></div>;
  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הפנייה לא נמצאה</p>
        {onClose ? (
          <Button className="mt-4" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('ServiceCenter')}><Button className="mt-4">חזרה למרכז השירות</Button></Link>
        )}
      </div>
    );
  }

  const srcKey = ticket.source || 'agent_manual';
  const answers = ticket.issue_answers && typeof ticket.issue_answers === 'object' ? ticket.issue_answers : {};
  const photos = Array.isArray(ticket.photo_urls) ? ticket.photo_urls : [];
  const isOverdueSla = ticket.sla_due_date && new Date(ticket.sla_due_date) < new Date() && !['resolved', 'closed'].includes(ticket.status);

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 pe-8">
        {!onClose && (
          <Link to={createPageUrl('ServiceCenter')} className="mt-0.5">
            <Button variant="ghost" size="icon"><ArrowRight className="h-5 w-5" /></Button>
          </Link>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-foreground">פנייה #{ticket.ticket_number}</h2>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${SOURCE_CHIP[srcKey] || ''}`}>{SOURCE_LABELS[srcKey] || srcKey}</span>
            {ticket.opened_by_customer && <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">נפתחה ע״י הלקוח</span>}
            {ticket.public_status === 'pending' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">ממתין למילוי הלקוח</span>}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{ticket.subject}</p>
        </div>
      </div>

      {/* ── Toolbar: status + meta (right) · actions (left) ────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">סטטוס</span>
            <Select value={ticket.status} onValueChange={changeStatus}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICE_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <span className="h-5 w-px bg-border hidden sm:block" />
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">עדיפות: {PRIORITY_LABELS[ticket.priority] || ticket.priority}</span>
          {ticket.sla_due_date && (
            <span className={`text-xs inline-flex items-center gap-1 ${isOverdueSla ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
              <Clock className="h-3 w-3" />SLA {format(new Date(ticket.sla_due_date), 'dd/MM HH:mm')}
            </span>
          )}
          <span className="h-5 w-px bg-border hidden sm:block" />
          <span className="text-xs text-muted-foreground">נציג: {ticket.assigned_to ? getRepDisplayName(ticket.assigned_to, users) : '—'}</span>
          {ticket.service_task_id && <span className="text-xs text-emerald-600">✓ שויכה משימה</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSms(true)}>
            <MessageSquare className="h-4 w-4" /> שלח SMS ללקוח
          </Button>
          {canManage && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowAssign(true)}>
              <LifeBuoy className="h-4 w-4" /> שייך משימה
            </Button>
          )}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <Tabs defaultValue="details">
        <TabsList className="bg-white border">
          <TabsTrigger value="details">פרטים</TabsTrigger>
          <TabsTrigger value="photos">
            <ImageIcon className="h-3.5 w-3.5 me-1" /> תמונות{photos.length ? ` (${photos.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <Clock className="h-3.5 w-3.5 me-1" /> ציר זמן
          </TabsTrigger>
        </TabsList>

        {/* Details */}
        <TabsContent value="details" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3">פרטי לקוח</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              <Field icon={User} label="שם">{ticket.customer_name}</Field>
              <Field icon={Phone} label="טלפון" ltr>{ticket.customer_phone}</Field>
              {ticket.customer_email && <Field icon={Mail} label="אימייל" ltr>{ticket.customer_email}</Field>}
              {ticket.product_name && <Field icon={ShoppingCart} label="מוצר">{ticket.product_name}</Field>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {ticket.request_type && <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">{REQUEST_TYPE_LABELS[ticket.request_type]}</span>}
            {ticket.request_type === 'warranty' && (ticket.warranty_years || ticket.complaint_age_months) && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                {ticket.warranty_years ? `${ticket.warranty_years} שנות אחריות` : ''}
                {ticket.complaint_age_months ? ` · תלונה אחרי ${ticket.complaint_age_months} חודשים` : ''}
              </span>
            )}
            {ticket.order_date && <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 inline-flex items-center gap-1"><Calendar className="h-3 w-3" />הוזמן {ticket.order_date}</span>}
          </div>

          {ticket.description && (
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">תיאור הבעיה</p>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
            </div>
          )}

          {Object.keys(answers).length > 0 && (
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">שאלות אבחון</p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(answers).map(([k, v]) => v ? (
                  <div key={k} className="text-sm">
                    <span className="text-muted-foreground">{QUESTION_LABELS[k] || k}: </span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ) : null)}
              </div>
            </div>
          )}

          {order && (
            <div className="rounded-xl border border-border p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-sm"><ShoppingCart className="h-4 w-4" /> הזמנה מקושרת #{order.order_number}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {order.total != null && <span className="text-xs text-muted-foreground">₪{Number(order.total).toLocaleString()}</span>}
                  {Array.isArray(order.tags) && order.tags.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{t}</span>)}
                </div>
                <p className="text-[11px] text-muted-foreground/70 mt-1">פניית שירות אינה עורכת את ההזמנה.</p>
              </div>
              <Link to={createPageUrl('OrderDetails') + `?id=${order.id}`}><Button variant="outline" size="sm">צפה בהזמנה</Button></Link>
            </div>
          )}
        </TabsContent>

        {/* Photos */}
        <TabsContent value="photos" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">תמונות של התלונה / הבעיה במוצר. ניתן לצרף תמונות נוספות.</p>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {photos.map((url, i) => (
                <button key={i} type="button" onClick={() => setLightbox(url)} className="aspect-square rounded-xl overflow-hidden border border-border hover:ring-2 hover:ring-primary/40 transition">
                  <img src={url} alt={`תמונה ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-dashed border-border p-4">
            <ServicePhotoUploader value={photos} onChange={savePhotos} />
          </div>
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-4 space-y-4">
          <div className="flex gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="הוסף הערה / עדכון טיפול..." className="resize-none" />
            <Button onClick={addNote} disabled={!note.trim() || updateMutation.isPending}>הוסף</Button>
          </div>

          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין אירועים.</p>
          ) : (
            <div className="space-y-0">
              {timeline.map((e, i) => {
                const meta = TIMELINE_META[e.type] || TIMELINE_META.note;
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`h-7 w-7 rounded-full flex items-center justify-center ${meta.ring}`}>
                        <meta.Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                      </span>
                      {i < timeline.length - 1 && <span className="w-px flex-1 bg-border my-1" />}
                    </div>
                    <div className="flex-1 pb-4 pt-1">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{e.text}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.by ? `${e.by} · ` : ''}{e.at ? format(new Date(e.at), 'dd/MM/yyyy HH:mm') : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AssignServiceTaskDialog open={showAssign} onOpenChange={setShowAssign} ticket={ticket} currentUser={effectiveUser} />
      <SendServiceSmsDialog open={showSms} onOpenChange={setShowSms} currentUser={effectiveUser} order={order} />

      {lightbox && (
        <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="תמונה" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
