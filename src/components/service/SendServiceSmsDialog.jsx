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

// Rep-initiated self-service: the rep types the customer's phone, we create a
// "pending" ticket carrying an opaque public_token, send the customer an SMS
// (via 019) with a link to the public intake form, and ALWAYS show a copyable
// link + WhatsApp button as a fallback (e.g. before 019 is configured).
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
      try {
        const res = await base44.functions.invoke('sendSms', { phone, message: buildMessage(link) });
        smsSent = !!res?.ok;
      } catch (err) {
        console.warn('[SendServiceSmsDialog] sendSms failed, falling back to manual link', err);
      }
      return { link, smsSent };
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
      if (data.smsSent) toast.success('נשלח SMS ללקוח עם קישור לפתיחת פנייה');
      else toast('הקישור נוצר — ניתן לשלוח ללקוח ידנית', { description: 'אינטגרציית ה-SMS אינה מוגדרת או שהשליחה נכשלה' });
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

  const phoneValid = normalizePhone(phone).length >= 9;

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
              הזן את מספר הטלפון של הלקוח. תישלח אליו הודעת SMS עם קישור למילוי טופס פניית השירות בעצמו.
            </p>
            <div className="space-y-1.5">
              <Label>שם הלקוח</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם (אופציונלי)" />
            </div>
            <div className="space-y-1.5">
              <Label>טלפון *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" dir="ltr" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>ביטול</Button>
              <Button onClick={() => sendMutation.mutate()} disabled={!phoneValid || sendMutation.isPending}>
                {sendMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                שלח קישור
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 text-sm ${result.smsSent ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {result.smsSent
                ? 'נשלח SMS ללקוח עם הקישור לפתיחת הפנייה.'
                : 'ה-SMS לא נשלח אוטומטית (האינטגרציה אינה מוגדרת). שלח את הקישור ללקוח ידנית:'}
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
              <a href={whatsappHref} target="_blank" rel="noreferrer" className="flex-1">
                <Button type="button" variant="outline" className="w-full gap-2">
                  <ExternalLink className="h-4 w-4" /> שלח בוואטסאפ
                </Button>
              </a>
              <Button type="button" onClick={() => onOpenChange(false)} className="flex-1">סגור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
