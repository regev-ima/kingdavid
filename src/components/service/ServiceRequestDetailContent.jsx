import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowRight, X, Loader2, ShoppingCart, ShieldCheck, MessageSquare, LifeBuoy, Phone, Mail, Calendar, User, Image as ImageIcon, Clock } from 'lucide-react';
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

// Colour of the timeline dot per event type.
const TIMELINE_DOT = {
  created: 'bg-blue-500',
  sms: 'bg-indigo-500',
  customer: 'bg-violet-500',
  status: 'bg-amber-500',
  assignment: 'bg-rose-500',
  note: 'bg-slate-400',
};

// The full service-ticket detail view, shared by the standalone page
// (ServiceRequestDetails) and the in-list popup (ServiceRequestModal). Laid out
// in tabs (פרטים / תמונות / ציר זמן) so there's no long scroll. When `onClose`
// is provided we're inside a popup and the back control closes it.
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

  // Status change is logged to the timeline (service_notes) so the handling
  // history is auditable.
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

  // Unified handling timeline: lifecycle events derived from the ticket +
  // every service_notes entry (notes, status changes, task assignments).
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
    if (ticket.public_submitted_at) events.push({ at: ticket.public_submitted_at, by: 'הלקוח', text: 'הלקוח מילא את הטופס', type: 'customer' });
    for (const n of (Array.isArray(ticket.service_notes) ? ticket.service_notes : [])) {
      events.push({ at: n.at, by: n.by, text: n.text, type: n.type || 'note' });
    }
    return events.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [ticket, users]);

  const BackControl = () =>
    onClose ? (
      <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
    ) : (
      <Link to={createPageUrl('ServiceCenter')}>
        <Button variant="ghost" size="icon"><ArrowRight className="h-5 w-5" /></Button>
      </Link>
    );

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

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BackControl />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">פנייה #{ticket.ticket_number}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_CHIP[srcKey] || ''}`}>{SOURCE_LABELS[srcKey] || srcKey}</span>
              {ticket.opened_by_customer && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">נפתחה ע״י הלקוח</span>
              )}
            </div>
            <p className="text-muted-foreground text-sm truncate">{ticket.subject}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSms(true)}>
            <MessageSquare className="h-4 w-4" /> <span className="hidden sm:inline">שלח SMS ללקוח</span>
          </Button>
          {canManage && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowAssign(true)}>
              <LifeBuoy className="h-4 w-4" /> <span className="hidden sm:inline">שייך משימה</span>
            </Button>
          )}
        </div>
      </div>

      {/* Compact status + meta strip (always visible — no scrolling for the basics) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">סטטוס</span>
          <Select value={ticket.status} onValueChange={changeStatus}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SERVICE_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {ticket.priority && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">עדיפות: {PRIORITY_LABELS[ticket.priority]}</span>}
        {ticket.sla_due_date && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Clock className="h-3 w-3" />SLA {format(new Date(ticket.sla_due_date), 'dd/MM HH:mm')}</span>}
        <span className="text-xs text-muted-foreground">נציג: {ticket.assigned_to ? getRepDisplayName(ticket.assigned_to, users) : '—'}</span>
        {ticket.service_task_id && <span className="text-xs text-emerald-600">✓ שויכה משימה</span>}
        {ticket.public_status === 'pending' && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">ממתין למילוי הלקוח</span>}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList className="bg-white border">
          <TabsTrigger value="details">פרטים</TabsTrigger>
          <TabsTrigger value="photos">
            <ImageIcon className="h-3.5 w-3.5 me-1" /> תמונות{photos.length ? ` (${photos.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="timeline">ציר זמן</TabsTrigger>
        </TabsList>

        {/* ── Details ───────────────────────────────────────────── */}
        <TabsContent value="details" className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /><span>{ticket.customer_name || '—'}</span></div>
            <div className="flex items-center gap-2" dir="ltr"><Phone className="h-4 w-4 text-muted-foreground" /><span>{ticket.customer_phone || '—'}</span></div>
            {ticket.customer_email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><span>{ticket.customer_email}</span></div>}
            {ticket.product_name && <div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-muted-foreground" /><span>{ticket.product_name}</span></div>}
          </div>

          <div className="flex flex-wrap gap-2">
            {ticket.request_type && <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">{REQUEST_TYPE_LABELS[ticket.request_type]}</span>}
            {ticket.request_type === 'warranty' && (ticket.warranty_years || ticket.complaint_age_months) && (
              <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                {ticket.warranty_years ? `${ticket.warranty_years} שנות אחריות` : ''}
                {ticket.complaint_age_months ? ` · תלונה אחרי ${ticket.complaint_age_months} חודשים` : ''}
              </span>
            )}
            {ticket.order_date && <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 inline-flex items-center gap-1"><Calendar className="h-3 w-3" />הוזמן {ticket.order_date}</span>}
          </div>

          {ticket.description && <p className="text-sm text-foreground/80 whitespace-pre-wrap">{ticket.description}</p>}

          {Object.keys(answers).length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">שאלות אבחון</p>
              {Object.entries(answers).map(([k, v]) => v ? (
                <div key={k} className="flex gap-2 text-sm">
                  <span className="text-muted-foreground min-w-[150px]">{QUESTION_LABELS[k] || k}:</span>
                  <span className="font-medium">{String(v)}</span>
                </div>
              ) : null)}
            </div>
          )}

          {order && (
            <div className="rounded-lg border border-border p-3 text-sm space-y-1">
              <p className="flex items-center gap-2 font-medium"><ShoppingCart className="h-4 w-4" /> הזמנה מקושרת #{order.order_number}</p>
              {order.total != null && <p className="text-muted-foreground">סכום: ₪{Number(order.total).toLocaleString()}</p>}
              {Array.isArray(order.tags) && order.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {order.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{t}</span>)}
                </div>
              )}
              <Link to={createPageUrl('OrderDetails') + `?id=${order.id}`} className="text-primary text-xs hover:underline inline-block">צפה בהזמנה ←</Link>
              <p className="text-[11px] text-muted-foreground/70">פניית שירות אינה עורכת את ההזמנה.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Photos ────────────────────────────────────────────── */}
        <TabsContent value="photos" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">תמונות של התלונה / הבעיה במוצר. ניתן לצרף תמונות נוספות.</p>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {photos.map((url, i) => (
                <button key={i} type="button" onClick={() => setLightbox(url)} className="h-28 w-28 rounded-lg overflow-hidden border border-border hover:ring-2 hover:ring-primary/40">
                  <img src={url} alt={`תמונה ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <ServicePhotoUploader value={photos} onChange={savePhotos} />
        </TabsContent>

        {/* ── Timeline ──────────────────────────────────────────── */}
        <TabsContent value="timeline" className="mt-4 space-y-4">
          <div className="flex gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="הוסף הערה / עדכון טיפול..." className="resize-none" />
            <Button onClick={addNote} disabled={!note.trim() || updateMutation.isPending}>הוסף</Button>
          </div>

          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין אירועים.</p>
          ) : (
            <div className="space-y-0">
              {timeline.map((e, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`h-2.5 w-2.5 rounded-full mt-1.5 ${TIMELINE_DOT[e.type] || TIMELINE_DOT.note}`} />
                    {i < timeline.length - 1 && <span className="w-px flex-1 bg-border my-1" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{e.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.by ? `${e.by} · ` : ''}{e.at ? format(new Date(e.at), 'dd/MM/yyyy HH:mm') : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AssignServiceTaskDialog open={showAssign} onOpenChange={setShowAssign} ticket={ticket} currentUser={effectiveUser} />
      <SendServiceSmsDialog open={showSms} onOpenChange={setShowSms} currentUser={effectiveUser} order={order} />

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="תמונה" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
