import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageCircle, AlertTriangle } from 'lucide-react';
import { phoneTail } from './useWhatsAppContext';
import { resolveTemplate, sendErrorMessage } from './whatsappHelpers';
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
//
// `ownerUserId` is the quote/order's owning rep (resolved by the caller from
// created_by_rep / rep1 email) — used only as a fallback identity when there's
// no existing chat yet. An admin sending on a rep's behalf (either case) sees
// the same "sent from X's WhatsApp" warning the chat composer shows, and the
// send goes out through that rep's Green API instance, not the admin's own.
export default function WhatsAppSendPdfButton({
  phone, contactName, fileName, currentUser, ensurePdfUrl, ownerUserId, ownerName,
  templateCategory = 'sales', label = 'שלח בוואטסאפ', className = '', size = 'sm', variant = 'outline',
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const tail = phoneTail(phone);
  const hasPhone = !!tail;
  const isAdmin = currentUser?.role === 'admin';

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

  // Who this will actually send AS: the existing chat's owner if one was
  // found (greenApiSend resolves the account from chat_ref regardless of
  // as_user_id), otherwise the quote/order's owning rep.
  const effectiveOwnerId = existingChat?.user_id || ownerUserId || null;
  const sendingAsOther = isAdmin && !!effectiveOwnerId && effectiveOwnerId !== currentUser?.id;

  const { data: ownerUser } = useQuery({
    queryKey: ['wa-send-pdf-owner', effectiveOwnerId],
    queryFn: () => base44.entities.User.filter({ id: effectiveOwnerId }).then((r) => r[0] || null),
    enabled: open && sendingAsOther && !ownerName,
    staleTime: 5 * 60_000,
  });
  const ownerDisplayName = ownerName || ownerUser?.full_name || ownerUser?.email || 'הנציג';

  useEffect(() => {
    if (!open) return;
    const tpl = templates.find((t) => t.category === templateCategory && t.is_active !== false);
    const firstName = (contactName || '').trim().split(/\s+/)[0] || '';
    // {{נציג}} in the caption must be the SENDING rep (the existing chat's
    // owner, else the quote/order's owning rep) — not the logged-in admin.
    // Same rule as the chat composer: the file goes out from the rep's
    // WhatsApp, so it must be signed with the rep's name.
    const sender = sendingAsOther ? ownerUser : currentUser;
    if (tpl) {
      setCaption(resolveTemplate(tpl.body, {
        contactName,
        repName: sender?.full_name || '',
        repPhone: sender?.phone || '',
      }));
    } else {
      setCaption(fallbackCaption(firstName));
    }
  }, [open, templates, templateCategory, contactName, currentUser, sendingAsOther, ownerUser]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const fileUrl = await ensurePdfUrl();
      const payload = existingChat
        ? { action: 'file', chat_ref: existingChat.id, file_url: fileUrl, file_name: fileName, message: caption }
        : {
            action: 'file', phone, file_url: fileUrl, file_name: fileName, message: caption,
            ...(sendingAsOther ? { as_user_id: effectiveOwnerId } : {}),
          };
      const res = await base44.functions.invoke('greenApiSend', payload);
      if (!res?.ok) throw new Error(sendErrorMessage(res?.error));
      return res;
    },
    onSuccess: (res) => {
      toast.success('הקובץ נשלח בוואטסאפ');
      setOpen(false);
      // Refresh the open thread so the just-sent file shows up immediately
      // (both the full chat screen and the lead popup), plus the chat list.
      const ref = res?.chat_ref || existingChat?.id;
      if (ref) {
        queryClient.invalidateQueries({ queryKey: ['wa-messages', ref] });
        queryClient.invalidateQueries({ queryKey: ['lead-wa-messages', ref] });
      }
      queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
      queryClient.invalidateQueries({ queryKey: ['wa-send-pdf-chat'] });
      queryClient.invalidateQueries({ queryKey: ['lead-wa-chat'] });
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
            {sendingAsOther && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                ההודעה תישלח מהוואטסאפ של {ownerDisplayName}
              </p>
            )}
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
