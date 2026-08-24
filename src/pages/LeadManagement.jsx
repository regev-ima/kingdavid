import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import LeadListTable from '@/components/lead/LeadListTable';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import UserAvatar from '@/components/shared/UserAvatar';
import {
  Users, UserCheck, UserX, Calendar as CalendarIcon,
  Filter, X as XIcon, FileSpreadsheet, ArrowRightLeft, Sparkles,
  Clock, Hourglass, Loader2, CheckCircle2, ChevronDown, Search,
  FileText, ClipboardCheck, DollarSign, CheckSquare,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { startOfDay, endOfDay, startOfWeek, startOfMonth, format } from '@/lib/safe-date-fns';
import { toZonedTime, fromZonedTime } from '@/lib/safe-date-fns-tz';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessSalesWorkspace, isFactoryUser } from '@/components/shared/rbac';
import { canSeeAllLeads } from '@/lib/leadVisibility';
import { useLeadVisibilityPolicy } from '@/hooks/useLeadVisibilityPolicy';
import { useCustomStatuses } from '@/hooks/useCustomStatuses';
import { LEAD_STATUS_OPTIONS, CLOSED_STATUSES, TIMEZONE } from '@/constants/leadOptions';
import { SOURCE_CHANNEL_FILTER_OPTIONS, SOURCE_CHANNEL_FILTER_LABELS, normalizeSourceFilterValue } from '@/constants/sourceChannels';
import { leadPhoneFilter, probePhoneKey } from '@/lib/phoneLookup';
import { excludeCancelled } from '@/lib/cancelOrder';
import ImportFromSheets from '@/components/lead/ImportFromSheets';
import LeadQuickActions from '@/components/lead/LeadQuickActions';
import RepSelectItem from '@/components/shared/RepSelectItem';

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
// contact_id earns its place: it is what the duplicate-lead warning is computed
// from. Leaving it out is why that warning never appeared on this screen — the
// rows arrived without a contact, useRepeatEnquiries had nothing to group by,
// and the marker silently rendered nothing on every row.
// pending_rep_email likewise: without it the נציג column cannot tell a lead
// nobody has ("לא משויך") from one already offered to a rep who hasn't picked
// it up ("ממתין: …") — two different states, one of which needs a manager.
const LEAD_LIST_COLUMNS = 'id,full_name,phone,status,source,rep1,rep2,pending_rep_email,contact_id,facebook_ad_name,first_action_at,effective_sort_date,created_date';

function fmt(n) { return Number(n || 0).toLocaleString(); }

// PostgREST answers with at most `db-max-rows` (1000 on Supabase) no matter
// what limit the client asks for, and it says nothing about having truncated.
// Asking for 5000 open tasks therefore returned the first 1000 — 879 leads out
// of 1936 — and the tile reported 879 with no sign that anything was cut.
// Paging until a short page arrives is the only way to know we have them all.
// The page cap is a runaway guard, and hitting it is logged rather than
// silently swallowed: a wrong number that announces itself can be fixed.
async function fetchAllRows(entity, filters, sort, columns, { pageSize = 1000, maxPages = 30 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await entity.filter(filters, sort, pageSize, page * pageSize, columns);
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  console.warn(`[LeadManagement] stopped paging at ${maxPages * pageSize} rows — the tile counts are a floor, not a total.`);
  return rows;
}

// The full calendar DAY containing `now`, anchored to Israel wall-clock time
// regardless of the viewer's device timezone: 00:00:00 → next day 00:00:00.
// Returned as UTC ISO strings so the boundaries can be handed straight to an
// effective_sort_date range filter. Overflowing day numbers (e.g. the 32nd) are
// normalised by the Date constructor, so month/year rollover is automatic.
//
// This replaces the old 20:00→20:00 "shift cycle": intake is counted per real
// day (all 24 hours), and any narrower cut is done with the hour filter below.
function israelDayWindow(now = new Date()) {
  const zoned = toZonedTime(now, TIMEZONE);
  const y = zoned.getFullYear();
  const mo = zoned.getMonth();
  const d = zoned.getDate();
  const at = (day, hour) => fromZonedTime(new Date(y, mo, day, hour, 0, 0, 0), TIMEZONE).toISOString();
  return { from: at(d, 0), to: at(d + 1, 0) };
}

// ─── Hour-of-day (Israel time) intake filter ────────────────────
// Narrows the list to the hours a lead ARRIVED in — e.g. 09:00–12:00 — on top
// of the selected date range. `to` is EXCLUSIVE, so 9→12 means the 09/10/11
// hours and 0→24 means the whole day. The hour itself is computed in SQL by the
// `arrival_hour_il` computed column (effective_sort_date AT TIME ZONE
// Asia/Jerusalem), so the filter works server-side for any range and stays
// consistent between the list, the counts and the KPI tiles.
// An end earlier than the start is a window that crosses midnight (20:00→08:00)
// and becomes an OR of the two halves.
const HOUR_COLUMN = 'arrival_hour_il';

// ─── Source (channel) filter ────────────────────────────────────
// `leads.source` is free text — 100+ distinct campaign names in two alphabets —
// so the "מקור הגעה" filter compares the CHANNEL that text resolves to (the
// same resolution the SourceBadge renders), via the `source_channel` computed
// column added by migration 20260824000001. Comparing the raw column verbatim
// is what made every pick return an empty list: almost no row literally says
// 'website'.
const SOURCE_CHANNEL_COLUMN = 'source_channel';

function hourRangeCondition(from, to) {
  const f = Number.isInteger(from) ? from : 0;
  const t = Number.isInteger(to) ? to : 24;
  if (f === t) return null;            // nonsense/empty selection → no filter
  if (f === 0 && t === 24) return null; // whole day → no filter
  if (f < t) return { [HOUR_COLUMN]: { $gte: f, $lt: t } };
  return { $or: [{ [HOUR_COLUMN]: { $gte: f } }, { [HOUR_COLUMN]: { $lt: t } }] };
}

// Label for an hour boundary: 9 → "09:00", 24 → "24:00".
function hourLabel(h) {
  return `${String(h).padStart(2, '0')}:00`;
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
// whose count matches the number on the card. These honor the date range and
// the hour window, exactly like the counts on the cards.
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
// Tiles whose bucket lives in another table: nothing on `leads` says "has an
// open quote", so those scopes resolve to a set of lead ids first and the list
// filters on those.
const RELATED_SCOPES = ['open_quotes', 'tasks_today', 'tasks_open', 'won'];

function buildLeadsQuery({ filters, dateRange, scope, userEmail, seesAllLeads, hourCond, phoneKeySupported, sourceChannelSupported, relatedLeadIds }) {
  const conditions = [];
  const startDate = dateRange?.from instanceof Date ? dateRange.from : null;
  const endDate = dateRange?.to instanceof Date ? dateRange.to : null;
  const hasRange = startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime());

  // Narrow to the user's own leads only when the visibility policy says so.
  // This filter decides which rows leave the database, so it has to agree with
  // canViewLead() downstream — both read the same switch.
  if (!seesAllLeads) {
    conditions.push({ $or: [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }] });
  }
  if (scope === 'unassigned') {
    conditions.push({ $or: [{ rep1: null }, { rep1: '' }] });
  } else if (scope === 'assigned_unhandled') {
    // "לידים חדשים" — has an owning rep but is still sitting at new_lead,
    // i.e. nothing happened beyond the assignment itself. (The scope id is
    // the older name for the same rule; only the label changed.)
    conditions.push({ status: 'new_lead' });
    conditions.push({ rep1: { $ne: null } });
    conditions.push({ rep1: { $ne: '' } });
  } else if (scope === 'handling') {
    // בטיפול — past the new_lead stage and not yet closed.
    conditions.push({ status: { $nin: HANDLING_EXCLUDED_STATUSES } });
  } else if (RELATED_SCOPES.includes(scope)) {
    // An empty set has to return nothing rather than everything, so the
    // impossible id is deliberate.
    conditions.push({ id: { $in: relatedLeadIds && relatedLeadIds.length ? relatedLeadIds : ['__none__'] } });
  } else if (LIFECYCLE_SCOPES[scope]) {
    // Per-rep workload drill-down (חדשים/בטיפול/נסגרו/נאבדו). Combined with the
    // rep filter below it reproduces the count shown on that rep's card.
    conditions.push(LIFECYCLE_SCOPES[scope]);
  }
  // The arrival-date range is skipped for the quote / task scopes: those tiles
  // count open quotes and open tasks, which say nothing about when the lead
  // came in. Applying it on top is what made "26 הצעות פתוחות" open a list of
  // one — the other 25 belong to leads that arrived on earlier days.
  if (hasRange && !RELATED_SCOPES.includes(scope)) {
    conditions.push({ effective_sort_date: { $gte: startDate.toISOString(), $lte: endDate.toISOString() } });
  }
  // Hour-of-day narrowing rides on top of the date range.
  if (hourCond) conditions.push(hourCond);
  if (filters.rep && filters.rep !== 'all') {
    conditions.push({ $or: [{ rep1: filters.rep }, { rep2: filters.rep }] });
  }
  if (filters.status && filters.status !== 'all') {
    conditions.push({ status: filters.status });
  }
  if (filters.source && filters.source !== 'all') {
    // Channel match where the computed column exists; on an environment whose
    // migration hasn't run yet the old verbatim compare is all the server can
    // do (it still finds the few rows that store the key itself).
    conditions.push(sourceChannelSupported
      ? { [SOURCE_CHANNEL_COLUMN]: filters.source }
      : { source: filters.source });
  }
  if (filters.search) {
    const s = filters.search;
    // The phone leg matches the canonical key when the text is a complete
    // Israeli number, so searching "050-123-4567" also finds the lead that a
    // webhook stored as "+972501234567" (a raw ILIKE never did — the separators
    // break the digit run). Partial input still matches the raw column.
    const phoneLeg = leadPhoneFilter(s, { canonical: phoneKeySupported });
    conditions.push({ $or: [
      { full_name: { $regex: s, $options: 'i' } },
      phoneLeg,
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

// Where the page opens, for managers and reps alike. Today's intake is the
// shift people actually work; opening on 'all' meant six-figure tile counts
// and a rep-workload panel measuring years, neither of which describes the
// floor right now. Also the clean-URL case in `updateUrl`, so a link that
// pins any OTHER range — including 'all' — survives back-nav.
const DEFAULT_DATE_PRESET = 'today';

function resolveDatePreset(id, customRange) {
  const now = new Date();
  switch (id) {
    // "היום" = the whole Israel calendar day (00:00–23:59:59.999), so it means
    // the same thing as the intake tile no matter where the viewer's device is.
    case 'today': {
      const w = israelDayWindow(now);
      return { from: new Date(w.from), to: new Date(new Date(w.to).getTime() - 1) };
    }
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

  // Auth + role. Resolved up here because the rep filter's DEFAULT depends on
  // who is looking (see defaultRep below), and updateUrl needs that default to
  // know whether the current selection is worth writing to the URL.
  const [user, setUser] = useState(null);
  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);
  const effectiveUser = getEffectiveUser(user);
  const isAdmin = effectiveUser?.role === 'admin';
  // isAdmin still gates management CHROME (bulk assign, reps panel, the
  // unassigned pool). seesAllLeads gates DATA. Keeping them separate is what
  // stops opening visibility from handing every rep the admin toolbar.
  // Passed explicitly rather than read from the module cache, so flipping the
  // setting in Settings re-renders this page.
  const leadVisibilityPolicy = useLeadVisibilityPolicy();
  const seesAllLeads = canSeeAllLeads(effectiveUser, leadVisibilityPolicy);
  const userEmail = effectiveUser?.email;

  // Where the rep filter STARTS. Every rep can see every lead, but "my leads"
  // is the list they actually work from — opening on the whole floor's pipeline
  // buries their own. So a rep lands on themselves and can widen to all; a
  // manager lands on all, which is their job. Reps who only see their own leads
  // are excluded: the server already scopes them, and the filter chip would be
  // a control that appears to do nothing.
  const defaultRep = useMemo(
    () => (!isAdmin && seesAllLeads && userEmail ? userEmail : 'all'),
    [isAdmin, seesAllLeads, userEmail],
  );

  const [datePresetId, setDatePresetId] = useState(urlParams.get('preset') || DEFAULT_DATE_PRESET);
  const [customRange, setCustomRange] = useState(() => {
    const from = urlParams.get('startDate');
    const to = urlParams.get('endDate');
    return from && to ? { from: new Date(from), to: new Date(to) } : null;
  });
  const [scope, setScope] = useState(urlParams.get('scope') || 'all'); // 'all' | 'new' | 'unassigned' | 'open'
  // Hour-of-day intake window (Israel time). null = no hour narrowing.
  // `hourTo` is exclusive; hourTo < hourFrom means the window crosses midnight.
  const [hourFrom, setHourFrom] = useState(() => {
    const v = Number(urlParams.get('hourFrom'));
    return Number.isInteger(v) && v >= 0 && v <= 23 && urlParams.get('hourFrom') !== null ? v : null;
  });
  const [hourTo, setHourTo] = useState(() => {
    const v = Number(urlParams.get('hourTo'));
    return Number.isInteger(v) && v >= 1 && v <= 24 && urlParams.get('hourTo') !== null ? v : null;
  });
  const [filters, setFilters] = useState({
    search: urlParams.get('search') || '',
    status: urlParams.get('status') || 'all',
    // Old links carry the retired picker keys ('digital', 'returning_customer');
    // they land on the channel they resolve to, so the deep link keeps working.
    source: normalizeSourceFilterValue(urlParams.get('source') || 'all'),
    rep: urlParams.get('rep') || 'all',
  });
  // A rep pinned in the URL is an explicit choice — a deep link, or back-nav
  // from a lead — and must beat the default. Otherwise we wait for the user to
  // load and apply defaultRep exactly once; `repResolved` also gates the list
  // queries below, so the page doesn't fetch the whole floor and then
  // immediately re-fetch the rep's own slice.
  const [repResolved, setRepResolved] = useState(() => urlParams.has('rep'));
  useEffect(() => {
    if (repResolved || !effectiveUser) return;
    setFilters((prev) => ({ ...prev, rep: defaultRep }));
    setRepResolved(true);
  }, [repResolved, effectiveUser, defaultRep]);
  const [selectedLeads, setSelectedLeads] = useState([]);
  // The design has no checkbox column and no rep panel on the way in — both are
  // manager tools you reach for, so they start closed.
  const [multiSelect, setMultiSelect] = useState(false);
  const [showWorkload, setShowWorkload] = useState(false);
  const [assigningRep, setAssigningRep] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [limit, setLimit] = useState(Number(urlParams.get('limit')) || 100);

  // Reflect the current filter state back into the URL so the browser's
  // back/forward buttons restore it, and so a deep-link to this page
  // can pin to a specific cut. replace: true to avoid creating a new
  // history entry per keystroke in search.
  const updateUrl = useCallback((next) => {
    const params = new URLSearchParams();
    // Written whenever it DEVIATES from the default, not whenever it isn't
    // 'all' — the same rule `rep` uses below. With 'today' as the default the
    // old `!== 'all'` test would have dropped ?preset=all from the URL, so
    // picking "כל הזמנים" and then coming back from a lead would silently
    // snap the range back to today.
    if (next.preset && next.preset !== DEFAULT_DATE_PRESET) params.set('preset', next.preset);
    if (next.range?.from) params.set('startDate', next.range.from.toISOString());
    if (next.range?.to)   params.set('endDate',   next.range.to.toISOString());
    if (next.scope && next.scope !== 'all') params.set('scope', next.scope);
    if (next.hourFrom != null) params.set('hourFrom', String(next.hourFrom));
    if (next.hourTo != null) params.set('hourTo', String(next.hourTo));
    if (next.filters?.search) params.set('search', next.filters.search);
    if (next.filters?.status && next.filters.status !== 'all') params.set('status', next.filters.status);
    if (next.filters?.source && next.filters.source !== 'all') params.set('source', next.filters.source);
    // Written whenever it DEVIATES from this user's default, not whenever it
    // isn't 'all'. That way a rep who widens to "כל הנציגים" gets ?rep=all and
    // keeps it across back-nav, while everyone sitting on their own default
    // keeps a clean URL — and a clean URL re-applies the default on the next
    // visit, which is the whole point.
    if (next.filters?.rep && next.filters.rep !== defaultRep) params.set('rep', next.filters.rep);
    if (next.limit && next.limit !== 100) params.set('limit', String(next.limit));
    const search = params.toString();
    navigate(search ? `${location.pathname}?${search}` : location.pathname, { replace: true });
  }, [navigate, location.pathname, defaultRep]);

  useEffect(() => {
    updateUrl({ preset: datePresetId, range: customRange, scope, filters, limit, hourFrom, hourTo });
  }, [datePresetId, customRange, scope, filters, limit, hourFrom, hourTo, updateUrl]);

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
  // Is the SQL side of the hour filter available? `arrival_hour_il` is a
  // PostgREST computed column added by a migration; on an environment where the
  // migration hasn't run yet the query would 400, so probe once and simply
  // don't offer the control until it's there (same graceful-degradation
  // approach the rest of this page uses for new DB objects).
  const { data: hourFilterSupported = false } = useQuery({
    queryKey: ['leadArrivalHourSupported'],
    enabled: !!effectiveUser,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { error } = await base44.supabase.from('leads').select('id').gte(HOUR_COLUMN, 0).limit(1);
      if (error) {
        // Not fatal — the control simply stays hidden. Logged so a missing
        // migration is obvious in the console instead of silently absent.
        console.warn('[leads] hour filter unavailable (arrival_hour_il):', error.message);
        return false;
      }
      return true;
    },
  });

  // Same one-shot probe for the source-channel computed column: filter by
  // channel where it exists, fall back to the old verbatim compare where the
  // migration hasn't landed, so the request never 400s.
  const { data: sourceChannelSupported = false } = useQuery({
    queryKey: ['leadSourceChannelSupported'],
    enabled: !!effectiveUser,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { error } = await base44.supabase.from('leads').select('id').eq(SOURCE_CHANNEL_COLUMN, 'google').limit(1);
      if (error) {
        console.warn('[leads] source-channel filter unavailable (source_channel):', error.message);
        return false;
      }
      return true;
    },
  });

  // Same one-shot probe for the canonical phone key: the phone leg of the search
  // uses it only where it exists, so a not-yet-migrated environment keeps the
  // old substring behaviour instead of failing the request.
  const { data: phoneKeySupported = false } = useQuery({
    queryKey: ['leadPhoneKeySupported'],
    enabled: !!effectiveUser,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: () => probePhoneKey(base44.supabase),
  });

  const hourCond = useMemo(
    () => (hourFilterSupported ? hourRangeCondition(hourFrom, hourTo) : null),
    [hourFilterSupported, hourFrom, hourTo],
  );
  const hourKey = hourCond ? `${hourFrom ?? 0}-${hourTo ?? 24}` : '';
  const hourActive = Boolean(hourCond);

  // Today's intake — the full Israel calendar day (all 24 hours), independent of
  // the date-range picker and of the hour filter: the headline tile answers
  // "how many leads came in today?" and must not move when the manager narrows
  // the view. Computed on mount; a page left open past midnight is refreshed by
  // the normal refetch cycle.
  const todayWindow = useMemo(() => israelDayWindow(), []);
  // ───────────────────────────────────────────────────────────────
  // Category KPI tiles. All buckets respect the selected date range.
  // ───────────────────────────────────────────────────────────────
  const EMPTY_KPI = {
    assignedUnhandledCount: 0, unassignedCount: 0, handlingCount: 0, totalCount: 0,
  };
  const { data: kpiCounts = EMPTY_KPI } = useQuery({
    queryKey: ['leadMgmt-kpis', seesAllLeads, userEmail, filters.rep, fromIso, toIso, hourKey],
    enabled: !!effectiveUser && !!userEmail && repResolved,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      // base(extra) builds a count filter honoring the page date range + hour window.
      const base = (extra) => {
        const conditions = [];
        if (!seesAllLeads) conditions.push({ $or: [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }] });
        if (filters.rep && filters.rep !== 'all') conditions.push({ $or: [{ rep1: filters.rep }, { rep2: filters.rep }] });
        if (fromIso && toIso) conditions.push({ effective_sort_date: { $gte: fromIso, $lte: toIso } });
        if (hourCond) conditions.push(hourCond);
        if (Array.isArray(extra)) conditions.push(...extra);
        else if (extra) conditions.push(extra);
        if (conditions.length === 0) return {};
        if (conditions.length === 1) return conditions[0];
        return { $and: conditions };
      };
      const [assignedUnhandledCount, unassignedCount, handlingCount, totalCount] = await Promise.all([
        base44.entities.Lead.count(base([{ status: 'new_lead' }, { rep1: { $ne: null } }, { rep1: { $ne: '' } }])),
        base44.entities.Lead.count(base({ $or: [{ rep1: null }, { rep1: '' }] })),
        base44.entities.Lead.count(base({ status: { $nin: HANDLING_EXCLUDED_STATUSES } })),
        base44.entities.Lead.count(base()),
      ]);
      return { assignedUnhandledCount, unassignedCount, handlingCount, totalCount };
    },
  });

  // The rep whose numbers these are, or null for whoever sees the whole floor.
  // Every tile below carries it, which is what makes the rep's screen the same
  // screen showing their own leads, quotes, tasks and closings.
  const scopedRep = (filters.rep && filters.rep !== 'all')
    ? filters.rep
    : (seesAllLeads ? null : userEmail);

  // The tasks tile counts over the TASK's due date, which is a different axis
  // from the arrival-date range every other tile uses — a task due tomorrow
  // says nothing about when its lead came in, which is why the quote/task
  // scopes ignore that range in the first place. But a task HAS a date of its
  // own, so the filter can mean something here: it selects the window the work
  // is due in. Picking 02/08–10/08 answers "what was due that week and is
  // still open", which is the backlog question the tile could not answer while
  // it was pinned to today.
  //
  // With no range chosen ("כל הזמנים") today is the sensible default — an
  // unbounded task tile is just the "נותרו לטיפול" tile beside it.
  const taskDueWindow = useMemo(() => (
    fromIso && toIso
      ? { from: fromIso, to: toIso }
      : { from: todayWindow.from, to: new Date(new Date(todayWindow.to).getTime() - 1).toISOString() }
  ), [fromIso, toIso, todayWindow]);
  // Today is the ordinary case, and the tile keeps its familiar name there.
  const taskWindowIsToday = !fromIso || !toIso || datePresetId === 'today';
  const tasksTileLabel = taskWindowIsToday ? 'משימות להיום' : 'משימות בטווח';

  // What the header says the numbers are cut by ("תצוגת נתונים לפי: היום").
  const activePresetLabel = datePresetId === 'range' && customRange?.from && customRange?.to
    ? `${format(customRange.from, 'dd/MM/yyyy')} - ${format(customRange.to, 'dd/MM/yyyy')}`
    : (DATE_PRESETS.find((preset) => preset.id === datePresetId)?.label || 'כל הזמנים');

  // Leads behind the quote / task tiles. Each tile counts LEADS — the rows the
  // list shows when you click it — not quote or task rows, so the number on
  // the tile is exactly the number the click produces. One resolver, used both
  // for the counts and for the active scope.
  const relatedScopeSets = useQuery({
    queryKey: ['leadMgmt-related-sets', scopedRep, taskDueWindow.from, taskDueWindow.to],
    enabled: !!effectiveUser && !!userEmail && repResolved,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const mine = scopedRep ? [{ $or: [{ rep1: scopedRep }, { rep2: scopedRep }] }] : [];
      const wrap = (conditions) => (conditions.length === 1 ? conditions[0] : { $and: conditions });
      const leadIds = (rows) => [...new Set(rows.map((row) => row.lead_id).filter(Boolean))];

      const [quotes, openTasks] = await Promise.all([
        fetchAllRows(
          base44.entities.Quote,
          wrap([{ status: { $in: ['draft', 'sent'] } }, ...(scopedRep ? [{ created_by_rep: scopedRep }] : [])]),
          '-created_date',
          'lead_id',
        ).catch(() => []),
        // due_date rides along because the tasks-in-window set is cut from the
        // same rows — one trip instead of two.
        fetchAllRows(
          base44.entities.SalesTask,
          wrap([{ task_status: 'not_completed' }, ...mine]),
          'due_date',
          'lead_id,due_date',
        ).catch(() => []),
      ]);

      // Open tasks whose due date lands in the selected window. Still open is
      // the point: in a window that has passed, these are the ones nobody got
      // to, which is what the rep opens the tile to find.
      const dueInWindow = openTasks.filter((task) => {
        const due = task?.due_date;
        return due && due >= taskDueWindow.from && due <= taskDueWindow.to;
      });

      return {
        open_quotes: leadIds(quotes),
        tasks_open: leadIds(openTasks),
        tasks_today: leadIds(dueInWindow),
      };
    },
  }).data || { open_quotes: [], tasks_open: [], tasks_today: [] };

  // Sales in the selected range — read off the ORDERS, which are the sales.
  //
  // This used to count leads sitting at status 'deal_closed' and then sum the
  // orders hanging off them. Two different things were being called one: a lead
  // is marked closed by hand, and reps mark it when the customer says yes, days
  // before anyone writes the order — while an order that came in without a lead
  // (a walk-in, a returning customer) was a sale nobody counted. The status is a
  // pipeline state; the order is the sale. So the tile now counts orders created
  // in the range and sums their totals, and the two numbers on it come from the
  // same rows.
  //
  // Cancelled orders are dropped: a sale that fell through is not revenue. Same
  // rule the הזמנות screen applies to its own money cubes.
  const { data: sales = { count: 0, total: 0, leadIds: [] } } = useQuery({
    queryKey: ['leadMgmt-sales', scopedRep, fromIso, toIso],
    enabled: !!effectiveUser && !!userEmail && repResolved,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const conditions = [];
      if (scopedRep) conditions.push({ $or: [{ rep1: scopedRep }, { rep2: scopedRep }] });
      if (fromIso && toIso) conditions.push({ created_date: { $gte: fromIso, $lte: toIso } });
      const orders = await fetchAllRows(
        base44.entities.Order,
        conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { $and: conditions },
        '-created_date',
        'id,lead_id,total,cancelled_at',
      );
      const live = excludeCancelled(orders);
      const total = live.reduce((sum, order) => sum + Number(order?.total ?? 0), 0);
      // The leads behind those orders, for the drill-down. Fewer rows than
      // orders when one customer ordered twice in the range — the tile counts
      // sales, the list shows the people who made them.
      const leadIds = [...new Set(live.map((order) => order.lead_id).filter(Boolean))];
      return { count: live.length, total, leadIds };
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
    queryKey: ['leadMgmt-workload', fromIso, toIso, hourKey, repEmailsKey],
    enabled: !!effectiveUser && isAdmin && repsForPanel.length > 0,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      const build = (conditions) => {
        const all = [...conditions];
        if (fromIso && toIso) all.push({ effective_sort_date: { $gte: fromIso, $lte: toIso } });
        if (hourCond) all.push(hourCond);
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
        // "לידים חדשים" = assigned-but-untouched. For a rep this is implicit
        // (the card is filtered to them). For the TEAM card (repEmail null) we
        // must add "has a rep", otherwise unassigned new leads — which belong to
        // the separate "לא משויכים" pool, not to anyone's workload — would inflate
        // it and clash with the "לידים חדשים" tile. Mirrors LIFECYCLE_SCOPES +
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
  // "סה״כ מכירות" drills into the leads behind the orders the tile counted, so
  // its id set comes from the sales query rather than from relatedScopeSets.
  const relatedLeadIds = (scope === 'won' ? sales.leadIds : relatedScopeSets[scope]) || [];
  // Only the ids for the page being shown go into the query. `{ id: { $in: … } }`
  // becomes `id=in.(uuid,uuid,…)` on a GET, so a scope holding 879 leads built a
  // ~33KB URL that the server refused — and the refusal rendered as an empty
  // list under a tile reading 879. Infinite scroll still works: `limit` grows,
  // the slice grows with it. The ids arrive in the related table's own order
  // (task due date, quote recency), which is the order these scopes want.
  const relatedLeadIdsPage = useMemo(
    () => relatedLeadIds.slice(0, limit),
    [relatedLeadIds, limit],
  );

  const leadsQuery = useMemo(
    () => buildLeadsQuery({
      filters, dateRange, scope, userEmail, seesAllLeads, hourCond, phoneKeySupported, sourceChannelSupported,
      relatedLeadIds: relatedLeadIdsPage,
    }),
    [filters, dateRange, scope, userEmail, seesAllLeads, hourCond, phoneKeySupported, sourceChannelSupported, relatedLeadIdsPage],
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
    enabled: !!effectiveUser && repResolved,
    staleTime: 60_000,
    placeholderData: (prev) => prev, // ← key: don't drop rows on loadMore so the scroll stays put
    queryFn: () => base44.entities.Lead.filter(leadsQuery, '-effective_sort_date', limit, undefined, LEAD_LIST_COLUMNS),
  });
  // A count over the sliced page would just report the page size, so the
  // related scopes report the size of the set the tile counted instead. Any
  // other filter on top narrows the rows below it, which is what the filter
  // chips above the list are there to say.
  const isRelatedScope = RELATED_SCOPES.includes(scope);
  const ignoresDateRange = isRelatedScope && scope !== 'tasks_today';
  const { data: countedLeads = null } = useQuery({
    queryKey: ['leadMgmt-count', leadsQuery],
    enabled: !!effectiveUser && repResolved && !isRelatedScope,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: () => base44.entities.Lead.count(leadsQuery),
  });
  const filteredCount = isRelatedScope ? relatedLeadIds.length : countedLeads;

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
    queryKey: ['leadMgmt-handling-breakdown', seesAllLeads, userEmail, filters.rep, filters.source, filters.search, fromIso, toIso, hourKey, sourceChannelSupported],
    enabled: !!effectiveUser && handlingBreakdownActive,
    staleTime: 60_000,
    placeholderData: (p) => p,
    queryFn: async () => {
      const ctx = (status, forcedScope) => buildLeadsQuery({
        filters: { ...filters, status }, dateRange, scope: forcedScope, userEmail, seesAllLeads, hourCond, phoneKeySupported, sourceChannelSupported,
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

  // "Is the rep looking at something narrower than their normal view" — which
  // is why the rep test is against defaultRep and not 'all'. A rep sitting on
  // their own leads is not filtering, that is where the page starts them;
  // measuring it against 'all' would leave the "לידים שהתקבלו" tile unable to
  // light up for anyone but a manager.
  const hasActiveFilter = Boolean(filters.search) || filters.status !== 'all' || filters.source !== 'all' || filters.rep !== defaultRep || scope !== 'all';

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
      setFilters((f) => ({ ...f, rep: defaultRep, status: 'all' }));
      setScope('all');
    } else {
      setFilters((f) => ({ ...f, rep: repEmail, status: 'all' }));
      setScope(bucketScope || 'all');
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Top bar — title, the view the numbers are cut by, and the three
          actions a manager reaches for from this screen. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            ניהול לידים
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            תצוגת נתונים לפי: <span className="text-foreground/80">{activePresetLabel}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* An exact day or a custom range. The presets beside it are the
              common cuts; this is how you reach any other one. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-11 rounded-xl gap-2 px-3.5 font-normal">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <span className="tabular-nums">
                  {customRange?.from && customRange?.to
                    ? `${format(customRange.from, 'dd/MM/yyyy')} - ${format(customRange.to, 'dd/MM/yyyy')}`
                    : dateRange
                      ? format(dateRange.from, 'dd/MM/yyyy')
                      : 'כל הזמנים'}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end" dir="rtl">
              <Calendar
                mode="range"
                selected={customRange || undefined}
                onSelect={(range) => { setCustomRange(range); if (range?.from) setDatePresetId('range'); }}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {/* היום / השבוע / החודש / הכל — one segmented control instead of a
              bar of loose chips. */}
          <div className="inline-flex items-center rounded-xl border border-border bg-card p-1 h-11">
            {DATE_PRESETS.filter((preset) => preset.id !== 'range').map((preset) => {
              const active = datePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => { setDatePresetId(preset.id); setCustomRange(null); }}
                  className={`h-9 px-5 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <LeadQuickActions
            toolbar
            currentUser={effectiveUser}
            onLeadCreated={() => {
              queryClient.invalidateQueries({ queryKey: ['leadMgmt-leads'] });
              queryClient.invalidateQueries({ queryKey: ['leadMgmt-kpis'] });
            }}
          />
        </div>
      </div>

      {/* The numbers the screen opens on. Every one of them is a filter:
          clicking a tile scopes the list below to exactly the rows it counts,
          and clicking it again releases the scope. For a rep each number is
          their own — their leads, their quotes, their tasks, their closings —
          because every query behind them carries the same rep scope the lead
          list does.
          Seven across is a wide-screen layout: below 1800px they wrap to a
          4-wide grid instead. A tile has ~88px of fixed furniture (padding +
          the icon), so seven of them across a 1500px workspace leaves a
          five-figure count wider than the space it has — and a number that
          overflows its tile can't be fixed by truncating it either, since an
          RTL ellipsis clips the leading digits. Giving each tile room is the
          only version that stays readable. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1800px]:grid-cols-7 gap-3">
        {/* Clicking this clears the filters back to where the page STARTS —
            which for a rep is their own leads, not the whole floor's. It used
            to reset rep to 'all', so the tile showed a rep "0 arrived today"
            and then opened everyone's list when they pressed it: the number
            and the click disagreed. Widening to all reps is still one click
            away, on the rep chip's ×, because that is the rep actually asking
            for it. */}
        <TaskKpiTile
          label="לידים שהתקבלו"
          value={kpiCounts.totalCount}
          sub={activePresetLabel}
          subTone="text-sky-600"
          icon={Users}
          tone="sky"
          isActive={scope === 'all' && !hasActiveFilter}
          onClick={() => { setScope('all'); setFilters({ search: '', status: 'all', source: 'all', rep: defaultRep }); }}
        />
        {/* Arrived but nobody owns it — the pool a manager works down. Sits
            beside "לידים שהתקבלו" because it is a slice of it: of everything
            that came in, these are the ones still waiting for a rep. Clicking
            it scopes the list to exactly those rows, and turning "בחירה מרובה"
            on from there is the whole assign-a-batch flow. */}
        <TaskKpiTile
          label="לא משויכים"
          value={kpiCounts.unassignedCount}
          sub="ממתינים לשיוך"
          subTone="text-amber-600"
          secondarySub={activePresetLabel}
          icon={UserX}
          tone="amber"
          isActive={scope === 'unassigned'}
          onClick={() => toggleScope('unassigned')}
        />
        <TaskKpiTile
          label="בטיפול"
          value={kpiCounts.handlingCount}
          sub={activePresetLabel}
          subTone="text-sky-600"
          icon={Hourglass}
          tone="indigo"
          isActive={scope === 'handling'}
          onClick={() => toggleScope('handling')}
        />
        <TaskKpiTile
          label="הצעות מחיר פתוחות"
          value={relatedScopeSets.open_quotes.length}
          sub="סה״כ פתוחות"
          icon={FileText}
          tone="emerald"
          isActive={scope === 'open_quotes'}
          onClick={() => toggleScope('open_quotes')}
        />
        <TaskKpiTile
          label={tasksTileLabel}
          value={relatedScopeSets.tasks_today.length}
          sub={taskWindowIsToday ? 'מתוכן להיום' : activePresetLabel}
          icon={ClipboardCheck}
          tone="amber"
          isActive={scope === 'tasks_today'}
          onClick={() => toggleScope('tasks_today')}
        />
        <TaskKpiTile
          label="נותרו לטיפול"
          value={relatedScopeSets.tasks_open.length}
          sub="טרם טופלו"
          subTone="text-rose-600"
          icon={Clock}
          tone="rose"
          isActive={scope === 'tasks_open'}
          onClick={() => toggleScope('tasks_open')}
        />
        <TaskKpiTile
          label="סה״כ מכירות"
          value={sales.count}
          sub={`${fmt(sales.total)} ₪`}
          subTone="text-emerald-600"
          secondarySub={activePresetLabel}
          icon={DollarSign}
          tone="emerald"
          isActive={scope === 'won'}
          onClick={() => toggleScope('won')}
        />
      </div>

      {/* Rep performance — admin only, and closed. It is a drill-down tool,
          not something you read on the way in, so the screen opens on the
          list and the panel is one click away. */}
      {isAdmin ? (
        <div>
          <button
            type="button"
            onClick={() => setShowWorkload((open) => !open)}
            className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            ביצועי הנציגים ({sortedReps.length} בצוות)
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showWorkload ? 'rotate-180' : ''}`} />
          </button>

          {showWorkload ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 mt-2">
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
          ) : null}
        </div>
      ) : null}

      {/* Filters — search, source, date, status, and the one button that
          undoes all of them. */}
      <div className="rounded-2xl border border-border bg-card shadow-card p-3 flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute inset-y-0 my-auto end-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="חפש לפי שם, טלפון או אימייל..."
            className="h-11 w-full rounded-xl border border-border bg-card ps-3 pe-9 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <LabeledFilter label="מקור הגעה">
          <Select
            value={filters.source}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, source: value }))}
          >
            <SelectTrigger className="h-11 w-48 rounded-xl"><SelectValue placeholder="כל המקורות" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המקורות</SelectItem>
              {/* The channels the מדיה badges show — the only vocabulary the
                  rows are actually labeled with (see SOURCE_CHANNEL_COLUMN). */}
              {SOURCE_CHANNEL_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledFilter>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-11 rounded-xl gap-2 font-normal">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <span className="tabular-nums">
                {dateRange
                  ? `${format(dateRange.from, 'dd/MM/yyyy')} - ${format(dateRange.to, 'dd/MM/yyyy')}`
                  : 'כל הזמנים'}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end" dir="rtl">
            <Calendar
              mode="range"
              selected={customRange || undefined}
              onSelect={(range) => { setCustomRange(range); if (range?.from) setDatePresetId('range'); }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <LabeledFilter label="סטטוס">
          <Select
            value={filters.status}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
          >
            <SelectTrigger className="h-11 w-48 rounded-xl"><SelectValue placeholder="כל הסטטוסים" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              {[...LEAD_STATUS_OPTIONS, ...customStatusesForFilter].map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledFilter>

        {isAdmin || seesAllLeads ? (
          <LabeledFilter label="נציג">
            <Select
              value={filters.rep}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, rep: value }))}
            >
              <SelectTrigger className="h-11 w-44 rounded-xl"><SelectValue placeholder="כל הנציגים" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הנציגים</SelectItem>
                {repsForPanel.map((r) => (
                  <RepSelectItem key={r.email} rep={r} />
                ))}
              </SelectContent>
            </Select>
          </LabeledFilter>
        ) : null}

        <Button
          variant="ghost"
          className="h-11 rounded-xl gap-2 bg-primary/5 text-primary hover:bg-primary/10"
          onClick={() => {
            setFilters({ search: '', status: 'all', source: 'all', rep: defaultRep });
            setScope('all');
            setHourFrom(null);
            setHourTo(null);
          }}
        >
          <XIcon className="h-4 w-4" />
          נקה פילטרים
        </Button>

        {isAdmin ? (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-xl"
            onClick={() => setShowImport(true)}
            title="ייבוא לידים מ-Google Sheets"
          >
            <FileSpreadsheet className="h-4 w-4" />
          </Button>
        ) : null}

        {isAdmin ? (
          <Button
            variant={multiSelect ? 'default' : 'outline'}
            className="h-11 rounded-xl gap-2"
            onClick={() => { setMultiSelect((on) => !on); setSelectedLeads([]); }}
            title="בחירה מרובה — להעברת לידים בין נציגים"
          >
            <CheckSquare className="h-4 w-4" />
            בחירה מרובה
          </Button>
        ) : null}
      </div>

      {/* Drill-down summary — only when a tile or a rep bucket is pinned. The
          everyday filters have "נקה פילטרים" above and need no banner. */}
      {scope !== 'all' ? (
        <ActiveFilterSummary
          scope={scope}
          filters={filters}
          // "הצעות מחיר פתוחות" and "נותרו לטיפול" deliberately ignore the
          // arrival-date range — an open quote says nothing about when its lead
          // came in — so the summary must not claim a date is narrowing them.
          // The tasks scope is the exception: it reads the range as the window
          // the work is due in, so its chip is the truth.
          dateRange={ignoresDateRange ? null : dateRange}
          hourLabel={hourActive ? `${hourLabel(hourFrom ?? 0)}–${hourLabel(hourTo ?? 24)}` : null}
          onClearHour={() => { setHourFrom(null); setHourTo(null); }}
          repNameByEmail={repNameByEmail}
          customStatusesForFilter={customStatusesForFilter}
          filteredCount={filteredCount}
          totalCount={kpiCounts.totalCount}
          onClearScope={() => setScope('all')}
          onClearFilter={(key) => setFilters((f) => ({ ...f, [key]: key === 'search' ? '' : 'all' }))}
          onClearAll={() => {
            setFilters({ search: '', status: 'all', source: 'all', rep: defaultRep });
            setScope('all');
            setHourFrom(null);
            setHourTo(null);
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
      {isAdmin && multiSelect && selectedLeads.length > 0 ? (
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
                  <RepSelectItem key={r.email} rep={r} />
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
      {isAdmin && multiSelect && leads.length > 0 ? (
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
        columnSet="tasks"
        showSelection={multiSelect}
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


// One number on the header strip: what it counts, the count, and the qualifier
// under it. Every tile is a filter, so they all take onClick; the isActive ring
// marks which one the list below is currently scoped to.
function TaskKpiTile({ label, value, sub, subTone = 'text-muted-foreground', secondarySub, icon: Icon, tone = 'sky', isActive = false, onClick }) {
  const TONES = {
    sky:     'bg-sky-50 text-sky-600',
    indigo:  'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber:   'bg-amber-50 text-amber-600',
    rose:    'bg-rose-50 text-rose-600',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-2xl border bg-card p-4 shadow-card text-start w-full transition-colors hover:border-primary/50 ${
        isActive ? 'border-primary ring-1 ring-primary/30' : 'border-border'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted-foreground truncate" title={label}>{label}</p>
        {/* Deliberately not truncated: an ellipsis on an RTL number eats its
            LEADING digits ("134,521" → "…21"), which reads as a small number
            rather than as a clipped one. The grid gives each tile enough room
            instead — see the breakpoints on it. */}
        <p className="text-3xl font-bold tabular-nums mt-1">{fmt(value)}</p>
        <p className={`text-xs mt-1 truncate ${subTone}`}>
          {sub}
          {secondarySub ? <span className="text-muted-foreground"> · {secondarySub}</span> : null}
        </p>
      </div>
      <span className={`h-11 w-11 flex-none rounded-full grid place-items-center ${TONES[tone] || TONES.sky}`}>
        <Icon className="h-5 w-5" />
      </span>
    </button>
  );
}

// A filter control with its name floating above it, the way the design labels
// מקור הגעה / סטטוס — a placeholder alone can't say what a select filters once
// a value is chosen.
function LabeledFilter({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground px-1">{label}</span>
      {children}
    </label>
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
    { scope: isTeam ? 'assigned_unhandled' : 'lc_new', label: 'לידים חדשים', title: isTeam ? 'לידים חדשים משויכים (ללא "לא משויכים")' : 'לידים חדשים שטרם טופלו', value: newCount, box: 'bg-sky-50', text: 'text-sky-700', sub: 'text-sky-700/80', ring: 'ring-sky-400 border-sky-500' },
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
  scope, filters, dateRange, hourLabel: hourText, repNameByEmail, customStatusesForFilter,
  filteredCount, totalCount, onClearScope, onClearFilter, onClearHour, onClearAll, extra,
}) {
  const SCOPE_LABELS = {
    assigned_unhandled: 'לידים חדשים',
    unassigned: 'לא משויכים',
    handling: 'בטיפול',
    lc_new: 'לידים חדשים',
    lc_handling: 'בטיפול',
    lc_won: 'נסגרו',
    lc_lost: 'נאבדו',
    open_quotes: 'הצעות מחיר פתוחות',
    tasks_today: 'משימות',
    tasks_open: 'נותרו לטיפול',
    won: 'מכירות',
  };
  const statusLabel = filters.status !== 'all'
    ? (LEAD_STATUS_OPTIONS.find((s) => s.value === filters.status)?.label
       || customStatusesForFilter.find((s) => s.value === filters.status)?.label
       || filters.status)
    : null;
  const sourceLabel = filters.source !== 'all' ? (SOURCE_CHANNEL_FILTER_LABELS[filters.source] || filters.source) : null;
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
    hourText && { key: 'hour', label: `שעה: ${hourText}`, onClear: onClearHour },
  ].filter(Boolean);
  // A date range / hour window on its own isn't really a "filter" — it's just
  // the period. Only rep/status/source/scope/search count as an actual filter.
  const hasNonDateFilter = chips.some((c) => c.key !== 'date' && c.key !== 'hour');
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
            <span className="text-sm font-semibold text-foreground">{hasNonDateFilter ? 'תוצאות הסינון' : 'לידים בטווח שנבחר'}</span>
          </div>
          <span className="text-3xl font-bold text-primary tabular-nums whitespace-nowrap">
            {filteredCount === null ? '...' : fmt(filteredCount)}
          </span>
          {hasNonDateFilter && pct != null ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              ({pct}% מתוך {fmt(totalCount)} בטווח)
            </span>
          ) : (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              כל הלידים שנכנסו בטווח שנבחר{hourText ? ` בין ${hourText}` : ''}
            </span>
          )}
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
