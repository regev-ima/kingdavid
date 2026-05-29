import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Loader2, ShoppingCart, ShieldCheck, MessageSquare, LifeBuoy, Phone, Mail, Calendar, User } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { toast } from 'sonner';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessServiceWorkspace, canManageService } from '@/lib/rbac';
import { getRepDisplayName } from '@/lib/repDisplay';
import {
  REQUEST_TYPE_LABELS, SERVICE_STATUS_OPTIONS, SERVICE_STATUS_CHIP, SERVICE_STATUS_LABELS,
  SOURCE_LABELS, SOURCE_CHIP, PRIORITY_LABELS, DIAGNOSTIC_QUESTIONS,
} from '@/constants/serviceOptions';
import AssignServiceTaskDialog from '@/components/service/AssignServiceTaskDialog';
import SendServiceSmsDialog from '@/components/service/SendServiceSmsDialog';

const QUESTION_LABELS = Object.fromEntries(DIAGNOSTIC_QUESTIONS.map((q) => [q.key, q.label]));

export default function ServiceRequestDetails() {
  const queryClient = useQueryClient();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const canAccess = canAccessServiceWorkspace(effectiveUser);
  const canManage = canManageService(effectiveUser);

  const ticketId = new URLSearchParams(window.location.search).get('id');
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

  const changeStatus = (status) => updateMutation.mutate({ status, updated_date: new Date().toISOString() });

  const addNote = () => {
    if (!note.trim()) return;
    const entry = { at: new Date().toISOString(), by: effectiveUser?.full_name || effectiveUser?.email, text: note.trim() };
    const notes = Array.isArray(ticket?.service_notes) ? [...ticket.service_notes, entry] : [entry];
    updateMutation.mutate({ service_notes: notes }, { onSuccess: () => { setNote(''); toast.success('ההערה נוספה'); } });
  };

  if (isLoadingUser || isLoading) return <div className="text-center py-12">טוען...</div>;
  if (!canAccess) return <div className="text-center py-12"><p className="text-muted-foreground">אין הרשאה</p></div>;
  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הפנייה לא נמצאה</p>
        <Link to={createPageUrl('ServiceCenter')}><Button className="mt-4">חזרה למרכז השירות</Button></Link>
      </div>
    );
  }

  const src = ticket.source || 'agent_manual';
  const answers = ticket.issue_answers && typeof ticket.issue_answers === 'object' ? ticket.issue_answers : {};
  const notes = Array.isArray(ticket.service_notes) ? ticket.service_notes : [];

  return (
    <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to={createPageUrl('ServiceCenter')}>
            <Button variant="ghost" size="icon"><ArrowRight className="h-5 w-5" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">פנייה #{ticket.ticket_number}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_CHIP[src] || ''}`}>{SOURCE_LABELS[src] || src}</span>
              {ticket.opened_by_customer && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">נפתחה ע״י הלקוח</span>
              )}
            </div>
            <p className="text-muted-foreground">{ticket.subject}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSms(true)}>
            <MessageSquare className="h-4 w-4" /> שלח SMS ללקוח
          </Button>
          {canManage && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowAssign(true)}>
              <LifeBuoy className="h-4 w-4" /> שייך משימה לנציג
            </Button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: main details */}
        <div className="md:col-span-2 space-y-6">
          {/* Customer + classification */}
          <Card>
            <CardHeader><CardTitle>פרטי הפנייה</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /><span>{ticket.customer_name || '—'}</span></div>
                <div className="flex items-center gap-2" dir="ltr"><Phone className="h-4 w-4 text-muted-foreground" /><span>{ticket.customer_phone || '—'}</span></div>
                {ticket.customer_email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><span>{ticket.customer_email}</span></div>}
                {ticket.product_name && <div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-muted-foreground" /><span>{ticket.product_name}</span></div>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {ticket.request_type && <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">{REQUEST_TYPE_LABELS[ticket.request_type]}</span>}
                {ticket.priority && <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700">עדיפות: {PRIORITY_LABELS[ticket.priority]}</span>}
                {ticket.request_type === 'warranty' && (ticket.warranty_years || ticket.complaint_age_months) && (
                  <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {ticket.warranty_years ? `${ticket.warranty_years} שנות אחריות` : ''}
                    {ticket.complaint_age_months ? ` · תלונה אחרי ${ticket.complaint_age_months} חודשים` : ''}
                  </span>
                )}
                {ticket.order_date && <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 inline-flex items-center gap-1"><Calendar className="h-3 w-3" />הוזמן {ticket.order_date}</span>}
              </div>
              {ticket.description && <p className="text-foreground/80 whitespace-pre-wrap pt-1">{ticket.description}</p>}
            </CardContent>
          </Card>

          {/* Photos */}
          {ticket.photo_urls?.length > 0 && (
            <Card>
              <CardHeader><CardTitle>תמונות מהלקוח ({ticket.photo_urls.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {ticket.photo_urls.map((url, i) => (
                    <button key={i} type="button" onClick={() => setLightbox(url)} className="h-24 w-24 rounded-lg overflow-hidden border border-border hover:ring-2 hover:ring-primary/40">
                      <img src={url} alt={`תמונה ${i + 1}`} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Diagnostic answers */}
          {Object.keys(answers).length > 0 && (
            <Card>
              <CardHeader><CardTitle>שאלות אבחון</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {Object.entries(answers).map(([k, v]) => v ? (
                  <div key={k} className="flex gap-2">
                    <span className="text-muted-foreground min-w-[160px]">{QUESTION_LABELS[k] || k}:</span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ) : null)}
              </CardContent>
            </Card>
          )}

          {/* Linked order (read-only) */}
          {order && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> הזמנה מקושרת</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <p><span className="text-muted-foreground">מספר הזמנה:</span> #{order.order_number}</p>
                {order.total != null && <p><span className="text-muted-foreground">סכום:</span> ₪{Number(order.total).toLocaleString()}</p>}
                {Array.isArray(order.tags) && order.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {order.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{t}</span>)}
                  </div>
                )}
                <Link to={createPageUrl('OrderDetails') + `?id=${order.id}`} className="text-primary text-xs hover:underline inline-block pt-1">צפה בהזמנה ←</Link>
                <p className="text-[11px] text-muted-foreground/70">פניית שירות אינה עורכת את ההזמנה.</p>
              </CardContent>
            </Card>
          )}

          {/* Internal notes */}
          <Card>
            <CardHeader><CardTitle>הערות פנימיות</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="הוסף הערה פנימית..." className="resize-none" />
                <Button onClick={addNote} disabled={!note.trim() || updateMutation.isPending}>הוסף</Button>
              </div>
              <div className="space-y-2">
                {notes.length === 0 && <p className="text-sm text-muted-foreground">אין הערות עדיין.</p>}
                {[...notes].reverse().map((n, i) => (
                  <div key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
                      <span>{n.by}</span>
                      <span>{n.at ? format(new Date(n.at), 'dd/MM/yyyy HH:mm') : ''}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{n.text}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: status + meta */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>סטטוס</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {ticket.public_status === 'pending' && (
                <div className="rounded-lg bg-violet-50 border border-violet-200 text-violet-800 text-xs px-3 py-2">
                  נשלח קישור ללקוח — ממתין שימלא את הטופס.
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${SERVICE_STATUS_CHIP[ticket.status] || ''}`}>{SERVICE_STATUS_LABELS[ticket.status] || ticket.status}</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">שנה סטטוס</Label>
                <Select value={ticket.status} onValueChange={changeStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>מידע</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">נפתחה ע״י</span><span>{ticket.created_by_name || (ticket.created_by_rep ? getRepDisplayName(ticket.created_by_rep, users) : ticket.opened_by_customer ? 'הלקוח' : '—')}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">נציג מטפל</span><span>{ticket.assigned_to ? getRepDisplayName(ticket.assigned_to, users) : '—'}</span></div>
              {ticket.sla_due_date && <div className="flex justify-between"><span className="text-muted-foreground">יעד SLA</span><span>{format(new Date(ticket.sla_due_date), 'dd/MM HH:mm')}</span></div>}
              {ticket.created_date && <div className="flex justify-between"><span className="text-muted-foreground">נוצר</span><span>{format(new Date(ticket.created_date), 'dd/MM/yyyy')}</span></div>}
              {ticket.service_task_id && <div className="text-xs text-emerald-600">✓ שויכה משימה לנציג</div>}
            </CardContent>
          </Card>
        </div>
      </div>

      <AssignServiceTaskDialog open={showAssign} onOpenChange={setShowAssign} ticket={ticket} currentUser={effectiveUser} />
      <SendServiceSmsDialog open={showSms} onOpenChange={setShowSms} currentUser={effectiveUser} order={order} />

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="תמונה" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
