import React, { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageCircle } from 'lucide-react';
import { phoneTail } from './useWhatsAppContext';
import { resolveTemplate } from './whatsappHelpers';
import { useWhatsAppTemplates } from './useWhatsAppTemplates';

function fallbackCaption(firstName) {
  return `היי${firstName ? ` ${firstName}` : ''}, מצורפת הצעת המחיר שלך מקינג דוד 🙏`;
}

// "Send in WhatsApp" for a generated PDF (quote / order) — used from
// QuoteDetails, OrderDetails and (optionally) the chat's CRM context panel.
// Confirms recipient + caption before sending, generates/reuses the PDF on
// confirm, then sends it as a file attachment through greenApiSend. Prefers
// an existing WhatsApp conversation (chat_ref) over a bare phone number when
// one is found, so it lands in the right thread and uses its owning rep's
// account.
export default function WhatsAppSendPdfButton({
  phone, contactName, fileName, currentUser, ensurePdfUrl,
  templateCategory = 'sales', label = 'שלח בוואטסאפ', className = '', size = 'sm', variant = 'outline',
}) {
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const tail = phoneTail(phone);
  const hasPhone = !!tail;

  const { data: templates = [] } = useWhatsAppTemplates();

  const { data: existingChat } = useQuery({
    queryKey: ['wa-send-pdf-chat', tail],
    enabled: open && hasPhone,
    staleTime: 30_000,
    queryFn: async () => {
      const rows = await base44.entities.WhatsAppChat
        .filter({ chat_id: { $regex: tail } }, '-last_message_at', 1)
        .catch(() => []);
      return rows?.[0] || null;
    },
  });

  useEffect(() => {
    if (!open) return;
    const tpl = templates.find((t) => t.category === templateCategory && t.is_active !== false);
    const firstName = (contactName || '').trim().split(/\s+/)[0] || '';
    if (tpl) {
      setCaption(resolveTemplate(tpl.body, {
        contactName, repName: currentUser?.full_name || '', repPhone: currentUser?.phone || '',
      }));
    } else {
      setCaption(fallbackCaption(firstName));
    }
  }, [open, templates, templateCategory, contactName, currentUser]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const fileUrl = await ensurePdfUrl();
      const payload = existingChat
        ? { action: 'file', chat_ref: existingChat.id, file_url: fileUrl, file_name: fileName, message: caption }
        : { action: 'file', phone, file_url: fileUrl, file_name: fileName, message: caption };
      const res = await base44.functions.invoke('greenApiSend', payload);
      if (!res?.ok) throw new Error(res?.error || 'שגיאה');
      return res;
    },
    onSuccess: () => {
      toast.success('הקובץ נשלח בוואטסאפ');
      setOpen(false);
    },
    onError: (err) => toast.error(`השליחה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={`h-8 text-xs [&_svg]:text-green-600 ${className}`}
        disabled={!hasPhone}
        title={hasPhone ? undefined : 'אין מספר טלפון ללקוח'}
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="h-3.5 w-3.5 me-1.5" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>שליחת {fileName} בוואטסאפ</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>נמען</Label>
              <Input value={phone || ''} disabled dir="ltr" />
              {existingChat && <p className="text-[11px] text-muted-foreground">תישלח לשיחה קיימת בצ'אט הוואטסאפ</p>}
            </div>
            <div className="space-y-1.5">
              <Label>שם קובץ</Label>
              <Input value={fileName} disabled dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>הודעה מצורפת</Label>
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              שלח
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
