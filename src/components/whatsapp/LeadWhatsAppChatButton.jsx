import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, MessageCircle, ExternalLink, Inbox, Send } from 'lucide-react';
import MessageBubble from '@/components/whatsapp/MessageBubble';
import WhatsAppComposer from '@/components/whatsapp/WhatsAppComposer';
import { phoneTail } from '@/components/whatsapp/useWhatsAppContext';
import { chatTitle, prettyPhone, dayLabel, sendErrorMessage } from '@/components/whatsapp/whatsappHelpers';

// Drop-in button for the lead screen. If the lead's phone already has a
// WhatsApp conversation (RLS-scoped — the rep's own, or any for admin), it
// opens the thread (with a composer to reply) in a popup. If NOT, it offers to
// START a new conversation: the rep types a first message, which is sent
// through their own Green API instance (greenApiSend accepts a bare `phone` and
// creates the chat row server-side), then the fresh thread opens automatically.
// Renders nothing only when there's no phone to message at all.
export default function LeadWhatsAppChatButton({ phone, name, className = '' }) {
  const [threadOpen, setThreadOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const tail = phoneTail(phone);

  const { data: chat, refetch } = useQuery({
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

  if (!tail) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => (chat ? setThreadOpen(true) : setStartOpen(true))}
        className={`h-8 text-xs gap-1.5 border-green-300 text-green-700 hover:bg-green-50 ${className}`}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {chat ? "צ'אט וואטסאפ" : 'שלח וואטסאפ'}
        {chat?.status === 'waiting' && <span className="h-2 w-2 rounded-full bg-red-500" />}
      </Button>

      {chat && (
        <WhatsAppChatDialog chat={chat} open={threadOpen} onOpenChange={setThreadOpen} fallbackName={name} />
      )}

      <StartWhatsAppChatDialog
        phone={phone}
        name={name}
        open={startOpen}
        onOpenChange={setStartOpen}
        onStarted={async () => {
          setStartOpen(false);
          // The chat row now exists server-side — refetch and jump into it so
          // the rep can keep the conversation going without leaving the lead.
          const { data } = await refetch();
          if (data) setThreadOpen(true);
        }}
      />
    </>
  );
}

// Compose-and-send the FIRST message of a brand-new conversation. Sends via the
// caller's own Green API instance (no chat_ref → greenApiSend uses the caller's
// account and creates the chat). Connection/authorization errors come back as
// mapped Hebrew strings from sendErrorMessage.
function StartWhatsAppChatDialog({ phone, name, open, onOpenChange, onStarted }) {
  const [text, setText] = useState('');

  const sendMutation = useMutation({
    mutationFn: async (message) => {
      const res = await base44.functions.invoke('greenApiSend', {
        action: 'text',
        phone,
        message,
      });
      if (!res?.ok) throw new Error(sendErrorMessage(res?.error));
      return res;
    },
    onSuccess: () => {
      setText('');
      toast.success('ההודעה נשלחה');
      onStarted?.();
    },
    onError: (err) => toast.error(`השליחה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const handleSend = () => {
    const message = text.trim();
    if (!message || sendMutation.isPending) return;
    sendMutation.mutate(message);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4 text-green-600" />
            <span className="truncate">שליחת וואטסאפ ל{name || 'לקוח'}</span>
            <span className="text-xs font-normal text-muted-foreground" dir="ltr">
              {prettyPhone(phone)}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            אין עדיין שיחת וואטסאפ עם הלקוח. כתוב/י הודעה כדי לפתוח שיחה חדשה —
            היא תישלח מחשבון הוואטסאפ שלך.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="הקלד/י את ההודעה הראשונה…"
            rows={4}
            autoFocus
            disabled={sendMutation.isPending}
            className="resize-none text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sendMutation.isPending}
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
              className="bg-green-600 hover:bg-green-700 gap-1.5"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              שלח
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WhatsAppChatDialog({ chat, open, onOpenChange, fallbackName }) {
  const bottomRef = useRef(null);
  const { getEffectiveUser } = useImpersonation();
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me(), staleTime: 30 * 60 * 1000 });
  const effectiveUser = getEffectiveUser(user);
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const messagesQueryKey = ['lead-wa-messages', chat?.id];
  const { data: messages = [], isLoading } = useQuery({
    queryKey: messagesQueryKey,
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

        <div className="shrink-0">
          <WhatsAppComposer
            key={chat.id}
            chat={chat}
            currentUser={effectiveUser}
            isAdmin={isAdmin}
            messagesQueryKey={messagesQueryKey}
            contactName={chat.contact_name || fallbackName || ''}
          />
          <div className="border-t px-4 py-1.5 flex items-center justify-end text-xs text-muted-foreground">
            <Link
              to={`${createPageUrl('WhatsAppChat')}?chat=${chat.id}`}
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              פתח במסך מלא <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
