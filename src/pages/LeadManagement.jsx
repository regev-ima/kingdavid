import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import LeadListTable from '@/components/lead/LeadListTable';
import FilterBar from '@/components/shared/FilterBar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import UserAvatar from '@/components/shared/UserAvatar';
import {
  Users, UserPlus, UserCheck, Calendar as CalendarIcon,
  Filter, X as XIcon, Plus, FileSpreadsheet, ArrowRightLeft, Sparkles,
} from 'lucide-react';
import { startOfDay, endOfDay, startOfWeek, startOfMonth, format } from '@/lib/safe-date-fns';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessSalesWorkspace, isFactoryUser } from '@/components/shared/rbac';
import { useCustomStatuses } from '@/hooks/useCustomStatuses';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, SOURCE_LABELS, CLOSED_STATUSES } from '@/constants/leadOptions';
import ImportFromSheets from '@/components/lead/ImportFromSheets';

// State for this page lives mostly in the URL so navigation back from a
// lead-details page restores exactly where the manager left off (filters,
// rep selection, search). Scroll position is restored via sessionStorage,
// keyed by the URL — different filter combinations remember different
// positions independently.
const SCROLL_KEY_PREFIX = 'leadMgmtScroll:';

function fmt(n) { return Number(n || 0).toLocaleString(); }

// Build the filter object that gets handed to base44.entities.Lead.{filter,count}.
// Shared so the row query, the count query, and the KPI queries all stay
// consistent — change one rule here and all three move together.
function buildLeadsQuery({ filters, dateRange, scope, userEmail, isAdmin }) {
  const conditions = [];
  const startDate = dateRange?.from instanceof Date ? dateRange.from : null;
  const endDate = dateRange?.to instanceof Date ? dateRange.to : null;
  const hasRange = startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime());

  if (!isAdmin) {
    conditions.push({ $or: [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }] });
  }
  if (scope === 'unassigned') {
    conditions.push({ $or: [{ rep1: null }, { rep1: '' }] });
  } else if (scope === 'new') {
    // "חדש" = status is still new_lead — covers the rep's brief of
    // "leads that arrived and haven't been engaged".
    conditions.push({ status: 'new_lead' });
  } else if (scope === 'open') {
    conditions.push({ status: { $nin: CLOSED_STATUSES } });
  }
  if (hasRange) {
    conditions.push({ effective_sort_date: { $gte: startDate.toISOString(), $lte: endDate.toISOString() } });
  }
  if (filters.rep && filters.rep !== 'all') {
    conditions.push({ $or: [{ rep1: filters.rep }, { rep2: filters.rep }] });
  }
  if (filters.status && filters.status !== 'all') {
    conditions.push({ status: filters.status });
  }
  if (filters.source && filters.source !== 'all') {
    conditions.push({ source: filters.source });
  }
  if (filters.search) {
    const s = filters.search;
    conditions.push({ $or: [
      { full_name: { $regex: s, $options: 'i' } },
      { phone: { $regex: s, $options: 'i' } },
      { email: { $regex: s, $options: 'i' } },
    ] });
  }
  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

const DATE_PRESETS = [
  { id: 'today',   label: 'היום' },
  { id: 'week',    label: 'השבוע' },
  { id: 'month',   label: 'החודש' },
  { id: 'range',   label: 'טווח...' },
  { id: 'all',     label: 'כל הזמנים' },
];

function resolveDatePreset(id, customRange) {
  const now = new Date();
  switch (id) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'week':  return { from: startOfWeek(now, { weekStartsOn: 0 }), to: endOfDay(now) };
    case 'month': return { from: startOfMonth(now), to: endOfDay(now) };
    case 'range': return customRange?.from && customRange?.to
      ? { from: startOfDay(customRange.from), to: endOfDay(customRange.to) }
      : null;
    case 'all':
    default:      return null;
  }
}

export default function LeadManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getEffectiveUser } = useImpersonation();
  const { customStatuses: customStatusesForFilter } = useCustomStatuses();
  // Clicking a lead opens it as a popup over this table (no navigation),
  // and lastOpenedLeadId keeps that row marked after the popup closes.
  const { openLead, lastOpenedLeadId } = useLeadModal();

  // URL params drive every filter so back-nav from /LeadDetails restores
  // exactly where the manager was. Read once on mount, then writes happen
  // through `updateUrl` below.
  const urlParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [datePresetId, setDatePresetId] = useState(urlParams.get('preset') || 'all');
  const [customRange, setCustomRange] = useState(() => {
    const from = urlParams.get('startDate');
    const to = urlParams.get('endDate');
    return from && to ? { from: new Date(from), to: new Date(to) } : null;
  });
  const [scope, setScope] = useState(urlParams.get('scope') || 'all'); // 'all' | 'new' | 'unassigned' | 'open'
  const [filters, setFilters] = useState({
    search: urlParams.get('search') || '',
    status: urlParams.get('status') || 'all',
    source: urlParams.get('source') || 'all',
    rep: urlParams.get('rep') || 'all',
  });
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [assigningRep, setAssigningRep] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [limit, setLimit] = useState(Number(urlParams.get('limit')) || 100);

  // Reflect the current filter state back into the URL so the browser's
  // back/forward buttons restore it, and so a deep-link to this page
  // can pin to a specific cut. replace: true to avoid creating a new
  // history entry per keystroke in search.
  const updateUrl = useCallback((next) => {
    const params = new URLSearchParams();
    if (next.preset && next.preset !== 'all') params.set('preset', next.preset);
    if (next.range?.from) params.set('startDate', next.range.from.toISOString());
    if (next.range?.to)   params.set('endDate',   next.range.to.toISOString());
    if (next.scope && next.scope !== 'all') params.set('scope', next.scope);
    if (next.filters?.search) params.set('search', next.filters.search);
    if (next.filters?.status && next.filters.status !== 'all') params.set('status', next.filters.status);
    if (next.filters?.source && next.filters.source !== 'all') params.set('source', next.filters.source);
    if (next.filters?.rep && next.filters.rep !== 'all') params.set('rep', next.filters.rep);
    if (next.limit && next.limit !== 100) params.set('limit', String(next.limit));
    const search = params.toString();
    navigate(search ? `${location.pathname}?${search}` : location.pathname, { replace: true });
  }, [navigate, location.pathname]);

  useEffect(() => {
    updateUrl({ preset: datePresetId, range: customRange, scope, filters, limit });
  }, [datePresetId, customRange, scope, filters, limit, updateUrl]);

  // Auth + role
  const [user, setUser] = useState(null);
  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);
  const effectiveUser = getEffectiveUser(user);
  const isAdmin = effectiveUser?.role === 'admin';
  const userEmail = effectiveUser?.email;

  useEffect(() => {
    if (!effectiveUser) return;
    if (!canAccessSalesWorkspace(effectiveUser)) {
      navigate(createPageUrl(isFactoryUser(effectiveUser) ? 'FactoryDashboard' : 'Dashboard'));
    }
  }, [effectiveUser, navigate]);

  // Resolve the active date range from preset + custom selection.
  const dateRange = useMemo(() => resolveDatePreset(datePresetId, customRange), [datePresetId, customRange]);
  const fromIso = dateRange?.from ? dateRange.from.toISOString() : '';
  const toIso = dateRange?.to ? dateRange.to.toISOString() : '';

  // ───────────────────────────────────────────────────────────────
  // KPI tiles: 3 prominent counts that ALL respect the date range.
  // ───────────────────────────────────────────────────────────────
  const { data: kpiCounts = { newCount: 0, unassignedCount: 0, totalCount: 0 } } = useQuery({
    queryKey: ['leadMgmt-kpis', isAdmin, userEmail, fromIso, toIso],
    enabled: !!effectiveUser && !!userEmail,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      const base = (extra) => {
        const conditions = [];
        if (!isAdmin) conditions.push({ $or: [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }] });
        if (fromIso && toIso) conditions.push({ effective_sort_date: { $gte: fromIso, $lte: toIso } });
        if (extra) conditions.push(extra);
        if (conditions.length === 0) return {};
        if (conditions.length === 1) return conditions[0];
        return { $and: conditions };
      };
      const [newCount, unassignedCount, totalCount] = await Promise.all([
        base44.entities.Lead.count(base({ status: 'new_lead' })),
        base44.entities.Lead.count(base({ $or: [{ rep1: null }, { rep1: '' }] })),
        base44.entities.Lead.count(base()),
      ]);
      return { newCount, unassignedCount, totalCount };
    },
  });

  // ───────────────────────────────────────────────────────────────
  // Per-rep workload panel.
  // ───────────────────────────────────────────────────────────────
  const { data: salesReps = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });
  const repsForPanel = useMemo(
    () => salesReps.filter((u) => u.role === 'user' || u.role === 'admin'),
    [salesReps],
  );

  // Per-rep workload via exact COUNT queries. For each rep (and team-wide) we
  // count four buckets that PARTITION every lead assigned to the rep, so they
  // sum to exactly what filtering the list by that rep shows:
  //   • new      – status new_lead
  //   • handling – open but no longer new: hot lead, follow-up before/after
  //                quote, coming to branch, no-answer 1-5, changed direction, …
  //   • won      – deal_closed
  //   • lost     – every other closed status (not-relevant / disqualified / …)
  // Rep match is rep1 OR rep2, mirroring the list filter, so each card's total
  // reconciles with the filter count. COUNTs are exact, indexed, cached and run
  // in parallel; the team is small so the fan-out stays modest, and every count
  // honors the selected date range like the KPI tiles above. (The previous
  // version pulled all open leads and bucketed client-side, but capped at 50k
  // rows with no ordering — so on this 100k+ table it silently zeroed out reps
  // whose leads fell outside the slice.)
  const repEmailsKey = useMemo(
    () => repsForPanel.map((r) => r.email).sort().join(','),
    [repsForPanel],
  );
  const EMPTY_WL = { newCount: 0, handlingCount: 0, wonCount: 0, lostCount: 0 };
  const { data: workloadByRep = { byRep: new Map(), team: EMPTY_WL } } = useQuery({
    queryKey: ['leadMgmt-workload', fromIso, toIso, repEmailsKey],
    enabled: !!effectiveUser && isAdmin && repsForPanel.length > 0,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      const build = (conditions) => {
        const all = [...conditions];
        if (fromIso && toIso) all.push({ effective_sort_date: { $gte: fromIso, $lte: toIso } });
        if (all.length === 0) return {};
        if (all.length === 1) return all[0];
        return { $and: all };
      };
      // Four COUNTs per scope: total, new, won, closed. "handling" and "lost"
      // are derived, so any open status that is neither new nor closed (e.g. a
      // follow-up) still lands in "handling", and the buckets always sum to the
      // total.
      const countsFor = async (repEmail) => {
        const base = repEmail ? [{ $or: [{ rep1: repEmail }, { rep2: repEmail }] }] : [];
        const [total, newCount, wonCount, closedCount] = await Promise.all([
          base44.entities.Lead.count(build(base)),
          base44.entities.Lead.count(build([...base, { status: 'new_lead' }])),
          base44.entities.Lead.count(build([...base, { status: 'deal_closed' }])),
          base44.entities.Lead.count(build([...base, { status: { $in: CLOSED_STATUSES } }])),
        ]);
        return {
          newCount,
          handlingCount: Math.max(0, total - newCount - closedCount),
          wonCount,
          lostCount: Math.max(0, closedCount - wonCount),
        };
      };
      const emails = repsForPanel.map((r) => r.email);
      const [team, ...repResults] = await Promise.all([
        countsFor(null),
        ...emails.map((email) => countsFor(email)),
      ]);
      const byRep = new Map();
      emails.forEach((email, i) => byRep.set(email, repResults[i]));
      return { byRep, team };
    },
  });

  // ───────────────────────────────────────────────────────────────
  // Lead list + filtered count.
  // ───────────────────────────────────────────────────────────────
  const leadsQuery = useMemo(
    () => buildLeadsQuery({ filters, dateRange, scope, userEmail, isAdmin }),
    [filters, dateRange, scope, userEmail, isAdmin],
  );
  const { data: leads = [], isLoading, isFetching } = useQuery({
    queryKey: ['leadMgmt-leads', leadsQuery, limit],
    enabled: !!effectiveUser,
    staleTime: 60_000,
    placeholderData: (prev) => prev, // ← key: don't drop rows on loadMore so the scroll stays put
    queryFn: () => base44.entities.Lead.filter(leadsQuery, '-effective_sort_date', limit),
  });
  const { data: filteredCount = null } = useQuery({
    queryKey: ['leadMgmt-count', leadsQuery],
    enabled: !!effectiveUser,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: () => base44.entities.Lead.count(leadsQuery),
  });

  // ───────────────────────────────────────────────────────────────
  // Infinite-scroll sentinel. Append rows in place without scroll jump.
  // ───────────────────────────────────────────────────────────────
  const hasMore = leads.length >= limit && (filteredCount == null || leads.length < filteredCount);
  const loadMoreRef = useRef(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isFetching) {
          setLimit((prev) => prev + 100);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isFetching]);

  // ───────────────────────────────────────────────────────────────
  // Scroll restoration. Save on every URL change (filter tweak, page
  // exit) keyed by the URL so each filter combo remembers its own
  // position. On mount + after data loads, restore.
  // ───────────────────────────────────────────────────────────────
  const scrollRestored = useRef(false);
  useEffect(() => {
    // Save scroll position before navigating away.
    const handleSave = () => {
      sessionStorage.setItem(SCROLL_KEY_PREFIX + location.search, String(window.scrollY));
    };
    window.addEventListener('beforeunload', handleSave);
    return () => {
      handleSave();
      window.removeEventListener('beforeunload', handleSave);
    };
  }, [location.search]);

  useEffect(() => {
    if (scrollRestored.current) return;
    if (isLoading || leads.length === 0) return;
    const saved = sessionStorage.getItem(SCROLL_KEY_PREFIX + location.search);
    if (saved) {
      // Two RAFs ensure the table has actually painted its rows.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo(0, Number(saved));
        scrollRestored.current = true;
      }));
    } else {
      scrollRestored.current = true;
    }
  }, [isLoading, leads.length, location.search]);

  // ───────────────────────────────────────────────────────────────
  // Bulk reassignment.
  // ───────────────────────────────────────────────────────────────
  const assignLeadsMutation = useMutation({
    mutationFn: async ({ leadIds, repEmail }) => {
      // Sequential so a failure on row N leaves rows 1..N-1 reassigned
      // (rather than half-updated with no observable order). Each row is
      // small (single UPDATE), so the latency cost is acceptable for the
      // 10-50 row batches this UI supports.
      for (const id of leadIds) {
        await base44.entities.Lead.update(id, {
          rep1: repEmail,
          pending_rep_email: null,
          first_action_at: new Date().toISOString(),
        });
      }
    },
    onSuccess: (_, { leadIds, repEmail }) => {
      const repName = salesReps.find((r) => r.email === repEmail)?.full_name || repEmail;
      toast({ title: `${leadIds.length} לידים שויכו ל${repName}` });
      setSelectedLeads([]);
      setAssigningRep('');
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-leads'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-count'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-workload'] });
    },
    onError: (err) => {
      toast({ title: 'שגיאה בשיוך הלידים', description: err?.message || '', variant: 'destructive' });
    },
  });

  // ───────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────
  if (!effectiveUser) return <div className="text-center py-12 text-muted-foreground">טוען...</div>;

  const repNameByEmail = new Map(salesReps.map((u) => [u.email, u.full_name || u.email]));
  // Stable alphabetical order. Sorting by current workload made the cards
  // reshuffle every time the date range changed (the per-rep counts move
  // with the range), which is disorienting — so the order is fixed by name
  // and only the numbers inside each card respond to the range.
  const sortedReps = [...repsForPanel].sort((a, b) =>
    (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'he'),
  );

  const hasActiveFilter = Boolean(filters.search) || filters.status !== 'all' || filters.source !== 'all' || filters.rep !== 'all' || scope !== 'all';

  return (
    <div className="space-y-4" dir="rtl">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            ניהול לידים
          </h1>
          <p className="text-sm text-muted-foreground">תצוגה מקיפה של עומס הצוות, שיוך לידים והעברה בין נציגים</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Button onClick={() => setShowImport(true)} variant="outline" size="sm" className="gap-1.5">
              <FileSpreadsheet className="h-4 w-4" /> ייבוא מ-Sheets
            </Button>
          ) : null}
          <Button onClick={() => navigate(createPageUrl('NewLead'))} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> ליד חדש
          </Button>
        </div>
      </div>

      {/* Date range picker — every number below derives from this */}
      <div className="flex items-center gap-2 flex-wrap bg-card border border-border rounded-xl p-2 shadow-card">
        <span className="text-xs font-medium text-muted-foreground ms-1">טווח זמן:</span>
        {DATE_PRESETS.map((p) => {
          const active = datePresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setDatePresetId(p.id);
                if (p.id !== 'range') setCustomRange(null);
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          );
        })}
        {datePresetId === 'range' ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                <CalendarIcon className="me-1.5 h-3.5 w-3.5" />
                {customRange?.from && customRange?.to
                  ? `${format(customRange.from, 'dd.MM.yy')} - ${format(customRange.to, 'dd.MM.yy')}`
                  : 'בחר טווח'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end" dir="rtl">
              <Calendar mode="range" selected={customRange || undefined} onSelect={setCustomRange} initialFocus />
            </PopoverContent>
          </Popover>
        ) : null}
        {dateRange ? (
          <span className="text-[11px] text-muted-foreground">
            ({format(dateRange.from, 'dd.MM.yy')} – {format(dateRange.to, 'dd.MM.yy')})
          </span>
        ) : null}
      </div>

      {/* 3 KPI tiles — synced to date range, clickable to filter */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { id: 'new',        label: 'לידים חדשים',     value: kpiCounts.newCount,        tone: 'sky',   icon: Sparkles, desc: 'סטטוס "ליד חדש" בטווח' },
          { id: 'unassigned', label: 'לא משויכים',       value: kpiCounts.unassignedCount, tone: 'amber', icon: UserPlus, desc: 'לידים בלי נציג ראשי' },
          { id: 'all',        label: 'כל הלידים בטווח', value: kpiCounts.totalCount,      tone: 'indigo',icon: Users,    desc: 'נכנסו בתקופה שנבחרה' },
        ].map((tile) => {
          const isActive = scope === tile.id;
          const tones = {
            sky:    { active: 'bg-sky-50 border-sky-500 ring-2 ring-sky-400',       value: 'text-sky-700' },
            amber:  { active: 'bg-amber-50 border-amber-500 ring-2 ring-amber-400', value: 'text-amber-700' },
            indigo: { active: 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-400', value: 'text-indigo-700' },
          }[tile.tone];
          const cardCls = isActive ? tones.active : 'border-border bg-muted/30 hover:bg-muted/50';
          const valueCls = isActive ? tones.value : 'text-muted-foreground';
          const Icon = tile.icon;
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => setScope((curr) => (curr === tile.id ? 'all' : tile.id))}
              className={`text-right rounded-xl border-2 p-4 shadow-card transition-all ${cardCls}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <p className={`text-xs font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{tile.label}</p>
                <Icon className={`h-4 w-4 ${valueCls} ${isActive ? 'opacity-100' : 'opacity-50'}`} />
              </div>
              <p className={`text-3xl font-bold tabular-nums ${valueCls}`}>{fmt(tile.value)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{tile.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Rep workload panel — admin only. Click a card to filter list to
          that rep's leads. */}
      {isAdmin ? (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 px-1 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            עומס לפי נציג ({sortedReps.length} בצוות)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {/* "All team" card first */}
            <RepWorkloadCard
              label="כל הצוות"
              avatar={<span className="h-8 w-8 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">כל</span>}
              newCount={workloadByRep.team.newCount}
              handlingCount={workloadByRep.team.handlingCount}
              wonCount={workloadByRep.team.wonCount}
              lostCount={workloadByRep.team.lostCount}
              isActive={filters.rep === 'all'}
              accent="indigo"
              onClick={() => setFilters((f) => ({ ...f, rep: 'all' }))}
            />
            {sortedReps.map((rep) => {
              const wl = workloadByRep.byRep.get(rep.email) || EMPTY_WL;
              return (
                <RepWorkloadCard
                  key={rep.email}
                  label={rep.full_name || rep.email}
                  avatar={<UserAvatar user={rep} size="sm" />}
                  newCount={wl.newCount}
                  handlingCount={wl.handlingCount}
                  wonCount={wl.wonCount}
                  lostCount={wl.lostCount}
                  isActive={filters.rep === rep.email}
                  accent="emerald"
                  onClick={() => setFilters((f) => ({ ...f, rep: f.rep === rep.email ? 'all' : rep.email }))}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Filter bar */}
      <FilterBar
        filters={[
          { key: 'status', label: 'סטטוס', allLabel: 'כל הסטטוסים', options: [...LEAD_STATUS_OPTIONS, ...customStatusesForFilter] },
          { key: 'source', label: 'מקור',  allLabel: 'כל המקורות',  options: LEAD_SOURCE_OPTIONS },
          ...(isAdmin ? [{
            key: 'rep',
            label: 'נציג',
            allLabel: 'כל הנציגים',
            options: repsForPanel.map((r) => ({ value: r.email, label: r.full_name || r.email })),
          }] : []),
        ]}
        values={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', status: 'all', source: 'all', rep: 'all' })}
        searchPlaceholder="חפש לפי שם, טלפון או אימייל..."
      />

      {/* Active filter summary card */}
      {hasActiveFilter || dateRange ? (
        <ActiveFilterSummary
          scope={scope}
          filters={filters}
          dateRange={dateRange}
          repNameByEmail={repNameByEmail}
          customStatusesForFilter={customStatusesForFilter}
          filteredCount={filteredCount}
          totalCount={kpiCounts.totalCount}
          onClearScope={() => setScope('all')}
          onClearFilter={(key) => setFilters((f) => ({ ...f, [key]: key === 'search' ? '' : 'all' }))}
          onClearAll={() => {
            setFilters({ search: '', status: 'all', source: 'all', rep: 'all' });
            setScope('all');
          }}
        />
      ) : null}

      {/* Bulk action bar — surfaces when leads are selected */}
      {isAdmin && selectedLeads.length > 0 ? (
        <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-primary bg-primary/5 px-4 py-2.5 shadow-card backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              {selectedLeads.length}
            </span>
            <span className="text-sm font-medium text-foreground">לידים נבחרו</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            <Select value={assigningRep} onValueChange={setAssigningRep}>
              <SelectTrigger className="w-56 h-9 bg-card">
                <SelectValue placeholder="בחר נציג להעברה..." />
              </SelectTrigger>
              <SelectContent>
                {repsForPanel.map((r) => (
                  <SelectItem key={r.email} value={r.email}>{r.full_name || r.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!assigningRep || assignLeadsMutation.isPending}
              onClick={() => assignLeadsMutation.mutate({ leadIds: selectedLeads, repEmail: assigningRep })}
            >
              <UserCheck className="h-4 w-4 me-1.5" />
              {assignLeadsMutation.isPending ? 'משייך...' : `העבר ${selectedLeads.length} לידים`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setSelectedLeads([]); setAssigningRep(''); }}>
              <XIcon className="h-4 w-4 me-1" /> בטל בחירה
            </Button>
          </div>
        </div>
      ) : null}

      {/* Quick-pick selector — admin-only. Manual checkbox-by-checkbox
          selection is painful when the manager wants to triage 50
          fresh Facebook leads at once. These chips select the FIRST N
          leads currently visible in the table (post-filter, post-sort)
          so a manager can pick "30", drop them on a rep, and move on.
          "הכל" picks every lead loaded in the table — note this is
          the LOADED set (capped by `limit`), not the entire matching
          count in the DB, so we show the working number next to it. */}
      {isAdmin && leads.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-card">
          <span className="text-xs font-medium text-muted-foreground">בחירה מהירה:</span>
          {[5, 10, 20, 30, 50].map((n) => {
            const available = Math.min(n, leads.length);
            const disabled = available === 0;
            return (
              <Button
                key={n}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => setSelectedLeads(leads.slice(0, available).map((l) => l.id))}
                className="h-7 px-2.5 text-xs tabular-nums"
              >
                {n}
              </Button>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSelectedLeads(leads.map((l) => l.id))}
            className="h-7 px-2.5 text-xs"
          >
            הכל ({fmt(leads.length)})
          </Button>
          {selectedLeads.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedLeads([])}
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <XIcon className="h-3.5 w-3.5 me-1" />
              נקה
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Lead table — focused management view: checkbox + name/phone +
          status + source + rep + date. Clicking a row opens the lead in
          a popup over this page: no navigation, so the scroll position,
          filters and pagination are all preserved untouched. The row of
          the most recently opened lead stays highlighted. */}
      <LeadListTable
        leads={leads}
        isLoading={isLoading && !leads.length}
        isAdmin={isAdmin}
        selectedLeads={selectedLeads}
        onSelectionChange={setSelectedLeads}
        repNameByEmail={repNameByEmail}
        highlightId={lastOpenedLeadId}
        onRowClick={(lead) => openLead(lead.id)}
      />

      {/* Load-more sentinel + paging hint */}
      <div ref={loadMoreRef} className="h-1" />
      {filteredCount != null && leads.length < filteredCount ? (
        <p className="text-[11px] text-center text-muted-foreground py-2">
          {isFetching ? 'טוען עוד...' : `מציג ${fmt(leads.length)} מתוך ${fmt(filteredCount)} — גלול להמשך`}
        </p>
      ) : leads.length > 0 && filteredCount != null ? (
        <p className="text-[11px] text-center text-muted-foreground py-2">
          הוצגו כל {fmt(filteredCount)} הלידים שתואמים את הסינון
        </p>
      ) : null}

      {showImport ? <ImportFromSheets isOpen={showImport} onClose={() => setShowImport(false)} /> : null}
    </div>
  );
}

// ─── Rep workload card ──────────────────────────────────────────
function RepWorkloadCard({ label, avatar, newCount, handlingCount, wonCount, lostCount, isActive, accent, onClick }) {
  const total = newCount + handlingCount + wonCount + lostCount;
  const tones = {
    indigo:  { active: 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-400',   total: 'text-indigo-700' },
    emerald: { active: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400', total: 'text-emerald-700' },
  }[accent];
  const cardCls = isActive ? tones.active : 'border-border bg-card hover:border-foreground/30';
  // Four buckets that partition all of the rep's leads (sum to the total, which
  // matches what filtering the list by this rep shows): open work (new +
  // handling) and closed outcomes (won + lost).
  const stats = [
    { label: 'לידים חדשים',    value: newCount,      box: 'bg-sky-50',     text: 'text-sky-700',     sub: 'text-sky-700/80' },
    { label: 'בטיפול',         value: handlingCount, box: 'bg-amber-50',   text: 'text-amber-700',   sub: 'text-amber-700/80' },
    { label: 'נסגר בהצלחה',    value: wonCount,      box: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-700/80' },
    { label: 'נסגר ללא עסקה',  value: lostCount,     box: 'bg-rose-50',    text: 'text-rose-700',    sub: 'text-rose-700/80' },
  ];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right rounded-xl border-2 p-2.5 shadow-card transition-all ${cardCls}`}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {avatar}
        <span className="text-xs font-semibold truncate flex-1" title={label}>{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {stats.map((s) => (
          <div key={s.label} className={`${s.box} rounded p-1.5 text-center`}>
            <p className={`text-[10px] leading-tight ${s.sub}`}>{s.label}</p>
            <p className={`text-base font-bold tabular-nums leading-tight ${s.text}`}>{fmt(s.value)}</p>
          </div>
        ))}
      </div>
      {total > 0 ? (
        <p className={`text-[10px] mt-1.5 font-semibold ${isActive ? tones.total : 'text-muted-foreground'}`}>
          סה״כ {fmt(total)}
        </p>
      ) : (
        <p className="text-[10px] mt-1.5 text-muted-foreground">פנוי</p>
      )}
    </button>
  );
}

// ─── Active filter summary ──────────────────────────────────────
function ActiveFilterSummary({
  scope, filters, dateRange, repNameByEmail, customStatusesForFilter,
  filteredCount, totalCount, onClearScope, onClearFilter, onClearAll,
}) {
  const SCOPE_LABELS = { new: 'לידים חדשים', unassigned: 'לא משויכים', open: 'פתוחים' };
  const statusLabel = filters.status !== 'all'
    ? (LEAD_STATUS_OPTIONS.find((s) => s.value === filters.status)?.label
       || customStatusesForFilter.find((s) => s.value === filters.status)?.label
       || filters.status)
    : null;
  const sourceLabel = filters.source !== 'all' ? (SOURCE_LABELS[filters.source] || filters.source) : null;
  const repLabel = filters.rep !== 'all' ? (repNameByEmail.get(filters.rep) || filters.rep) : null;
  const chips = [
    scope !== 'all' && { key: 'scope', label: SCOPE_LABELS[scope] || scope, onClear: onClearScope },
    statusLabel && { key: 'status', label: `סטטוס: ${statusLabel}`, onClear: () => onClearFilter('status') },
    sourceLabel && { key: 'source', label: `מקור: ${sourceLabel}`,   onClear: () => onClearFilter('source') },
    repLabel    && { key: 'rep',    label: `נציג: ${repLabel}`,      onClear: () => onClearFilter('rep') },
    filters.search && { key: 'search', label: `חיפוש: "${filters.search}"`, onClear: () => onClearFilter('search') },
    dateRange && {
      key: 'date',
      label: `תאריך: ${format(dateRange.from, 'dd.MM.yy')}–${format(dateRange.to, 'dd.MM.yy')}`,
      onClear: null, // date is cleared via the preset bar above
    },
  ].filter(Boolean);
  const pct = totalCount > 0 && filteredCount != null
    ? Math.round((Number(filteredCount) / Number(totalCount)) * 1000) / 10
    : null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-primary/30 bg-gradient-to-l from-primary/10 to-primary/5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-primary">
              <Filter className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold text-foreground">תוצאות הסינון</span>
          </div>
          <span className="text-3xl font-bold text-primary tabular-nums whitespace-nowrap">
            {filteredCount === null ? '...' : fmt(filteredCount)}
          </span>
          {pct != null ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({pct}% מתוך {fmt(totalCount)} בטווח)
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] font-medium text-primary hover:text-primary/80 px-2 py-1"
        >
          נקה הכל
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.key}
            className="inline-flex items-center gap-1 rounded-full bg-background border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-foreground"
          >
            {chip.label}
            {chip.onClear ? (
              <button type="button" onClick={chip.onClear} className="opacity-60 hover:opacity-100" aria-label="הסר סינון">
                <XIcon className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
