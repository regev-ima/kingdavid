import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MessageSquare, Copy, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { nextTicketNumber, normalizePhone, toInternationalPhone } from '@/constants/serviceOptions';

// Rep-initiated self-service: the rep creates a unique, 24h-valid public_token
// link for a customer. The link is ALWAYS shown for copying / WhatsApp so the
// rep can send it however they like; if a phone is given (and 019 is wired) we
// also fire an SMS automatically. The ticket starts as "pending" and is filled
// in by the customer through the public form.
export default function SendServiceSmsDialog({ open, onOpenChange, currentUser, order, customer }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null); // { link, smsSent }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setName(order?.customer_name || customer?.full_name || '');
      setPhone(order?.customer_phone || customer?.phone || '');
      setResult(null);
      setCopied(false);
    }
  }, [open, order, customer]);

  const buildLink = (token) => `${window.location.origin}/service-request?token=${token}`;
  const buildMessage = (link) =>
    `שלום${name ? ' ' + name : ''}, קיבלנו את בקשתך לפתיחת פנייה לשירות הלקוחות של קינג דיוויד. ` +
    `למילוי הפרטים וצירוף תמונות: ${link}`;

  const sendMutation = useMutation({
    mutationFn: async () => {
      const token = (crypto?.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const recent = await base44.entities.SupportTicket.list('-created_date', 1);
      const ticketNumber = nextTicketNumber(recent[0]?.ticket_number);

      await base44.entities.SupportTicket.create({
        ticket_number: ticketNumber,
        order_id: order?.id || null,
        customer_id: order?.customer_id || customer?.id || null,
        lead_id: order?.lead_id || null,
        customer_name: name || '',
        customer_phone: phone,
        category: 'other',
        priority: 'medium',
        subject: 'פנייה שתיפתח ע״י הלקוח',
        status: 'open',
        source: 'customer_self',
        opened_by_customer: false,
        public_token: token,
        public_status: 'pending',
        public_sent_at: new Date().toISOString(),
        created_by_rep: currentUser?.email || null,
        created_by_name: currentUser?.full_name || null,
        assigned_to: currentUser?.email || null,
      });

      const link = buildLink(token);
      let smsSent = false;
      if (phone) {
        try {
          const res = await base44.functions.invoke('sendSms', { phone, message: buildMessage(link) });
          smsSent = !!res?.ok;
        } catch (err) {
          console.warn('[SendServiceSmsDialog] sendSms failed, falling back to manual link', err);
        }
      }
      return { link, smsSent };
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
      if (data.smsSent) toast.success('הקישור נוצר ונשלח ב-SMS ללקוח');
      else toast.success('הקישור נוצר — העתיקו ושלחו ללקוח בכל אמצעי');
    },
    onError: (err) => {
      console.error('[SendServiceSmsDialog] failed', err);
      toast.error('יצירת הקישור נכשלה');
    },
  });

  const copyLink = async () => {
    if (!result?.link) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('ההעתקה נכשלה');
    }
  };

  const whatsappHref = result
    ? `https://wa.me/${toInternationalPhone(phone)}?text=${encodeURIComponent(buildMessage(result.link))}`
    : '#';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            שליחת קישור לפתיחת פנייה
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              צרו קישור ייחודי לפתיחת פנייה ושלחו אותו ללקוח בכל אמצעי (וואטסאפ / SMS / אימייל).
              הטלפון אופציונלי — אם תזינו אותו וכשתחובר אינטגרציית 019, גם יישלח SMS אוטומטי.
              <span className="block mt-1 font-medium text-foreground/70">הקישור תקף 24 שעות.</span>
            </p>
            <div className="space-y-1.5">
              <Label>שם הלקוח</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם (אופציונלי)" />
            </div>
            <div className="space-y-1.5">
              <Label>טלפון (אופציונלי)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" dir="ltr" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>ביטול</Button>
              <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
                {sendMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                צור קישור
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 text-sm ${result.smsSent ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
              {result.smsSent
                ? '✓ הקישור נוצר ונשלח ב-SMS ללקוח. ניתן גם להעתיק ולשלוח בכל אמצעי.'
                : 'הקישור נוצר — העתיקו ושלחו ללקוח בכל אמצעי (וואטסאפ / SMS / אימייל).'}
              <span className="block mt-1 text-xs opacity-80">הקישור תקף ל-24 שעות.</span>
            </div>

            <div className="space-y-1.5">
              <Label>קישור לטופס</Label>
              <div className="flex gap-2">
                <Input readOnly value={result.link} dir="ltr" className="text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copyLink} title="העתק">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              {normalizePhone(phone).length >= 9 && (
                <a href={whatsappHref} target="_blank" rel="noreferrer" className="flex-1">
                  <Button type="button" variant="outline" className="w-full gap-2">
                    <ExternalLink className="h-4 w-4" /> שלח בוואטסאפ
                  </Button>
                </a>
              )}
              <Button type="button" onClick={() => onOpenChange(false)} className="flex-1">סגור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
