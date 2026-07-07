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
  Filter, X as XIcon, FileSpreadsheet, ArrowRightLeft, Sparkles,
  Moon, Sun, Hourglass, Loader2, CheckCircle2,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { startOfDay, endOfDay, startOfWeek, startOfMonth, format } from '@/lib/safe-date-fns';
import { toZonedTime, fromZonedTime } from '@/lib/safe-date-fns-tz';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessSalesWorkspace, isFactoryUser } from '@/components/shared/rbac';
import { useCustomStatuses } from '@/hooks/useCustomStatuses';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, SOURCE_LABELS, CLOSED_STATUSES, TIMEZONE } from '@/constants/leadOptions';
import ImportFromSheets from '@/components/lead/ImportFromSheets';
import LeadQuickActions from '@/components/lead/LeadQuickActions';

// State for this page lives mostly in the URL so navigation back from a
// lead-details page restores exactly where the manager left off (filters,
// rep selection, search). Scroll position is restored via sessionStorage,
// keyed by the URL — different filter combinations remember different
// positions independently.
const SCROLL_KEY_PREFIX = 'leadMgmtScroll:';

// Only the columns the management table actually renders (+ id for keys /
// selection / opening the lead). The leads row is wide (notes, addresses,
// marketing fields, …); fetching just these keeps each page light so clicking
// between categories feels instant. The lead modal refetches the full row by id.
const LEAD_LIST_COLUMNS = 'id,full_name,phone,status,source,rep1,rep2,facebook_ad_name,first_action_at,effective_sort_date,created_date';

function fmt(n) { return Number(n || 0).toLocaleString(); }

// "New leads" are triaged over a 20:00→20:00 cycle, split into two
// operational shifts, all anchored to Israel wall-clock time regardless of
// the viewer's device timezone:
//   • night → previous day 20:00 until today 08:00
//   • day   → today 08:00 until today 20:00
//   • cycle → previous day 20:00 until today 20:00 (night + day)
// Boundaries are constructed in Asia/Jerusalem and returned as UTC ISO
// strings so they can be handed straight to an effective_sort_date range
// filter. Negative/overflowing day numbers (e.g. the 0th of a month) are
// normalised by the Date constructor, so month/year rollover is automatic.
function israelShiftWindows(now = new Date()) {
  const zoned = toZonedTime(now, TIMEZONE);
  const y = zoned.getFullYear();
  const mo = zoned.getMonth();
  const d = zoned.getDate();
  const at = (day, hour) => fromZonedTime(new Date(y, mo, day, hour, 0, 0, 0), TIMEZONE).toISOString();
  return {
    night: { from: at(d - 1, 20), to: at(d, 8) },
    day: { from: at(d, 8), to: at(d, 20) },
    cycle: { from: at(d - 1, 20), to: at(d, 20) },
  };
}

// effective_sort_date condition for a half-open [from, to) window. Half-open
// so the night and day shifts partition the cycle with no double-counting at
// the shared 08:00 / 20:00 boundaries (cycle total === night + day exactly).
function windowCond(w) {
  return { effective_sort_date: { $gte: w.from, $lt: w.to } };
}

// Statuses that mean a lead has moved past the "new_lead" stage but isn't
// closed yet — i.e. a rep is actively working it ("בטיפול").
const HANDLING_EXCLUDED_STATUSES = [...CLOSED_STATUSES, 'new_lead'];

// "Lost" = every closed status except the winning one. Mirrors the rep-card
// math (lost = closed − won), so the bucket and its drill-down agree.
const LOST_STATUSES = CLOSED_STATUSES.filter((s) => s !== 'deal_closed');

// Lifecycle buckets used to drill into a single rep's workload card. Each id
// maps to the status condition that DEFINES that bucket — identical to how the
// per-rep counts are computed below — so clicking a bucket produces a list
// whose count matches the number on the card. These honor the date range (they
// are not shift scopes), exactly like the counts on the cards.
const LIFECYCLE_SCOPES = {
  lc_new: { status: 'new_lead' },
  lc_handling: { status: { $nin: HANDLING_EXCLUDED_STATUSES } },
  lc_won: { status: 'deal_closed' },
  lc_lost: { status: { $in: LOST_STATUSES } },
};

// The individual statuses that make up "בטיפול" — the working pipeline a
// manager wants to see broken down when they drill into handling (hot lead,
// follow-ups, the no-answer ladder, …). Derived from the canonical option list
// minus new_lead and the closed statuses, so it stays in lifecycle order and
// in sync if the option list changes.
const HANDLING_STATUSES = LEAD_STATUS_OPTIONS.filter(
  (o) => o.value !== 'new_lead' && !CLOSED_STATUSES.includes(o.value),
);

// Colour grouping for the handling status cubes, so the manager reads the
// pipeline at a glance: hot = rose, follow-ups = amber, branch visit = emerald,
// changed direction = violet, the whole no-answer ladder = slate.
function handlingStatusTone(value) {
  if (value === 'hot_lead') return { box: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-400 border-rose-500' };
  if (value.startsWith('followup')) return { box: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-400 border-amber-500' };
  if (value === 'coming_to_branch') return { box: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-400 border-emerald-500' };
  if (value === 'changed_direction') return { box: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-400 border-violet-500' };
  return { box: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-400 border-slate-500' };
}

// Build the filter object that gets handed to base44.entities.Lead.{filter,count}.
// Shared so the row query, the count query, and the KPI queries all stay
// consistent — change one rule here and all three move together.
function buildLeadsQuery({ filters, dateRange, scope, userEmail, isAdmin, windows }) {
  const conditions = [];
  const startDate = dateRange?.from instanceof Date ? dateRange.from : null;
  const endDate = dateRange?.to instanceof Date ? dateRange.to : null;
  const hasRange = startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime());
  // The "new leads" shift scopes carry their OWN fixed time window, so they
  // ignore the page-level date-range picker (intersecting the two would be
  // confusing and usually empty). Every other scope honors the picker.
  const isShiftScope = scope === 'new_night' || scope === 'new_day' || scope === 'new_cycle';

  if (!isAdmin) {
    conditions.push({ $or: [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }] });
  }
  if (scope === 'unassigned') {
    conditions.push({ $or: [{ rep1: null }, { rep1: '' }] });
  } else if (scope === 'assigned_unhandled') {
    // משויך ולא טופל — has an owning rep but is still sitting at new_lead,
    // i.e. nothing happened beyond the assignment itself.
    conditions.push({ status: 'new_lead' });
    conditions.push({ rep1: { $ne: null } });
    conditions.push({ rep1: { $ne: '' } });
  } else if (scope === 'handling') {
    // בטיפול — past the new_lead stage and not yet closed.
    conditions.push({ status: { $nin: HANDLING_EXCLUDED_STATUSES } });
  } else if (isShiftScope) {
    // לידים שנכנסו (לילה/יום/מחזור) — every lead that ARRIVED in the window,
    // regardless of its current status. Counting only the ones still sitting
    // at new_lead made the tile decay toward 0 as reps worked the queue
    // ("נכנסו מעל 200 לידים" while the tile said 18) — arrivals is the number
    // a manager actually means here.
    const w = scope === 'new_night' ? windows?.night
      : scope === 'new_day' ? windows?.day
        : windows?.cycle;
    if (w) conditions.push(windowCond(w));
  } else if (LIFECYCLE_SCOPES[scope]) {
    // Per-rep workload drill-down (חדשים/בטיפול/נסגרו/נאבדו). Combined with the
    // rep filter below it reproduces the count shown on that rep's card.
    conditions.push(LIFECYCLE_SCOPES[scope]);
  }
  if (hasRange && !isShiftScope) {
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
  // Night/day shift windows. Anchored to the END of the selected date range
  // (so picking a specific day shows THAT day's 20:00→20:00 cycle — the
  // manager checking "כמה נכנסו ב-06.07" gets 06.07's cycle, not today's);
  // with no range selected they anchor to today's Israel date. toIso keeps
  // the ISO strings stable per selection so query keys stay steady.
  const windows = useMemo(
    () => israelShiftWindows(toIso ? new Date(toIso) : new Date()),
    [toIso],
  );

  // ───────────────────────────────────────────────────────────────
  // Category KPI tiles. The three assignment/status buckets respect the
  // date range; the two "new leads" shift buckets use their own fixed
  // night/day windows (see israelShiftWindows).
  // ───────────────────────────────────────────────────────────────
  const EMPTY_KPI = {
    assignedUnhandledCount: 0, unassignedCount: 0, handlingCount: 0,
    newNightCount: 0, newDayCount: 0, totalCount: 0,
  };
  const { data: kpiCounts = EMPTY_KPI } = useQuery({
    queryKey: ['leadMgmt-kpis', isAdmin, userEmail, fromIso, toIso, windows.night.from, windows.day.from],
    enabled: !!effectiveUser && !!userEmail,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      // base(extra, { range }) builds a count filter. `extra` may be a single
      // condition or an array of them. `range` defaults to true (honor the
      // page date range); pass false for the shift windows that bring their own.
      const base = (extra, { range = true } = {}) => {
        const conditions = [];
        if (!isAdmin) conditions.push({ $or: [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }] });
        if (range && fromIso && toIso) conditions.push({ effective_sort_date: { $gte: fromIso, $lte: toIso } });
        if (Array.isArray(extra)) conditions.push(...extra);
        else if (extra) conditions.push(extra);
        if (conditions.length === 0) return {};
        if (conditions.length === 1) return conditions[0];
        return { $and: conditions };
      };
      const [
        assignedUnhandledCount, unassignedCount, handlingCount,
        newNightCount, newDayCount, totalCount,
      ] = await Promise.all([
        base44.entities.Lead.count(base([{ status: 'new_lead' }, { rep1: { $ne: null } }, { rep1: { $ne: '' } }])),
        base44.entities.Lead.count(base({ $or: [{ rep1: null }, { rep1: '' }] })),
        base44.entities.Lead.count(base({ status: { $nin: HANDLING_EXCLUDED_STATUSES } })),
        base44.entities.Lead.count(base([windowCond(windows.night)], { range: false })),
        base44.entities.Lead.count(base([windowCond(windows.day)], { range: false })),
        base44.entities.Lead.count(base()),
      ]);
      return {
        assignedUnhandledCount, unassignedCount, handlingCount,
        newNightCount, newDayCount, totalCount,
      };
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
  // count four lifecycle buckets, each defined by the SAME condition its
  // drill-down click applies (LIFECYCLE_SCOPES):
  //   • new      – status new_lead (assigned but untouched)
  //   • handling – open but no longer new: hot lead, follow-up before/after
  //                quote, coming to branch, no-answer 1-5, changed direction, …
  //   • won      – deal_closed
  //   • lost     – every other closed status (not-relevant / disqualified / …)
  // Rep match is rep1 OR rep2, mirroring the list filter, so each bucket equals
  // the list it opens when clicked. COUNTs are exact, indexed, cached and run
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
      // One COUNT per bucket, each using the SAME condition the card's
      // drill-down click applies (LIFECYCLE_SCOPES). Counting the buckets
      // directly — rather than deriving handling/lost by subtraction — means
      // every number on the card equals the list it opens when clicked (the
      // old subtraction folded null/unknown-status leads into "handling",
      // which a "status not in (...)" filter then excluded → mismatch).
      const countsFor = async (repEmail) => {
        const base = repEmail ? [{ $or: [{ rep1: repEmail }, { rep2: repEmail }] }] : [];
        // "חדשים שטרם טופלו" = assigned-but-untouched. For a rep this is implicit
        // (the card is filtered to them). For the TEAM card (repEmail null) we
        // must add "has a rep", otherwise unassigned new leads — which belong to
        // the separate "לא משויכים" pool, not to anyone's workload — would inflate
        // it and clash with the "משויך ולא טופל" tile. Mirrors LIFECYCLE_SCOPES +
        // the assigned_unhandled scope so card === tile === filtered list.
        const newCond = repEmail
          ? [LIFECYCLE_SCOPES.lc_new]
          : [{ status: 'new_lead' }, { rep1: { $ne: null } }, { rep1: { $ne: '' } }];
        const [newCount, handlingCount, wonCount, lostCount] = await Promise.all([
          base44.entities.Lead.count(build([...base, ...newCond])),
          base44.entities.Lead.count(build([...base, LIFECYCLE_SCOPES.lc_handling])),
          base44.entities.Lead.count(build([...base, LIFECYCLE_SCOPES.lc_won])),
          base44.entities.Lead.count(build([...base, LIFECYCLE_SCOPES.lc_lost])),
        ]);
        return { newCount, handlingCount, wonCount, lostCount };
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
    () => buildLeadsQuery({ filters, dateRange, scope, userEmail, isAdmin, windows }),
    [filters, dateRange, scope, userEmail, isAdmin, windows],
  );
  // Reset paging to the first page whenever the query itself changes (scope /
  // filter / rep / status / date / search) — without this, switching views
  // re-pulls however many rows the user had scrolled to (e.g. 400). Each click
  // then fetches a single light page; infinite-scroll grows it again on demand.
  const leadsQueryKey = useMemo(() => JSON.stringify(leadsQuery), [leadsQuery]);
  const prevLeadsQueryKey = useRef(leadsQueryKey);
  useEffect(() => {
    if (prevLeadsQueryKey.current !== leadsQueryKey) {
      prevLeadsQueryKey.current = leadsQueryKey;
      setLimit((cur) => (cur > 100 ? 100 : cur));
    }
  }, [leadsQueryKey]);
  const { data: leads = [], isLoading, isFetching } = useQuery({
    queryKey: ['leadMgmt-leads', leadsQuery, limit],
    enabled: !!effectiveUser,
    staleTime: 60_000,
    placeholderData: (prev) => prev, // ← key: don't drop rows on loadMore so the scroll stays put
    queryFn: () => base44.entities.Lead.filter(leadsQuery, '-effective_sort_date', limit, undefined, LEAD_LIST_COLUMNS),
  });
  const { data: filteredCount = null } = useQuery({
    queryKey: ['leadMgmt-count', leadsQuery],
    enabled: !!effectiveUser,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: () => base44.entities.Lead.count(leadsQuery),
  });

  // ───────────────────────────────────────────────────────────────
  // "בטיפול" status breakdown. When a handling scope is active, count each
  // working status (hot / follow-ups / no-answer ladder / …) within the SAME
  // rep + date + source + search context as the list, so a manager sees where
  // the in-handling pipeline actually sits. Each cube reuses buildLeadsQuery
  // with a single status, so clicking it (which sets filters.status) opens a
  // list whose count equals the cube. `__total` lets us surface an "אחר"
  // remainder for non-standard / custom statuses so the cubes reconcile.
  // ───────────────────────────────────────────────────────────────
  const handlingBreakdownActive = scope === 'handling' || scope === 'lc_handling';
  const { data: statusBreakdown = {} } = useQuery({
    queryKey: ['leadMgmt-handling-breakdown', isAdmin, userEmail, filters.rep, filters.source, filters.search, fromIso, toIso],
    enabled: !!effectiveUser && handlingBreakdownActive,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      const ctx = (status, forcedScope) => buildLeadsQuery({
        filters: { ...filters, status }, dateRange, scope: forcedScope, userEmail, isAdmin, windows,
      });
      const [total, ...perStatus] = await Promise.all([
        base44.entities.Lead.count(ctx('all', 'handling')),
        ...HANDLING_STATUSES.map((s) => base44.entities.Lead.count(ctx(s.value, 'all'))),
      ]);
      const out = { __total: total };
      HANDLING_STATUSES.forEach((s, i) => { out[s.value] = perStatus[i]; });
      return out;
    },
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
  // Progress state for the bulk-reassign modal (null when idle):
  // { total, done, failed, repName, finished }.
  const [assignProgress, setAssignProgress] = useState(null);

  const assignLeadsMutation = useMutation({
    mutationFn: async ({ leadIds, repEmail }) => {
      const repName = salesReps.find((r) => r.email === repEmail)?.full_name || repEmail;
      setAssignProgress({ total: leadIds.length, done: 0, failed: 0, repName, finished: false });

      // Reassign with bounded concurrency instead of one-at-a-time: the
      // browser caps ~6 connections to the Supabase host, so ~8 in-flight
      // workers drain the queue in a handful of round-trips instead of N
      // sequential ones — a 20-50 row batch goes from seconds to ~instant.
      // Each row is still its own UPDATE, so the per-lead assignment-log
      // trigger fires exactly as before (works for both unassigned leads and
      // ones that already had a rep). We process every row and report any
      // failures at the end rather than aborting the whole batch on one.
      const stamp = new Date().toISOString();
      let done = 0;
      let failed = 0;
      let cursor = 0;
      const worker = async () => {
        while (cursor < leadIds.length) {
          const id = leadIds[cursor++];
          try {
            await base44.entities.Lead.update(id, {
              rep1: repEmail,
              pending_rep_email: null,
              first_action_at: stamp,
            });
          } catch {
            failed += 1;
          } finally {
            done += 1;
            setAssignProgress((p) => (p ? { ...p, done, failed } : p));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, leadIds.length) }, worker));
      setAssignProgress((p) => (p ? { ...p, done, failed, finished: true } : p));
      return { total: leadIds.length, failed, repName };
    },
    onSuccess: ({ total, failed, repName }) => {
      if (failed > 0) {
        toast({ title: `שויכו ${total - failed}/${total} לידים ל${repName}`, description: `${failed} נכשלו — נסה שוב`, variant: 'destructive' });
      } else {
        toast({ title: `${total} לידים שויכו ל${repName}` });
      }
      setSelectedLeads([]);
      setAssigningRep('');
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-leads'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-count'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['leadMgmt-workload'] });
      // Let the "הושלם" state show for a beat, then dismiss the modal.
      setTimeout(() => setAssignProgress(null), 1200);
    },
    onError: (err) => {
      setAssignProgress(null);
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

  // Switch the active scope (toggling off if it's already active). Scopes are
  // status/assignment-defined, so a lingering status filter (e.g. one picked
  // from the handling breakdown) would contradict them — clear it on change.
  const toggleScope = (id) => {
    setScope((curr) => (curr === id ? 'all' : id));
    setFilters((f) => (f.status === 'all' ? f : { ...f, status: 'all' }));
  };

  // Drill into a rep workload card. `bucketScope` is null for the header (just
  // filter the list to this rep) or a lifecycle scope id for a specific bucket
  // (rep + that status bucket). Re-clicking the active target clears it. Both
  // the rep filter and the scope respect the selected date range, so the list
  // that opens always matches the number shown on the card. The status filter
  // is cleared so a leftover pick doesn't contradict the bucket's status set.
  const selectRepBucket = (repEmail, bucketScope) => {
    const isActive = filters.rep === repEmail && scope === (bucketScope || 'all');
    if (isActive) {
      setFilters((f) => ({ ...f, rep: 'all', status: 'all' }));
      setScope('all');
    } else {
      setFilters((f) => ({ ...f, rep: repEmail, status: 'all' }));
      setScope(bucketScope || 'all');
    }
  };

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
          <LeadQuickActions
            currentUser={effectiveUser}
            onLeadCreated={() => {
              queryClient.invalidateQueries({ queryKey: ['leadMgmt-leads'] });
              queryClient.invalidateQueries({ queryKey: ['leadMgmt-kpis'] });
            }}
          />
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

      {/* Category tiles — clickable to filter the list. The three status
          buckets follow the date range above; the arrivals cube uses its
          own 20:00→20:00 cycle (total) split into night / day shifts,
          anchored to the selected date. For a rep the whole strip is scoped
          to their own leads, and the manager-only tiles (unassigned pool,
          night/day intake) are replaced with a personal summary tile —
          a rep's view stays focused on the leads that belong to them. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ...(!isAdmin ? [{ id: '__mine', label: 'הלידים שלי', value: kpiCounts.totalCount, tone: 'sky', icon: Users, desc: 'כל הלידים המשויכים אליי בטווח' }] : []),
          { id: 'assigned_unhandled', label: 'משויך ולא טופל', value: kpiCounts.assignedUnhandledCount, tone: 'rose',   icon: UserCheck, desc: 'שויך לנציג אך נשאר "ליד חדש"' },
          // "לא משויכים" is a management-only pool — reps only handle leads
          // assigned to them, so the unassigned tile is hidden for them.
          ...(isAdmin ? [{ id: 'unassigned', label: 'לא משויכים', value: kpiCounts.unassignedCount, tone: 'amber', icon: UserPlus, desc: 'לידים בלי נציג ראשי' }] : []),
          { id: 'handling',           label: 'בטיפול',          value: kpiCounts.handlingCount,          tone: 'indigo', icon: Hourglass, desc: 'אחרי שלב "ליד חדש", טרם נסגר' },
        ].map((tile) => (
          <CategoryTile
            key={tile.id}
            label={tile.label}
            value={tile.value}
            tone={tile.tone}
            icon={tile.icon}
            desc={tile.desc}
            isActive={tile.id === '__mine' ? scope === 'all' && !hasActiveFilter : scope === tile.id}
            onClick={() => (tile.id === '__mine'
              ? (setScope('all'), setFilters({ search: '', status: 'all', source: 'all', rep: 'all' }))
              : toggleScope(tile.id))}
          />
        ))}
        {isAdmin ? (
          <NewLeadsCube
            nightCount={kpiCounts.newNightCount}
            dayCount={kpiCounts.newDayCount}
            scope={scope}
            onSelect={toggleScope}
          />
        ) : null}
      </div>

      {/* Rep workload panel — admin only. Click the card header to filter the
          list to that rep, or click a single bucket to drill into that rep's
          new / handling / won / lost leads. Counts and the list it opens both
          follow the selected date range. */}
      {isAdmin ? (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 px-1 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            עומס לפי נציג ({sortedReps.length} בצוות)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {/* "All team" card first */}
            <RepWorkloadCard
              repEmail="all"
              label="כל הצוות"
              avatar={<span className="h-8 w-8 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">כל</span>}
              newCount={workloadByRep.team.newCount}
              handlingCount={workloadByRep.team.handlingCount}
              wonCount={workloadByRep.team.wonCount}
              lostCount={workloadByRep.team.lostCount}
              activeRep={filters.rep}
              activeScope={scope}
              accent="indigo"
              onSelect={selectRepBucket}
            />
            {sortedReps.map((rep) => {
              const wl = workloadByRep.byRep.get(rep.email) || EMPTY_WL;
              return (
                <RepWorkloadCard
                  key={rep.email}
                  repEmail={rep.email}
                  label={rep.full_name || rep.email}
                  avatar={<UserAvatar user={rep} size="sm" />}
                  newCount={wl.newCount}
                  handlingCount={wl.handlingCount}
                  wonCount={wl.wonCount}
                  lostCount={wl.lostCount}
                  activeRep={filters.rep}
                  activeScope={scope}
                  accent="emerald"
                  onSelect={selectRepBucket}
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

      {/* Active filter summary card — the "בטיפול" status breakdown rides
          inside it (as `extra`) so it doesn't add a second purple bar. */}
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
          extra={handlingBreakdownActive ? (
            <HandlingStatusBreakdown
              counts={statusBreakdown}
              activeStatus={filters.status}
              onSelect={(st) => setFilters((f) => ({ ...f, status: f.status === st ? 'all' : st }))}
            />
          ) : null}
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

      {/* Bulk-reassign progress popup — a live progress bar so the manager
          can watch a 20-50 lead reassignment fly through. Locked while it
          runs; auto-closes shortly after it finishes. */}
      <Dialog
        open={!!assignProgress}
        onOpenChange={(o) => { if (!o && assignProgress?.finished) setAssignProgress(null); }}
      >
        <DialogContent
          dir="rtl"
          className="sm:max-w-[420px]"
          onPointerDownOutside={(e) => { if (!assignProgress?.finished) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (!assignProgress?.finished) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {assignProgress?.finished
                ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {assignProgress?.finished ? 'השיוך הושלם' : 'משייך לידים…'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {assignProgress?.finished
                ? `${assignProgress.done - assignProgress.failed} מתוך ${assignProgress.total} לידים שויכו ל${assignProgress.repName}`
                : `מעביר ${assignProgress?.total || 0} לידים ל${assignProgress?.repName || ''}…`}
            </p>
            <Progress value={assignProgress ? Math.round((assignProgress.done / Math.max(1, assignProgress.total)) * 100) : 0} />
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium tabular-nums">{assignProgress?.done || 0} / {assignProgress?.total || 0}</span>
              {assignProgress?.failed > 0
                ? <span className="text-xs text-red-600">{assignProgress.failed} נכשלו</span>
                : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
        users={salesReps}
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

// ─── Category tiles ─────────────────────────────────────────────
const TILE_TONES = {
  rose:   { active: 'bg-rose-50 border-rose-500 ring-2 ring-rose-400',       value: 'text-rose-700' },
  amber:  { active: 'bg-amber-50 border-amber-500 ring-2 ring-amber-400',    value: 'text-amber-700' },
  indigo: { active: 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-400', value: 'text-indigo-700' },
  violet: { active: 'bg-violet-50 border-violet-500 ring-2 ring-violet-400', value: 'text-violet-700' },
  sky:    { active: 'bg-sky-50 border-sky-500 ring-2 ring-sky-400',          value: 'text-sky-700' },
};

function CategoryTile({ label, value, tone, icon: Icon, desc, isActive, onClick }) {
  const tones = TILE_TONES[tone];
  const cardCls = isActive ? tones.active : 'border-border bg-muted/30 hover:bg-muted/50';
  const valueCls = isActive ? tones.value : 'text-muted-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right rounded-xl border-2 p-4 shadow-card transition-all ${cardCls}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className={`text-xs font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</p>
        <Icon className={`h-4 w-4 ${valueCls} ${isActive ? 'opacity-100' : 'opacity-50'}`} />
      </div>
      <p className={`text-3xl font-bold tabular-nums ${valueCls}`}>{fmt(value)}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{desc}</p>
    </button>
  );
}

// Arrivals cube — one tile holding the full 20:00→20:00 cycle total on top,
// split below into the night and day shifts. Counts every lead that ENTERED
// the window (any current status). The cube is a plain container (not a
// button) so its three click targets — total / night / day — don't nest
// buttons; each toggles its own scope on the list.
function NewLeadsCube({ nightCount, dayCount, scope, onSelect }) {
  // Night and day are a half-open partition of the cycle, so the total is
  // exactly their sum — no extra count query needed.
  const total = (nightCount || 0) + (dayCount || 0);
  const cycleActive = scope === 'new_cycle';
  const cardCls = cycleActive ? TILE_TONES.violet.active : 'border-border bg-muted/30';
  const sub = [
    { id: 'new_night', label: 'לילה', range: '20:00–08:00', value: nightCount, icon: Moon, tone: 'violet' },
    { id: 'new_day',   label: 'יום',  range: '08:00–20:00', value: dayCount,   icon: Sun,  tone: 'sky' },
  ];
  return (
    <div className={`rounded-xl border-2 p-3 shadow-card transition-all ${cardCls}`}>
      {/* Total — click to filter the whole 20:00→20:00 cycle */}
      <button
        type="button"
        onClick={() => onSelect('new_cycle')}
        className="w-full text-right rounded-lg px-1 py-0.5 transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center justify-between mb-0.5">
          <p className={`text-xs font-medium ${cycleActive ? 'text-foreground' : 'text-muted-foreground'}`}>
            לידים שנכנסו <span className="text-[10px] opacity-70">(20:00–20:00)</span>
          </p>
          <Sparkles className={`h-4 w-4 ${cycleActive ? 'text-violet-700 opacity-100' : 'text-muted-foreground opacity-50'}`} />
        </div>
        <p className={`text-3xl font-bold tabular-nums ${cycleActive ? 'text-violet-700' : 'text-muted-foreground'}`}>{fmt(total)}</p>
      </button>
      {/* Night / day split */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {sub.map((s) => {
          const active = scope === s.id;
          const tones = TILE_TONES[s.tone];
          const Icon = s.icon;
          const cls = active ? tones.active : 'border-border bg-card hover:bg-muted/50';
          const valueCls = active ? tones.value : 'text-foreground';
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`text-right rounded-lg border p-2 transition-all ${cls}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
                <Icon className={`h-3.5 w-3.5 ${valueCls} ${active ? 'opacity-100' : 'opacity-60'}`} />
              </div>
              <p className={`text-xl font-bold tabular-nums leading-tight ${valueCls}`}>{fmt(s.value)}</p>
              <p className="text-[9px] text-muted-foreground" dir="ltr">{s.range}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── "בטיפול" status breakdown row ──────────────────────────────
// A card-less, single wrapping row of status pills, rendered INSIDE the filter
// summary card (so it doesn't add a second purple bar). Only statuses that
// actually have leads, sorted biggest first, colour-grouped, each clickable to
// narrow the list. An "אחר" pill absorbs non-standard / custom handling
// statuses so it reconciles with the בטיפול total.
function HandlingStatusBreakdown({ counts, activeStatus, onSelect }) {
  const total = counts.__total ?? null;
  const loading = total == null;
  const knownSum = HANDLING_STATUSES.reduce((acc, s) => acc + (counts[s.value] || 0), 0);
  const other = loading ? 0 : Math.max(0, total - knownSum);
  const chips = HANDLING_STATUSES
    .map((s) => ({ value: s.value, label: s.label, count: counts[s.value], tone: handlingStatusTone(s.value) }))
    .filter((s) => loading || (s.count || 0) > 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-xs font-bold text-foreground shrink-0 flex items-center gap-1.5">
        <Hourglass className="h-3.5 w-3.5 text-primary" />
        פילוח בטיפול לפי סטטוס
      </span>
      {chips.map((s) => {
        const active = activeStatus === s.value;
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onSelect(s.value)}
            title={s.label}
            className={`inline-flex items-center gap-1.5 rounded-full border ${s.tone.box} px-2.5 py-0.5 text-xs transition-all ${active ? `ring-2 ${s.tone.ring}` : 'border-transparent hover:brightness-95'}`}
          >
            <span className="text-muted-foreground">{s.label}</span>
            <span className={`font-bold tabular-nums ${s.tone.text}`}>{s.count == null ? '…' : fmt(s.count)}</span>
          </button>
        );
      })}
      {other > 0 ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-slate-100 px-2.5 py-0.5 text-xs"
          title="סטטוסים אחרים בטיפול (כולל מותאמים אישית)"
        >
          <span className="text-muted-foreground">אחר</span>
          <span className="font-bold tabular-nums text-slate-700">{fmt(other)}</span>
        </span>
      ) : null}
    </div>
  );
}

// ─── Rep workload card ──────────────────────────────────────────
// A plain container (not a button) so its click targets — the header and each
// of the four buckets — don't nest buttons. The header filters the list to the
// rep; each bucket drills into that rep's new / handling / won / lost leads.
// `activeRep`/`activeScope` reflect the live list filter so the matching target
// highlights, and every count + the list it opens follow the date range.
function RepWorkloadCard({ repEmail, label, avatar, newCount, handlingCount, wonCount, lostCount, activeRep, activeScope, accent, onSelect }) {
  const total = newCount + handlingCount + wonCount + lostCount;
  const tones = {
    indigo:  { active: 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-400',   total: 'text-indigo-700' },
    emerald: { active: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400', total: 'text-emerald-700' },
  }[accent];
  const repActive = activeRep === repEmail;
  const headerActive = repActive && activeScope === 'all';
  const cardCls = repActive ? tones.active : 'border-border bg-card hover:border-foreground/30';
  // The team card counts only ASSIGNED new leads (unassigned ones live in the
  // separate "לא משויכים" tile), so its "new" bucket drills into the
  // assigned_unhandled scope rather than the plain status filter — keeping the
  // number, the tile and the list it opens all in agreement.
  const isTeam = repEmail === 'all';
  // Four buckets that partition the rep's leads (sum to the total, which matches
  // what filtering the list by this rep shows): open work (new but untouched +
  // in handling) and closed outcomes (won + lost/not-interested). Each carries
  // the scope it drills into (see LIFECYCLE_SCOPES / buildLeadsQuery).
  const stats = [
    { scope: isTeam ? 'assigned_unhandled' : 'lc_new', label: 'חדשים שטרם טופלו', title: isTeam ? 'לידים משויכים שטרם טופלו (ללא "לא משויכים")' : 'לידים חדשים שטרם טופלו', value: newCount, box: 'bg-sky-50', text: 'text-sky-700', sub: 'text-sky-700/80', ring: 'ring-sky-400 border-sky-500' },
    { scope: 'lc_handling', label: 'בטיפול',           title: 'לידים בטיפול',                  value: handlingCount, box: 'bg-amber-50',   text: 'text-amber-700',   sub: 'text-amber-700/80',   ring: 'ring-amber-400 border-amber-500' },
    { scope: 'lc_won',      label: 'נסגרו',            title: 'לידים שנסגרו בעסקה',            value: wonCount,      box: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-700/80', ring: 'ring-emerald-400 border-emerald-500' },
    { scope: 'lc_lost',     label: 'נאבדו',            title: 'לידים שנאבדו – לא מעוניינים',   value: lostCount,     box: 'bg-rose-50',    text: 'text-rose-700',    sub: 'text-rose-700/80',    ring: 'ring-rose-400 border-rose-500' },
  ];
  return (
    <div className={`rounded-xl border-2 p-2.5 shadow-card transition-all ${cardCls}`}>
      <button
        type="button"
        onClick={() => onSelect(repEmail, null)}
        className={`w-full text-right flex items-center gap-2 mb-2 min-w-0 rounded-lg px-1 py-0.5 transition-colors hover:bg-muted/40 ${headerActive ? 'bg-muted/40' : ''}`}
        title={`סנן לפי ${label}`}
      >
        {avatar}
        <span className="text-xs font-semibold truncate flex-1" title={label}>{label}</span>
      </button>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {stats.map((s) => {
          const active = repActive && activeScope === s.scope;
          return (
            <button
              key={s.scope}
              type="button"
              onClick={() => onSelect(repEmail, s.scope)}
              title={s.title}
              className={`${s.box} rounded p-1.5 text-center border transition-all ${active ? `ring-2 ${s.ring}` : 'border-transparent hover:brightness-95'}`}
            >
              <p className={`text-[10px] leading-tight ${s.sub}`}>{s.label}</p>
              <p className={`text-base font-bold tabular-nums leading-tight ${s.text}`}>{fmt(s.value)}</p>
            </button>
          );
        })}
      </div>
      {total > 0 ? (
        <p className={`text-[10px] mt-1.5 font-semibold ${repActive ? tones.total : 'text-muted-foreground'}`}>
          סה״כ {fmt(total)}
        </p>
      ) : (
        <p className="text-[10px] mt-1.5 text-muted-foreground">פנוי</p>
      )}
    </div>
  );
}

// ─── Active filter summary ──────────────────────────────────────
function ActiveFilterSummary({
  scope, filters, dateRange, repNameByEmail, customStatusesForFilter,
  filteredCount, totalCount, onClearScope, onClearFilter, onClearAll, extra,
}) {
  const SCOPE_LABELS = {
    assigned_unhandled: 'משויך ולא טופל',
    unassigned: 'לא משויכים',
    handling: 'בטיפול',
    new_cycle: 'לידים חדשים (20:00–20:00)',
    new_night: 'לידים חדשים לילה',
    new_day: 'לידים חדשים יום',
    lc_new: 'חדשים שטרם טופלו',
    lc_handling: 'בטיפול',
    lc_won: 'נסגרו',
    lc_lost: 'נאבדו',
  };
  const statusLabel = filters.status !== 'all'
    ? (LEAD_STATUS_OPTIONS.find((s) => s.value === filters.status)?.label
       || customStatusesForFilter.find((s) => s.value === filters.status)?.label
       || filters.status)
    : null;
  const sourceLabel = filters.source !== 'all' ? (SOURCE_LABELS[filters.source] || filters.source) : null;
  const repLabel = filters.rep !== 'all' ? (repNameByEmail.get(filters.rep) || filters.rep) : null;
  // The "new leads" shift scopes use their own fixed window and ignore the
  // date-range picker, so don't advertise a date chip that has no effect.
  const isShiftScope = scope === 'new_night' || scope === 'new_day' || scope === 'new_cycle';
  const chips = [
    scope !== 'all' && { key: 'scope', label: SCOPE_LABELS[scope] || scope, onClear: onClearScope },
    statusLabel && { key: 'status', label: `סטטוס: ${statusLabel}`, onClear: () => onClearFilter('status') },
    sourceLabel && { key: 'source', label: `מקור: ${sourceLabel}`,   onClear: () => onClearFilter('source') },
    repLabel    && { key: 'rep',    label: `נציג: ${repLabel}`,      onClear: () => onClearFilter('rep') },
    filters.search && { key: 'search', label: `חיפוש: "${filters.search}"`, onClear: () => onClearFilter('search') },
    dateRange && !isShiftScope && {
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
      {extra ? (
        <div className="border-t border-primary/20 pt-3">{extra}</div>
      ) : null}
    </div>
  );
}
