import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import { canAccessAdminOnly } from '@/lib/rbac';
import { normalizeIsraeliPhone } from '@/utils/phoneUtils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, MessageCircle, Loader2, ArrowRight, Phone, Users as UsersIcon,
  Circle, Inbox, Check, UserCheck, UserPlus, CircleUserRound, Timer, BarChart3,
  ChevronUp, ChevronDown, Clock,
} from 'lucide-react';
import MessageBubble from '@/components/whatsapp/MessageBubble';
import WhatsAppComposer from '@/components/whatsapp/WhatsAppComposer';
import WhatsAppContextPanel from '@/components/whatsapp/WhatsAppContextPanel';
import WhatsAppManagerOverview from '@/components/whatsapp/WhatsAppManagerOverview';
import { useWhatsAppContext } from '@/components/whatsapp/useWhatsAppContext';
import OpenServiceTicketDialog from '@/components/service/OpenServiceTicketDialog';
import {
  chatStatusMeta, chatTitle, chatInitial, prettyPhone, listTime, dayLabel, colorFromString,
  formatDuration,
} from '@/components/whatsapp/whatsappHelpers';

function localPhoneDigits(phone) {
  const norm = normalizeIsraeliPhone(phone);
  if (norm && norm.startsWith('972')) return '0' + norm.slice(3);
  return String(phone || '').replace(/\D/g, '');
}

// Urgency colour for how long a customer has been waiting (seconds).
function waitChipClass(seconds) {
  if (seconds < 15 * 60) return 'bg-amber-100 text-amber-700';
  if (seconds < 60 * 60) return 'bg-orange-100 text-orange-700';
  return 'bg-red-600 text-white';
}

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

  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [repFilter, setRepFilter] = useState('all');
  const rootRef = useRef(null);
  const [areaH, setAreaH] = useState(null);
  const { openLead } = useLeadModal();
  const [infoOpen, setInfoOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  // Remember the manager overview open/closed choice. Default: open on wide
  // screens, collapsed on small ones — the cards take real vertical space and
  // on a laptop/low resolution they crowd out the actual chat.
  const [overviewOpen, setOverviewOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('wa-overview-open');
      if (saved !== null) return saved === '1';
    } catch { /* ignore */ }
    return typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
  });
  useEffect(() => {
    try { localStorage.setItem('wa-overview-open', overviewOpen ? '1' : '0'); } catch { /* ignore */ }
  }, [overviewOpen]);
  const [period, setPeriod] = useState('today');
  const [now, setNow] = useState(() => Date.now());

  // Tick every minute so the "waiting for…" timers stay current.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

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

  // The rep's own performance: average reply time over the last 30 days.
  const { data: myStats } = useQuery({
    queryKey: ['wa-my-stats'],
    queryFn: () => base44.entities.WhatsAppRepStats.list(),
    enabled: !!user && !isAdmin,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
  const myAvgSeconds = (!isAdmin && myStats?.[0]?.replies_count > 0) ? myStats[0].avg_response_seconds : null;

  // Per-rep response-time numbers for the manager overview cards.
  const { data: repStatsRows = [] } = useQuery({
    queryKey: ['wa-rep-stats'],
    queryFn: () => base44.entities.WhatsAppRepStats.list(),
    enabled: !!user && isAdmin,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
  const viewStatsById = useMemo(() => Object.fromEntries(repStatsRows.map((r) => [r.user_id, r])), [repStatsRows]);
  const applyRepFilter = (uid, status) => { setRepFilter(uid); setStatusFilter(status || 'all'); };

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

  // CRM context (existing lead/customer/orders/quotes/tickets) for the open chat.
  const contactPhone = selectedChat?.contact_phone || selectedChat?.chat_id || '';
  const ctxQuery = useWhatsAppContext(contactPhone, !!selectedChat);
  const context = ctxQuery.data;
  const ctxHasMatch = !!(context && (
    context.leads.length || context.customers.length || context.orders.length ||
    context.tickets.length || context.quotes.length
  ));
  // Customer object passed to the service-ticket dialog when the contact isn't
  // already linked to an order — prefilled with name + plain-digit phone so the
  // new ticket is findable by phone later.
  const ticketCustomer = context?.customers?.[0] || (selectedChat ? {
    full_name: chatTitle(selectedChat),
    phone: localPhoneDigits(contactPhone),
    email: '',
  } : null);

  const waitingCount = chats.filter((c) => c.status === 'waiting').length;

  // Arriving from the red banner (?focus=waiting) → jump straight to the most
  // recent conversation still waiting for a reply (chats are sorted newest
  // first), so the rep lands on the last message that came in. Clears the param
  // afterwards so it only fires once per click.
  useEffect(() => {
    const focus = searchParams.get('focus');
    const chatParam = searchParams.get('chat');
    if (!focus && !chatParam) return;
    if (chats.length === 0) return;

    let target = null;
    if (chatParam) target = chats.find((c) => c.id === chatParam) || null;
    if (!target && focus === 'waiting') target = chats.find((c) => c.status === 'waiting') || chats[0];
    if (target) setSelectedId(target.id);

    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    next.delete('chat');
    setSearchParams(next, { replace: true });
  }, [chats, searchParams, setSearchParams]);

  // Fit the chat to the viewport so only the panes scroll (no page scroll),
  // robust to the header / impersonation bar / waiting banner. Re-measures on
  // resize and whenever the waiting banner could toggle (waitingCount change).
  useLayoutEffect(() => {
    const measure = () => {
      if (!rootRef.current) return;
      const top = rootRef.current.getBoundingClientRect().top;
      // subtract the wrapping page padding-bottom (p-8 = 32px) so the page
      // itself never scrolls — only the panes inside do.
      setAreaH(Math.max(360, window.innerHeight - top - 32));
    };
    measure();
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 300);
    return () => { window.removeEventListener('resize', measure); clearTimeout(t); };
  }, [waitingCount, chatsLoading]);

  // Mark a conversation as handled (clears the red "waiting" state + banner).
  // Does NOT send anything to WhatsApp — it only updates our internal status.
  const markHandled = useMutation({
    mutationFn: (chatId) => base44.entities.WhatsAppChat.update(chatId, { status: 'answered', unread_count: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-chats'] });
      queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
      toast.success('סומן כטופל');
    },
    onError: (err) => toast.error(`לא ניתן לסמן כטופל: ${err?.message || 'שגיאה'}`),
  });

  // Reps who actually have conversations — for the admin filter dropdown.
  const repsWithChats = useMemo(() => {
    if (!isAdmin) return [];
    const ids = [...new Set(chats.map((c) => c.user_id))];
    return ids.map((id) => usersById[id]).filter(Boolean);
  }, [isAdmin, chats, usersById]);

  return (
    <div ref={rootRef} dir="rtl" style={areaH ? { height: areaH } : undefined} className="min-h-[360px] flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-green-600" />
            צ'אט וואטסאפ
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? 'שיחות הוואטסאפ של כל הנציגים' : 'שיחות הוואטסאפ שלך'} · מחובר ל-Green API
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {myAvgSeconds != null && (
            <Badge variant="secondary" className="gap-1.5">
              <Timer className="h-3.5 w-3.5" />
              זמן תגובה ממוצע: {formatDuration(myAvgSeconds)}
            </Badge>
          )}
          {waitingCount > 0 && (
            <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1.5">
              <Circle className="h-2 w-2 fill-current" />
              {waitingCount} ממתינים לתשובה
            </Badge>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setOverviewOpen((v) => !v)} className="gap-1.5">
              <BarChart3 className="h-4 w-4" />
              מבט-על
              {overviewOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Manager bird's-eye overview — per-rep numbers + click-to-filter */}
      {isAdmin && overviewOpen && (
        <WhatsAppManagerOverview
          chats={chats}
          usersById={usersById}
          viewStatsById={viewStatsById}
          period={period}
          setPeriod={setPeriod}
          now={now}
          activeRep={repFilter === 'all' ? null : repFilter}
          activeStatus={statusFilter}
          onFilter={applyRepFilter}
        />
      )}

      <div className={`flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr] ${selectedChat ? 'xl:grid-cols-[320px_1fr_340px]' : ''} gap-0 rounded-xl border bg-card overflow-hidden`}>
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
                  now={now}
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
              onMarkHandled={() => markHandled.mutate(selectedChat.id)}
              marking={markHandled.isPending}
              onShowInfo={() => setInfoOpen(true)}
              ctxHasMatch={ctxHasMatch}
              ctxLoading={ctxQuery.isLoading}
              currentUser={effectiveUser}
              isAdmin={isAdmin}
              leadName={context?.leads?.[0]?.full_name || context?.customers?.[0]?.full_name || null}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <MessageCircle className="h-14 w-14 mb-3 opacity-30" />
              <p className="font-medium">בחר שיחה כדי לצפות בהודעות</p>
              <p className="text-sm mt-1">ההודעות מתעדכנות אוטומטית מהוואטסאפ</p>
            </div>
          )}
        </div>

        {/* ── CRM context panel (persistent on xl) ── */}
        {selectedChat && (
          <aside className="hidden xl:flex flex-col min-h-0 border-r bg-card overflow-hidden">
            <WhatsAppContextPanel
              phone={contactPhone}
              name={chatTitle(selectedChat)}
              context={context}
              isLoading={ctxQuery.isLoading}
              onOpenLead={openLead}
              onCreateTicket={() => setTicketOpen(true)}
            />
          </aside>
        )}
      </div>

      {/* CRM context as a slide-over on smaller screens */}
      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="left" dir="rtl" className="p-0 w-[340px] sm:w-[380px] flex flex-col">
          <SheetTitle className="sr-only">פרטי לקוח</SheetTitle>
          {selectedChat && (
            <WhatsAppContextPanel
              phone={contactPhone}
              name={chatTitle(selectedChat)}
              context={context}
              isLoading={ctxQuery.isLoading}
              onOpenLead={(id) => { setInfoOpen(false); openLead(id); }}
              onCreateTicket={() => { setInfoOpen(false); setTicketOpen(true); }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Open a service ticket for this contact (reuses the Service Center dialog) */}
      {ticketOpen && (
        <OpenServiceTicketDialog
          open={ticketOpen}
          onOpenChange={setTicketOpen}
          order={context?.orders?.[0] || null}
          customer={ticketCustomer}
          currentUser={user}
          onCreated={() => {
            setTicketOpen(false);
            queryClient.invalidateQueries({ queryKey: ['wa-context'] });
          }}
        />
      )}
    </div>
  );
}

function ChatRow({ chat, active, rep, now, onClick }) {
  const meta = chatStatusMeta(chat.status);
  const title = chatTitle(chat);
  const waitSec = chat.status === 'waiting' && chat.last_message_at
    ? Math.max(0, ((now || Date.now()) - (parseDbTimestamp(chat.last_message_at)?.getTime() ?? (now || Date.now()))) / 1000)
    : null;
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
          {waitSec != null ? (
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${waitChipClass(waitSec)}`}>
              <Clock className="h-2.5 w-2.5" />
              {formatDuration(waitSec)}
            </span>
          ) : chat.unread_count > 0 ? (
            <span className="shrink-0 bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
              {chat.unread_count}
            </span>
          ) : null}
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

function Thread({ chat, rep, messages, loading, onBack, onMarkHandled, marking, onShowInfo, ctxHasMatch, ctxLoading, currentUser, isAdmin, leadName }) {
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
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium truncate">{title}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.chip}`}>{meta.label}</span>
            {!ctxLoading && (
              ctxHasMatch ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-0.5">
                  <UserCheck className="h-3 w-3" />לקוח קיים
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-0.5">
                  <UserPlus className="h-3 w-3" />לקוח חדש
                </span>
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Phone className="h-3 w-3" />{prettyPhone(chat.contact_phone || chat.chat_id)}
            {rep && <span className="ms-2">· נציג: {rep.full_name || rep.email}</span>}
          </p>
        </div>
        {onShowInfo && (
          <Button
            size="sm"
            variant="outline"
            onClick={onShowInfo}
            className="gap-1.5 h-8 text-xs shrink-0 xl:hidden"
          >
            <CircleUserRound className="h-3.5 w-3.5" />
            פרטי לקוח
          </Button>
        )}
        {chat.status === 'waiting' && onMarkHandled && (
          <Button
            size="sm"
            variant="outline"
            onClick={onMarkHandled}
            disabled={marking}
            className="gap-1.5 h-8 text-xs shrink-0 border-green-300 text-green-700 hover:bg-green-50"
          >
            {marking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            סמן כטופל
          </Button>
        )}
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

      <WhatsAppComposer
        key={chat.id}
        chat={chat}
        rep={rep}
        currentUser={currentUser}
        isAdmin={isAdmin}
        messagesQueryKey={['wa-messages', chat.id]}
        contactName={chat.contact_name || leadName || ''}
      />
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
