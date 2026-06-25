import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly } from '@/lib/rbac';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, MessageCircle, Loader2, Lock, ArrowRight, Phone, Users as UsersIcon,
  Circle, Inbox,
} from 'lucide-react';
import MessageBubble from '@/components/whatsapp/MessageBubble';
import {
  chatStatusMeta, chatTitle, chatInitial, prettyPhone, listTime, dayLabel, colorFromString,
} from '@/components/whatsapp/whatsappHelpers';

const STATUS_FILTERS = [
  { value: 'all', label: 'הכל' },
  { value: 'waiting', label: 'ממתינים' },
  { value: 'answered', label: 'טופלו' },
];

export default function WhatsAppChat() {
  const queryClient = useQueryClient();
  const { getEffectiveUser } = useImpersonation();

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me(), staleTime: 30 * 60 * 1000 });
  const effectiveUser = getEffectiveUser(user);
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [repFilter, setRepFilter] = useState('all');

  // Conversations (RLS scopes: rep → own, admin → all).
  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ['wa-chats'],
    queryFn: () => base44.entities.WhatsAppChat.list('-last_message_at', 500),
    refetchOnWindowFocus: true,
    refetchInterval: 20000, // resilience: refresh even if Realtime is unavailable
  });

  // Admin needs the rep directory to label each conversation + drive the filter.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
    staleTime: 10 * 60 * 1000,
  });
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  // Messages for the open conversation.
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ['wa-messages', selectedId],
    queryFn: () => base44.entities.WhatsAppMessage.filter({ chat_ref: selectedId }, 'msg_timestamp', 1000),
    enabled: !!selectedId,
    refetchInterval: selectedId ? 15000 : false,
  });

  // ── Live updates ──────────────────────────────────────────────────────────
  // RLS applies to realtime too, so a rep only receives their own rows.
  useEffect(() => {
    const channel = supabase
      .channel('wa-chat-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_chats' }, () => {
        queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
        const ref = payload?.new?.chat_ref;
        if (ref) queryClient.invalidateQueries({ queryKey: ['wa-messages', ref] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const filteredChats = useMemo(() => {
    const term = search.trim().toLowerCase();
    return chats.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (isAdmin && repFilter !== 'all' && c.user_id !== repFilter) return false;
      if (term) {
        const hay = `${c.contact_name || ''} ${c.contact_phone || ''} ${c.chat_id || ''} ${c.last_message_text || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [chats, search, statusFilter, repFilter, isAdmin]);

  const selectedChat = useMemo(() => chats.find((c) => c.id === selectedId) || null, [chats, selectedId]);

  const waitingCount = chats.filter((c) => c.status === 'waiting').length;

  // Reps who actually have conversations — for the admin filter dropdown.
  const repsWithChats = useMemo(() => {
    if (!isAdmin) return [];
    const ids = [...new Set(chats.map((c) => c.user_id))];
    return ids.map((id) => usersById[id]).filter(Boolean);
  }, [isAdmin, chats, usersById]);

  return (
    <div dir="rtl" className="h-[calc(100vh-7rem)] min-h-[520px] flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-green-600" />
            צ'אט וואטסאפ
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? 'תיעוד כל שיחות הוואטסאפ של הנציגים' : 'תיעוד שיחות הוואטסאפ שלך'} · תצוגה בלבד
          </p>
        </div>
        {waitingCount > 0 && (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1.5">
            <Circle className="h-2 w-2 fill-current" />
            {waitingCount} ממתינים לתשובה
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0 rounded-xl border bg-card overflow-hidden">
        {/* ── Conversation list ── */}
        <div className={`flex flex-col border-l min-h-0 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-3 space-y-2 border-b bg-muted/30">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש לפי שם / טלפון / תוכן"
                className="pr-9 h-9"
              />
            </div>
            <div className="flex items-center gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    statusFilter === f.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {isAdmin && repsWithChats.length > 0 && (
              <Select value={repFilter} onValueChange={setRepFilter} dir="rtl">
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="כל הנציגים" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הנציגים</SelectItem>
                  {repsWithChats.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.full_name || r.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {chatsLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filteredChats.length === 0 ? (
              <EmptyList isAdmin={isAdmin} hasAny={chats.length > 0} />
            ) : (
              filteredChats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === selectedId}
                  rep={isAdmin ? usersById[chat.user_id] : null}
                  onClick={() => setSelectedId(chat.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Thread ── */}
        <div className={`flex-col min-h-0 bg-[#efeae2]/40 ${selectedId ? 'flex' : 'hidden md:flex'}`}>
          {selectedChat ? (
            <Thread
              chat={selectedChat}
              rep={isAdmin ? usersById[selectedChat.user_id] : null}
              messages={messages}
              loading={msgsLoading}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <MessageCircle className="h-14 w-14 mb-3 opacity-30" />
              <p className="font-medium">בחר שיחה כדי לצפות בהודעות</p>
              <p className="text-sm mt-1">ההודעות מתעדכנות אוטומטית מהוואטסאפ</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatRow({ chat, active, rep, onClick }) {
  const meta = chatStatusMeta(chat.status);
  const title = chatTitle(chat);
  return (
    <button
      onClick={onClick}
      className={`w-full text-right flex items-center gap-3 px-3 py-3 border-b border-r-4 transition-colors ${meta.accent} ${
        active ? 'bg-primary/5' : 'hover:bg-muted/40'
      }`}
    >
      <div className="relative shrink-0">
        <div className={`h-11 w-11 rounded-full flex items-center justify-center text-white font-semibold ${colorFromString(title)}`}>
          {chat.is_group ? <UsersIcon className="h-5 w-5" /> : chatInitial(chat)}
        </div>
        <span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full ring-2 ring-card ${meta.dot}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{title}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">{listTime(chat.last_message_at)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">
            {chat.last_message_direction === 'outgoing' ? 'את/ה: ' : ''}{chat.last_message_text || '—'}
          </span>
          {chat.unread_count > 0 && (
            <span className="shrink-0 bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
              {chat.unread_count}
            </span>
          )}
        </div>
        {rep && (
          <span className="inline-block mt-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            נציג: {rep.full_name || rep.email}
          </span>
        )}
      </div>
    </button>
  );
}

function Thread({ chat, rep, messages, loading, onBack }) {
  const meta = chatStatusMeta(chat.status);
  const title = chatTitle(chat);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, chat.id]);

  // Group messages by day for date separators.
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Thread header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground" aria-label="חזרה">
          <ArrowRight className="h-5 w-5" />
        </button>
        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold ${colorFromString(title)}`}>
          {chat.is_group ? <UsersIcon className="h-4 w-4" /> : chatInitial(chat)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{title}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.chip}`}>{meta.label}</span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Phone className="h-3 w-3" />{prettyPhone(chat.contact_phone || chat.chat_id)}
            {rep && <span className="ms-2">· נציג: {rep.full_name || rep.email}</span>}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
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

      {/* Read-only footer (no composer — the platform never sends) */}
      <div className="border-t bg-muted/40 px-4 py-2.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        תצוגה בלבד — לא ניתן לשלוח הודעות מהמערכת. המסך משקף את הוואטסאפ של הנציג.
      </div>
    </div>
  );
}

function EmptyList({ isAdmin, hasAny }) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 text-muted-foreground h-full">
      <Inbox className="h-12 w-12 mb-3 opacity-30" />
      {hasAny ? (
        <p className="text-sm">אין שיחות שתואמות את הסינון</p>
      ) : isAdmin ? (
        <>
          <p className="font-medium">אין עדיין שיחות</p>
          <p className="text-sm mt-1">חבר את חשבונות ה-Green API של הנציגים במסך "נציגים" ← "נהל נציג" ← "וואטסאפ".</p>
        </>
      ) : (
        <>
          <p className="font-medium">אין עדיין שיחות</p>
          <p className="text-sm mt-1">ודא שחשבון ה-WhatsApp שלך חובר על ידי המנהל.</p>
        </>
      )}
    </div>
  );
}
