import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Loader2, ShoppingCart, ShieldCheck, MessageSquare, LifeBuoy, Phone, PhoneCall, Mail, Calendar, User, Image as ImageIcon, Clock, MessageSquarePlus, UserPlus, SendHorizonal, CircleDot, MapPin, Repeat, MessageCircle, AlertCircle, Flag } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { toast } from 'sonner';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessServiceWorkspace, canManageService } from '@/lib/rbac';
import { getRepDisplayName } from '@/lib/repDisplay';
import {
  REQUEST_TYPE_OPTIONS, REQUEST_TYPE_LABELS, SERVICE_STATUS_OPTIONS, SERVICE_STATUS_LABELS,
  SOURCE_LABELS, SOURCE_CHIP, PRIORITY_LABELS, DIAGNOSTIC_QUESTIONS,
  CONTACT_PREFERENCE_LABELS, toInternationalPhone,
} from '@/constants/serviceOptions';
import ServicePhotoUploader from '@/components/service/ServicePhotoUploader';
import AssignServiceTaskDialog from '@/components/service/AssignServiceTaskDialog';
import SendServiceSmsDialog from '@/components/service/SendServiceSmsDialog';

const QUESTION_LABELS = Object.fromEntries(DIAGNOSTIC_QUESTIONS.map((q) => [q.key, q.label]));
const REQUEST_TYPE_BY_VALUE = Object.fromEntries(REQUEST_TYPE_OPTIONS.map((o) => [o.value, o]));

// Diagnostic keys surfaced specially in the problem brief, so we don't repeat
// them in the generic "extra answers" list below.
const HANDLED_ANSWER_KEYS = new Set(['product', 'problem_summary', 'problem_area', 'when_started', 'usage', 'notes']);

const PRIORITY_DOT = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-slate-400',
};

// Per-event-type styling for the handling timeline.
const TIMELINE_META = {
  created:    { Icon: CircleDot,          color: 'text-blue-600',    ring: 'bg-blue-100' },
  sms:        { Icon: SendHorizonal,      color: 'text-indigo-600',  ring: 'bg-indigo-100' },
  customer:   { Icon: User,               color: 'text-violet-600',  ring: 'bg-violet-100' },
  status:     { Icon: Clock,              color: 'text-amber-600',   ring: 'bg-amber-100' },
  assignment: { Icon: UserPlus,           color: 'text-rose-600',    ring: 'bg-rose-100' },
  note:       { Icon: MessageSquarePlus,  color: 'text-slate-500',   ring: 'bg-slate-100' },
};

// Short Hebrew "time ago" for the ticket-age tile.
function timeAgoHe(date) {
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `לפני ${Math.max(1, mins)} דק׳`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שע׳`;
  const days = Math.floor(hrs / 24);
  return `לפני ${days} ימים`;
}

// Small labelled field used in the customer card.
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

// One tile in the at-a-glance summary strip.
function StatTile({ icon: Icon, label, tone = 'default', children, sub }) {
  const toneCls = {
    default: 'border-border bg-muted/30',
    red: 'border-red-200 bg-red-50',
    amber: 'border-amber-200 bg-amber-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    blue: 'border-blue-200 bg-blue-50',
    violet: 'border-violet-200 bg-violet-50',
  }[tone] || 'border-border bg-muted/30';
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`}>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</p>
      <div className="text-sm font-semibold mt-1 flex items-center gap-1.5">{children}</div>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// Highlighted diagnostic fact (location / when / usage) — scannable at a glance.
function DiagChip({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/50 border border-border px-2.5 py-1.5 text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

// The full service-ticket detail view, shared by the standalone page
// (ServiceRequestDetails) and the in-list popup (ServiceRequestModal). Built as
// a "smart ticket": an at-a-glance summary strip, a prominent problem brief with
// scannable diagnostics, warranty insight, photos, and the handling timeline —
// so a service manager understands the issue fast. When `onClose` is set we're
// in a popup; the Dialog supplies its own close button.
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

  // ── Derived "smart" bits for the summary strip + warranty insight ──────────
  const rtOpt = REQUEST_TYPE_BY_VALUE[ticket.request_type];
  const RtIcon = rtOpt?.Icon || MessageSquare;
  const rtTone = ticket.request_type === 'warranty' ? 'emerald' : ticket.request_type === 'trial_30d' ? 'amber' : 'default';

  let slaTone = 'default';
  let slaText = '—';
  let slaSub = null;
  if (ticket.sla_due_date) {
    const due = new Date(ticket.sla_due_date);
    const hrsLeft = (due - new Date()) / 3600000;
    slaText = format(due, 'dd/MM HH:mm');
    if (isOverdueSla) { slaTone = 'red'; slaSub = 'באיחור!'; }
    else if (hrsLeft < 6) { slaTone = 'amber'; slaSub = 'מתקרב ליעד'; }
  }

  const warrantyMonths = ticket.warranty_years ? ticket.warranty_years * 12 : null;
  const withinWarranty = warrantyMonths != null && ticket.complaint_age_months != null
    ? ticket.complaint_age_months <= warrantyMonths
    : null;

  // Diagnostic answers not already surfaced as chips/strip.
  const extraAnswers = Object.entries(answers).filter(([k, v]) => v && !HANDLED_ANSWER_KEYS.has(k));
  const intlPhone = toInternationalPhone(ticket.customer_phone);

  return (
    <div className="space-y-5 text-right" dir="rtl">
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

      {/* ── Toolbar: status + owner + actions ──────────────────── */}
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">סטטוס</span>
          <Select value={ticket.status} onValueChange={changeStatus}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SERVICE_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <span className="h-5 w-px bg-border hidden sm:block" />
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />נציג: {ticket.assigned_to ? getRepDisplayName(ticket.assigned_to, users) : '—'}</span>
        {ticket.service_task_id && <span className="text-xs text-emerald-600">✓ שויכה משימה</span>}
        <div className="flex flex-wrap items-center gap-2 ms-auto">
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

      {/* ── At-a-glance summary strip ──────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile icon={Flag} label="סוג פנייה" tone={rtTone}>
          <RtIcon className="h-4 w-4" />{REQUEST_TYPE_LABELS[ticket.request_type] || ticket.request_type || '—'}
        </StatTile>
        <StatTile icon={AlertCircle} label="עדיפות" tone={ticket.priority === 'urgent' ? 'red' : ticket.priority === 'high' ? 'amber' : 'default'}>
          <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[ticket.priority] || 'bg-slate-400'}`} />
          {PRIORITY_LABELS[ticket.priority] || ticket.priority || '—'}
        </StatTile>
        <StatTile icon={Clock} label="יעד טיפול (SLA)" tone={slaTone} sub={slaSub}>{slaText}</StatTile>
        <StatTile icon={User} label="מקור" tone={ticket.opened_by_customer ? 'violet' : 'default'}>{SOURCE_LABELS[srcKey] || srcKey}</StatTile>
        <StatTile icon={Calendar} label="נפתחה" sub={ticket.created_date ? format(new Date(ticket.created_date), 'dd/MM/yyyy') : null}>
          {ticket.created_date ? timeAgoHe(ticket.created_date) : '—'}
        </StatTile>
      </div>

      {/* ── Body: problem + evidence beside the timeline ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          {/* Problem brief — the first thing a manager reads */}
          <div className="rounded-xl border border-border p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><AlertCircle className="h-4 w-4" /></span>
              <h3 className="font-semibold text-foreground">הבעיה</h3>
            </div>
            {answers.problem_summary && <p className="text-sm font-medium text-foreground">{answers.problem_summary}</p>}
            {ticket.description
              ? <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
              : (!answers.problem_summary && <p className="text-sm text-muted-foreground">לא צוין תיאור.</p>)}
            {(answers.problem_area || answers.when_started || answers.usage) && (
              <div className="flex flex-wrap gap-2 pt-1">
                <DiagChip icon={MapPin} label="מיקום" value={answers.problem_area} />
                <DiagChip icon={Clock} label="התחיל" value={answers.when_started} />
                <DiagChip icon={Repeat} label="תדירות" value={answers.usage} />
              </div>
            )}
            {answers.notes && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <span className="text-xs text-muted-foreground">פרטים נוספים: </span>{answers.notes}
              </div>
            )}
            {extraAnswers.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 pt-1">
                {extraAnswers.map(([k, v]) => (
                  <div key={k} className="text-sm">
                    <span className="text-muted-foreground">{QUESTION_LABELS[k] || k}: </span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Warranty insight — in/out of warranty at a glance */}
          {ticket.request_type === 'warranty' && (ticket.warranty_years || ticket.complaint_age_months) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-emerald-900 text-sm">אחריות יצרן</p>
                  {withinWarranty === true && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">בתוך תקופת האחריות</span>}
                  {withinWarranty === false && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 ring-1 ring-red-200">מחוץ לתקופת האחריות</span>}
                </div>
                <p className="text-sm text-emerald-800 mt-0.5">
                  {ticket.warranty_years ? `${ticket.warranty_years} שנות אחריות` : 'אחריות'}
                  {ticket.complaint_age_months ? ` · התלונה התקבלה ${ticket.complaint_age_months} חודשים לאחר הרכישה` : ''}
                </p>
              </div>
            </div>
          )}
          {ticket.request_type === 'trial_30d' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800 font-medium">פנייה במסגרת 30 ימי ניסיון</p>
            </div>
          )}

          {/* Photos — visual evidence */}
          <div className="rounded-xl border border-border p-5 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" /> תמונות{photos.length ? ` (${photos.length})` : ''}
            </p>
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {photos.map((url, i) => (
                  <button key={i} type="button" onClick={() => setLightbox(url)} className="aspect-square rounded-xl overflow-hidden border border-border hover:ring-2 hover:ring-primary/40 transition">
                    <img src={url} alt={`תמונה ${i + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">לא צורפו תמונות.</p>
            )}
            <div className="rounded-xl border border-dashed border-border p-4">
              <ServicePhotoUploader value={photos} onChange={savePhotos} />
            </div>
          </div>

          {/* Customer + quick contact actions */}
          <div className="rounded-xl border border-border p-5">
            <p className="text-xs font-semibold text-muted-foreground mb-3">פרטי לקוח</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              <Field icon={User} label="שם">{ticket.customer_name}</Field>
              <Field icon={Phone} label="טלפון" ltr>{ticket.customer_phone}</Field>
              {ticket.customer_email && <Field icon={Mail} label="אימייל" ltr>{ticket.customer_email}</Field>}
              {ticket.product_name && <Field icon={ShoppingCart} label="מוצר">{ticket.product_name}</Field>}
              {ticket.contact_preference && <Field icon={PhoneCall} label="העדפת יצירת קשר">{CONTACT_PREFERENCE_LABELS[ticket.contact_preference] || ticket.contact_preference}</Field>}
            </div>
            {ticket.customer_phone && (
              <div className="flex flex-wrap gap-2 mt-4">
                <a href={`tel:${ticket.customer_phone}`}>
                  <Button variant="outline" size="sm" className="gap-1.5"><Phone className="h-4 w-4" /> חיוג</Button>
                </a>
                {intlPhone && (
                  <a href={`https://wa.me/${intlPhone}`} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5"><MessageCircle className="h-4 w-4" /> וואטסאפ</Button>
                  </a>
                )}
                {ticket.customer_email && (
                  <a href={`mailto:${ticket.customer_email}`}>
                    <Button variant="outline" size="sm" className="gap-1.5"><Mail className="h-4 w-4" /> אימייל</Button>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Linked order */}
          {order && (
            <div className="rounded-xl border border-border p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-sm"><ShoppingCart className="h-4 w-4" /> הזמנה מקושרת #{order.order_number}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {order.total != null && <span className="text-xs text-muted-foreground">₪{Number(order.total).toLocaleString()}</span>}
                  {ticket.order_date && <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Calendar className="h-3 w-3" />הוזמן {ticket.order_date}</span>}
                  {Array.isArray(order.tags) && order.tags.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{t}</span>)}
                </div>
                <p className="text-[11px] text-muted-foreground/70 mt-1">פניית שירות אינה עורכת את ההזמנה.</p>
              </div>
              <Link to={createPageUrl('OrderDetails') + `?id=${order.id}`}><Button variant="outline" size="sm">צפה בהזמנה</Button></Link>
            </div>
          )}
        </div>

        {/* Side column: handling timeline */}
        <div className="lg:col-span-1 rounded-xl border border-border p-5 space-y-5">
          <p className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> ציר זמן
          </p>
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
                    <div className="flex-1 pb-5 pt-1">
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
        </div>
      </div>

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
