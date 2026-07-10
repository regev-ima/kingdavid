import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command';
import { Loader2, Send, Lock, AlertTriangle, BookText } from 'lucide-react';
import { useWhatsAppTemplates } from './useWhatsAppTemplates';
import { resolveTemplate, sendErrorMessage } from './whatsappHelpers';

const TEMPLATE_CATEGORIES = [
  { value: 'all', label: 'הכל' },
  { value: 'general', label: 'כללי' },
  { value: 'sales', label: 'מכירות' },
  { value: 'availability', label: 'זמינות' },
  { value: 'service', label: 'שירות' },
];

// Text composer for a WhatsApp thread — sends through the chat owner's own
// Green API instance via greenApiSend (the browser never sees any Green
// token). Shown to the chat's own rep and to admins (with a warning line when
// sending through someone else's instance); falls back to a locked footer
// when that rep's account isn't connected/authorized yet.
//
// Also hosts the template system (E2/E3): a browsable popover of shared
// templates, plus Mac-style text-replacement — typing "/shortcut" followed by
// a space at the start of the message expands it immediately, with a live
// filtered dropdown while the shortcut is being typed.
export default function WhatsAppComposer({ chat, rep, currentUser, isAdmin, messagesQueryKey, contactName }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const textareaRef = useRef(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState('all');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  const currentUserId = currentUser?.id;
  const isOwner = !!chat?.user_id && chat.user_id === currentUserId;
  const canSend = isOwner || isAdmin;

  const { data: templates = [] } = useWhatsAppTemplates();

  const shortcutMap = useMemo(
    () => Object.fromEntries(templates.filter((t) => t.shortcut).map((t) => [t.shortcut, t])),
    [templates],
  );

  const slashResults = useMemo(() => {
    if (!slashOpen) return [];
    const q = slashQuery.toLowerCase();
    return templates
      .filter((t) => (t.shortcut && t.shortcut.toLowerCase().includes(q)) || t.title.toLowerCase().includes(q))
      .slice(0, 6);
  }, [templates, slashOpen, slashQuery]);

  const popoverTemplates = useMemo(
    () => (templateCategory === 'all' ? templates : templates.filter((t) => t.category === templateCategory)),
    [templates, templateCategory],
  );

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

  // The rep whose WhatsApp actually sends this message = the chat's owner.
  // Their details fill {{נציג}} / {{טלפון_נציג}} — NOT the logged-in user's.
  // When an admin sends on a rep's behalf the message goes out from the rep's
  // WhatsApp, so it must be signed with the rep's name, not the manager's.
  const ownerRep = isOwner ? currentUser : (rep || repUser || null);

  const placeholderCtx = useMemo(() => ({
    contactName: contactName || chat?.contact_name || '',
    repName: ownerRep?.full_name || '',
    repPhone: ownerRep?.phone || '',
  }), [contactName, chat?.contact_name, ownerRep?.full_name, ownerRep?.phone]);

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

  const applyTemplate = (template) => {
    if (!template) return;
    setText(resolveTemplate(template.body, placeholderCtx));
    setSlashOpen(false);
    setTemplatesOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleTextChange = (e) => {
    const value = e.target.value;

    // Mac-style auto-expand: "/shortcut" + space, at the very start of the
    // message, is replaced immediately with the resolved template body.
    const expandMatch = value.match(/^\/(\S+)\s$/);
    const expandTemplate = expandMatch && shortcutMap[expandMatch[1]];
    if (expandTemplate) {
      applyTemplate(expandTemplate);
      return;
    }
    setText(value);

    // While the shortcut is still being typed, show a live filtered menu.
    const liveMatch = value.match(/^\/(\S*)$/);
    if (liveMatch) {
      setSlashQuery(liveMatch[1]);
      setSlashOpen(true);
      setSlashIndex(0);
    } else if (slashOpen) {
      setSlashOpen(false);
    }
  };

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
    setSlashOpen(false);
    sendMutation.mutate(message);
  };

  const handleKeyDown = (e) => {
    if (slashOpen && slashResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashResults.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashResults.length) % slashResults.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); applyTemplate(slashResults[slashIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); return; }
    }
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
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setSlashOpen(false)}
            placeholder="הקלד/י הודעה… (נסה /קיצור)"
            disabled={statusLoading || sendMutation.isPending}
            rows={1}
            className="min-h-[40px] max-h-[160px] resize-none text-sm"
          />
          {slashOpen && slashResults.length > 0 && (
            <div className="absolute bottom-full mb-1 inset-x-0 z-20 rounded-lg border bg-popover shadow-lg max-h-56 overflow-y-auto">
              {slashResults.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyTemplate(t); }}
                  className={`w-full text-right px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                    i === slashIndex ? 'bg-accent' : 'hover:bg-muted'
                  }`}
                >
                  <span className="truncate">{t.title}</span>
                  {t.shortcut && <span className="text-[10px] text-muted-foreground shrink-0" dir="ltr">/{t.shortcut}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label="תבניות הודעה"
              title="תבניות הודעה"
            >
              <BookText className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start" dir="rtl">
            <Command>
              <CommandInput placeholder="חיפוש תבנית…" />
              <div className="flex items-center gap-1 px-2 pt-2 pb-1.5 flex-wrap border-b">
                {TEMPLATE_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setTemplateCategory(c.value)}
                    className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                      templateCategory === c.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <CommandList>
                <CommandEmpty>לא נמצאו תבניות</CommandEmpty>
                <CommandGroup>
                  {popoverTemplates.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${t.title} ${t.shortcut || ''}`}
                      onSelect={() => applyTemplate(t)}
                      className="flex-col items-start gap-0.5"
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-sm font-medium truncate">{t.title}</span>
                        {t.shortcut && <span className="text-[10px] text-muted-foreground shrink-0" dir="ltr">/{t.shortcut}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground truncate w-full">{t.body}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

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
