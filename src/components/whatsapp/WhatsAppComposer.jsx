import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, Lock, AlertTriangle } from 'lucide-react';

const SEND_ERROR_LABELS = {
  not_configured: 'חשבון הוואטסאפ לא מוגדר',
  instance_not_authorized: 'המכשיר לא מאומת ב-Green API',
  rate_limited: 'נשלחו יותר מדי הודעות בדקה האחרונה — נסה שוב עוד רגע',
  chat_not_found: 'השיחה לא נמצאה',
  Forbidden: 'אין הרשאה לשלוח משיחה זו',
  message_required: 'ההודעה ריקה',
  green_send_failed: 'השליחה ל-Green API נכשלה',
};

function sendErrorMessage(err) {
  return SEND_ERROR_LABELS[err] || err || 'שגיאה לא צפויה';
}

// Text composer for a WhatsApp thread — sends through the chat owner's own
// Green API instance via greenApiSend (the browser never sees any Green
// token). Shown to the chat's own rep and to admins (with a warning line when
// sending through someone else's instance); falls back to a locked footer
// when that rep's account isn't connected/authorized yet.
export default function WhatsAppComposer({ chat, rep, currentUserId, isAdmin, messagesQueryKey }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  const isOwner = !!chat?.user_id && chat.user_id === currentUserId;
  const canSend = isOwner || isAdmin;

  // Only fetched when needed for the "sending through X's instance" warning
  // and the caller didn't already hand us the rep object (WhatsAppChat.jsx
  // has it on hand from the users list; the lead popup doesn't).
  const { data: repUser } = useQuery({
    queryKey: ['wa-composer-rep', chat?.user_id],
    queryFn: () => base44.entities.User.filter({ id: chat.user_id }).then((r) => r[0] || null),
    enabled: !rep && isAdmin && !isOwner && !!chat?.user_id,
    staleTime: 5 * 60_000,
  });
  const ownerName = rep?.full_name || rep?.email || repUser?.full_name || repUser?.email || 'הנציג';

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['green-api', chat?.user_id],
    queryFn: () => base44.functions.invoke('greenApiSettings', { action: 'get', user_id: chat.user_id }),
    enabled: !!chat?.user_id && canSend,
    staleTime: 30_000,
  });
  const connected = !!(status?.configured && status?.state === 'authorized');

  // Auto-grow the textarea up to a max height instead of scrolling inside it.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const sendMutation = useMutation({
    mutationFn: async (message) => {
      const res = await base44.functions.invoke('greenApiSend', {
        action: 'text',
        chat_ref: chat.id,
        message,
      });
      if (!res?.ok) throw new Error(sendErrorMessage(res?.error));
      return res;
    },
    onMutate: async (message) => {
      const tempId = `temp-${Math.random().toString(36).slice(2)}`;
      queryClient.setQueryData(messagesQueryKey, (old = []) => [
        ...(old || []),
        {
          id: tempId,
          chat_ref: chat.id,
          direction: 'outgoing',
          message_type: 'text',
          body: message,
          msg_timestamp: new Date().toISOString(),
          _pending: true,
        },
      ]);
      return { tempId };
    },
    onError: (err, message, ctx) => {
      queryClient.setQueryData(messagesQueryKey, (old = []) => (old || []).filter((m) => m.id !== ctx?.tempId));
      setText(message);
      toast.error(`השליחה נכשלה: ${err?.message || 'שגיאה'}`);
    },
    onSuccess: (_res, _message, ctx) => {
      queryClient.setQueryData(messagesQueryKey, (old = []) => (old || []).filter((m) => m.id !== ctx?.tempId));
      queryClient.invalidateQueries({ queryKey: messagesQueryKey });
      queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
    },
  });

  const handleSend = () => {
    const message = text.trim();
    if (!message || sendMutation.isPending) return;
    setText('');
    sendMutation.mutate(message);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!canSend) return null;

  if (!statusLoading && !connected) {
    return (
      <div className="border-t bg-muted/40 px-4 py-2.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        {isOwner
          ? 'חשבון הוואטסאפ שלך לא מחובר — פנה למנהל'
          : `חשבון הוואטסאפ של ${ownerName} לא מחובר`}
      </div>
    );
  }

  return (
    <div className="border-t bg-card px-3 py-2.5 space-y-1.5" dir="rtl">
      {!isOwner && isAdmin && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          ההודעה תישלח מהוואטסאפ של {ownerName}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="הקלד/י הודעה…"
          disabled={statusLoading || sendMutation.isPending}
          rows={1}
          className="min-h-[40px] max-h-[160px] resize-none text-sm"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!text.trim() || sendMutation.isPending || statusLoading}
          className="h-10 w-10 shrink-0 bg-green-600 hover:bg-green-700"
          aria-label="שלח הודעה"
        >
          {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
