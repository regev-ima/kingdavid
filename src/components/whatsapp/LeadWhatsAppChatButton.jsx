import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, MessageCircle, Lock, ExternalLink, Inbox } from 'lucide-react';
import MessageBubble from '@/components/whatsapp/MessageBubble';
import { phoneTail } from '@/components/whatsapp/useWhatsAppContext';
import { chatTitle, prettyPhone, dayLabel } from '@/components/whatsapp/whatsappHelpers';

// Drop-in button for the lead screen: if the lead's phone has a WhatsApp
// conversation (RLS-scoped — the rep's own, or any for admin), it shows a
// "צ'אט וואטסאפ" button that opens the thread in a read-only popup. Renders
// nothing when there's no matching conversation.
export default function LeadWhatsAppChatButton({ phone, name, className = '' }) {
  const [open, setOpen] = useState(false);
  const tail = phoneTail(phone);

  const { data: chat } = useQuery({
    queryKey: ['lead-wa-chat', tail],
    enabled: !!tail,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const rows = await base44.entities.WhatsAppChat
        .filter({ chat_id: { $regex: tail } }, '-last_message_at', 1)
        .catch(() => []);
      return rows?.[0] || null;
    },
  });

  if (!chat) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className={`h-8 text-xs gap-1.5 border-green-300 text-green-700 hover:bg-green-50 ${className}`}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        צ'אט וואטסאפ
        {chat.status === 'waiting' && <span className="h-2 w-2 rounded-full bg-red-500" />}
      </Button>
      <WhatsAppChatDialog chat={chat} open={open} onOpenChange={setOpen} fallbackName={name} />
    </>
  );
}

function WhatsAppChatDialog({ chat, open, onOpenChange, fallbackName }) {
  const bottomRef = useRef(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['lead-wa-messages', chat?.id],
    enabled: open && !!chat?.id,
    queryFn: () => base44.entities.WhatsAppMessage.filter({ chat_ref: chat.id }, 'msg_timestamp', 1000),
    refetchInterval: open ? 15000 : false,
  });

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, open]);

  const grouped = useMemo(() => {
    const out = [];
    let curr = null;
    for (const m of messages) {
      const label = dayLabel(m.msg_timestamp || m.created_date);
      if (label !== curr) { out.push({ type: 'day', label, id: `d-${label}-${m.id}` }); curr = label; }
      out.push({ type: 'msg', message: m, id: m.id });
    }
    return out;
  }, [messages]);

  const title = chatTitle(chat) || fallbackName || 'צ\'אט וואטסאפ';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg h-[80vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-green-600" />
            <span className="truncate">{title}</span>
            <span className="text-xs font-normal text-muted-foreground" dir="ltr">
              {prettyPhone(chat.contact_phone || chat.chat_id)}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2 bg-[#efeae2]/40">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Inbox className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">אין הודעות בשיחה זו עדיין</p>
            </div>
          ) : (
            grouped.map((item) =>
              item.type === 'day' ? (
                <div key={item.id} className="flex justify-center my-3">
                  <span className="text-[11px] bg-white/80 text-slate-500 px-3 py-1 rounded-full shadow-sm">{item.label}</span>
                </div>
              ) : (
                <MessageBubble key={item.id} message={item.message} />
              )
            )
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t bg-muted/40 px-4 py-2.5 flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5" />תצוגה בלבד</span>
          <Link
            to={`${createPageUrl('WhatsAppChat')}?chat=${chat.id}`}
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            פתח במסך מלא <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
