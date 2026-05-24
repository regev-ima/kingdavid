import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronLeft,
  TrendingUp,
  Crown,
  Users,
  DollarSign,
  Target,
  Activity,
  XCircle,
  Trophy,
  ListChecks,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  GitCompareArrows,
} from 'lucide-react';
import { startOfDay, endOfDay, subDays } from '@/lib/safe-date-fns';
import useDashboard2Data from '@/components/dashboard2/useDashboard2Data';
import { getDemoData } from '@/components/dashboard2/demoData';
import { TASK_STATUS_OPTIONS } from '@/constants/leadOptions';

// Time windows specific to the Team tab — independent of the global
// Dashboard2 range picker. The product brief calls these out explicitly:
// "שבוע אחרון, חודש אחרון, שלושה חודשים, חצי שנה". `demoRangeKey` maps
// each window onto a getDemoData() key so demo mode scales the numbers
// convincingly (the demo generator only understands the global preset
// names). `shortLabel` is the punchier wording used inside delta cards
// where space is tight ("שבוע" instead of "שבוע אחרון", etc).
const RANGE_PRESETS = [
  { id: '1w', label: 'שבוע אחרון', shortLabel: 'השבוע',   days: 7,   demoRangeKey: 'week'   },
  { id: '1m', label: 'חודש אחרון', shortLabel: 'החודש',   days: 30,  demoRangeKey: 'month'  },
  { id: '3m', label: '3 חודשים',   shortLabel: '3 חודשים', days: 90,  demoRangeKey: '90days' },
  { id: '6m', label: 'חצי שנה',    shortLabel: 'חצי שנה',  days: 180, demoRangeKey: 'custom' },
];

const PREV_LABEL_BY_ID = {
  '1w': 'שבוע קודם',
  '1m': 'חודש קודם',
  '3m': '3 חודשים קודמים',
  '6m': 'חצי שנה קודמת',
};

const AVATAR_PALETTE = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-violet-500', 'bg-cyan-500', 'bg-orange-500', 'bg-pink-500',
  'bg-teal-500', 'bg-indigo-500',
];

function colorForRep(rep, idx) {
  const key = rep?.email || rep?.full_name || String(idx);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initialsFor(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
}

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

function formatCurrencyCompact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n.toLocaleString()}`;
}

function tierFor(conv) {
  const n = Number(conv ?? 0);
  if (n >= 30) return { ring: 'ring-emerald-300', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  if (n >= 15) return { ring: 'ring-amber-300',   dot: 'bg-amber-500',   text: 'text-amber-700' };
  return         { ring: 'ring-red-300',     dot: 'bg-red-500',     text: 'text-red-700' };
}

// Period-over-period delta. Carries the raw current / previous so the
// renderer can show absolute numbers alongside the percentage (the
// product brief: "רק אחוזים זה לא מספיק"). `kind` keeps the good/bad
// judgement for colour, separate from the literal direction of change
// which is conveyed by the absolute "before → after" numbers.
function computeDelta(current, previous, { higherIsBetter = true, isPercent = false } = {}) {
  const cur = Number(current ?? 0);
  const prev = Number(previous ?? 0);
  if (!Number.isFinite(prev) || prev === 0) {
    if (cur === 0) return { kind: 'flat', pct: 0, abs: 0, current: cur, previous: prev, higherIsBetter, isPercent };
    return { kind: 'new', pct: null, abs: cur, current: cur, previous: prev, higherIsBetter, isPercent };
  }
  const abs = cur - prev;
  const pct = isPercent ? abs : (abs / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { kind: 'flat', pct, abs, current: cur, previous: prev, higherIsBetter, isPercent };
  const up = abs > 0;
  const good = higherIsBetter ? up : !up;
  return { kind: good ? 'good' : 'bad', pct, abs, current: cur, previous: prev, higherIsBetter, isPercent };
}

// Default renderer for delta values: percentage only (no value
// formatting since we don't know what unit it is). Used inside table
// cells where space is tight.
const defaultFormat = (n) => Number(n || 0).toLocaleString();

// Compact delta pill used in table cells. Colour = good/bad, arrow =
// literal direction of change. Tooltip carries the absolute numbers
// so the reader can hover for the "59 ← 20" detail.
function DeltaChip({ delta, format = defaultFormat, suffix = '%' }) {
  if (!delta || delta.kind === 'new') {
    return <span className="text-[10px] text-muted-foreground">חדש</span>;
  }
  if (delta.kind === 'flat') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" /> ללא שינוי
      </span>
    );
  }
  const up = delta.pct > 0;
  const good = delta.kind === 'good';
  const cls = good
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-red-50 text-red-700 border-red-200';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md border ${cls}`}
      title={`${format(delta.current)} כעת · ${format(delta.previous)} קודם`}
    >
      <Icon className="h-3 w-3" />
      {up ? '+' : ''}{Math.abs(delta.pct).toFixed(1)}{suffix}
    </span>
  );
}

// Expanded delta block for the hero stat tiles: percentage chip + the
// actual before / after numbers spelled out. Solves the original
// confusion ("a green-down arrow") by always showing the real numbers
// so the direction of change is unambiguous regardless of colour.
function DeltaDetail({ delta, format = defaultFormat, periodLabel, prevPeriodLabel, suffix = '%' }) {
  if (!delta) return null;
  if (delta.kind === 'new') {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        אין נתונים ל{prevPeriodLabel} להשוואה
      </p>
    );
  }
  if (delta.kind === 'flat') {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Minus className="h-3 w-3" /> ללא שינוי לעומת {prevPeriodLabel}
      </p>
    );
  }
  const up = delta.pct > 0;
  const good = delta.kind === 'good';
  const chipCls = good
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : 'bg-red-100 text-red-800 border-red-200';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="mt-2 space-y-1">
      <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-md border ${chipCls}`}>
        <Icon className="h-3 w-3" />
        {up ? '+' : ''}{Math.abs(delta.pct).toFixed(1)}{suffix}
        <span className="mx-1 opacity-60">·</span>
        {good ? 'שיפור' : 'ירידה'}
      </span>
      <p className="text-[11px] text-muted-foreground leading-tight">
        <span className="font-semibold text-foreground">{format(delta.current)}</span> {periodLabel}
        <span className="mx-1 opacity-50">·</span>
        <span className="font-semibold text-foreground/80">{format(delta.previous)}</span> {prevPeriodLabel}
      </p>
    </div>
  );
}

// Tiny inline trend indicator used on each rep chip — just an arrow,
// no number, so it doesn't overflow the compact pill layout.
function TrendDot({ delta }) {
  if (!delta || delta.kind === 'new' || delta.kind === 'flat') return null;
  const good = delta.kind === 'good';
  const up = delta.pct > 0;
  return (
    <span
      className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded-full ${good ? 'bg-emerald-500' : 'bg-red-500'} text-white`}
      title={good ? 'משתפר לעומת התקופה הקודמת' : 'יורד לעומת התקופה הקודמת'}
    >
      {up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
    </span>
  );
}

// Big stat card used in the detail panel. The accent ring + colored
// value make each metric scannable at a glance from across the room.
// Optional `delta` (+ format / period labels) renders a coloured
// chip + the actual before/after numbers directly under the value, so
// the trend is unambiguous without scanning a second table.
function StatTile({ label, value, sub, icon: Icon, tone = 'indigo', delta, deltaFormat, deltaSuffix, periodLabel, prevPeriodLabel }) {
  const toneClass = {
    indigo:  'bg-indigo-50  border-indigo-200  text-indigo-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber:   'bg-amber-50   border-amber-200   text-amber-700',
    red:     'bg-red-50     border-red-200     text-red-700',
    blue:    'bg-blue-50    border-blue-200    text-blue-700',
    violet:  'bg-violet-50  border-violet-200  text-violet-700',
  }[tone];
  return (
    <div className={`rounded-xl border ${toneClass} p-4`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-medium opacity-80">{label}</p>
        {Icon ? <Icon className="h-4 w-4 opacity-60" /> : null}
      </div>
      <p className="text-2xl font-bold leading-none">{value}</p>
      {delta ? (
        <DeltaDetail
          delta={delta}
          format={deltaFormat}
          suffix={deltaSuffix}
          periodLabel={periodLabel}
          prevPeriodLabel={prevPeriodLabel}
        />
      ) : null}
      {sub ? <p className="text-[11px] mt-2 opacity-70">{sub}</p> : null}
    </div>
  );
}

// Horizontal progress-style breakdown of closing / handling / lost for a
// single rep (or the aggregate team). Three segments stack into one bar.
function FunnelBar({ closing = 0, handling = 0, lost = 0 }) {
  const sum = closing + handling + lost;
  const safe = sum > 0 ? sum : 1;
  const seg = (v) => `${(v / safe) * 100}%`;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/50">
        <div className="bg-emerald-500" style={{ width: seg(closing) }} title={`סגירה ${closing.toFixed(0)}%`} />
        <div className="bg-amber-500"   style={{ width: seg(handling) }} title={`בטיפול ${handling.toFixed(0)}%`} />
        <div className="bg-red-500"     style={{ width: seg(lost) }}     title={`אבד ${lost.toFixed(0)}%`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> סגירה {closing.toFixed(0)}%</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> בטיפול {handling.toFixed(0)}%</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> אבד {lost.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// Format a duration in milliseconds into a compact Hebrew string.
// < 1h → "X דק׳", < 24h → "X שעות", else "X.Y ימים". Used for the
// "זמן טיפול ממוצע" tile so the number is readable at a glance instead
// of forcing the reader to mentally convert milliseconds.
function formatDuration(ms) {
  const safe = Number(ms) || 0;
  if (safe <= 0) return '—';
  const minutes = safe / (1000 * 60);
  if (minutes < 60) return `${Math.round(minutes)} דק׳`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} שעות`;
  const days = hours / 24;
  return `${days.toFixed(1)} ימים`;
}

// Stable demo data for tasks per rep — only used when "מצב הדגמה" is on
// so the table reads as alive without hitting Supabase. Each rep gets a
// plausible mix of statuses and a deterministic avg-handling spread.
function demoTasksFor(repEmail, rangeKey) {
  const seedRoot = (repEmail || 'team') + rangeKey;
  let seed = 0;
  for (let i = 0; i < seedRoot.length; i += 1) seed = (seed * 31 + seedRoot.charCodeAt(i)) | 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) | 0; return Math.abs(seed % 1000) / 1000; };
  // Strip the "-prev" suffix the previous-period call adds so both
  // periods scale off the same baseline (the only seed difference is
  // the per-rep RNG noise added below).
  const scaleKey = String(rangeKey || '').replace(/-prev$/, '');
  const scale = { '1w': 0.25, '1m': 1, '3m': 2.6, '6m': 4.8 }[scaleKey] || 1;
  const base = repEmail ? 18 : 84; // aggregate ≈ 5× one rep
  const completed   = Math.round((base + rng() * 15) * scale);
  const notCompleted = Math.round((base * 0.55 + rng() * 10) * scale);
  const notDone     = Math.round((base * 0.18 + rng() * 5) * scale);
  const cancelled   = Math.round((base * 0.08 + rng() * 3) * scale);
  // Avg handling between ~2h and ~3 days. Higher for low-converters.
  const avgHours = 2 + rng() * 70;
  return {
    counts: { completed, not_completed: notCompleted, not_done: notDone, cancelled },
    avgHandlingMs: Math.round(avgHours * 60 * 60 * 1000),
    completedCount: completed,
  };
}

// Aggregate a list of reps into one virtual "team" row. Rates are
// re-derived from totals so the team conversion is the true weighted
// average, not the simple mean of per-rep percentages.
function aggregateTeam(reps) {
  const totals = reps.reduce(
    (acc, r) => {
      const leads = Number(r.leads_count || 0);
      const won = Number(r.won_count || 0);
      const inHandling = leads * (Number(r.in_handling_rate || 0) / 100);
      const lost = leads * (Number(r.lost_rate || 0) / 100);
      acc.leads += leads;
      acc.won += won;
      acc.inHandling += inHandling;
      acc.lost += lost;
      acc.revenue += Number(r.revenue || 0);
      return acc;
    },
    { leads: 0, won: 0, inHandling: 0, lost: 0, revenue: 0 },
  );
  const pct = (n) => (totals.leads > 0 ? +((n / totals.leads) * 100).toFixed(1) : 0);
  return {
    full_name: 'כל הצוות',
    leads_count: totals.leads,
    won_count: Math.round(totals.won),
    conversion: pct(totals.won),
    in_handling_rate: pct(totals.inHandling),
    lost_rate: pct(totals.lost),
    revenue: totals.revenue,
  };
}

// One rep "chip" at the top of the tab. Doubles as a filter selector —
// clicking it scopes the detail panel below to that rep (or back to the
// aggregate when "כל הצוות" is selected).
function RepChip({ rep, idx, selected, onClick, isAggregate, trend }) {
  const tier = tierFor(rep.conversion);
  const color = isAggregate ? 'bg-indigo-600' : colorForRep(rep, idx);
  const initials = isAggregate ? 'כל' : initialsFor(rep.full_name || rep.email);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-full border px-2 py-1 transition-all flex-shrink-0 ${
        selected
          ? 'border-primary bg-primary/5 shadow-sm scale-[1.02]'
          : 'border-border hover:border-primary/40 hover:bg-muted/40'
      }`}
      title={rep.full_name || rep.email}
    >
      <span className="relative">
        <span className={`h-8 w-8 rounded-full ${color} text-white text-xs font-bold flex items-center justify-center ring-2 ${selected ? 'ring-primary/40' : 'ring-white'}`}>
          {initials}
        </span>
        {!isAggregate ? (
          <span className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full ${tier.dot} ring-2 ring-background`} />
        ) : null}
      </span>
      <span className="pe-1 text-xs">
        <span className="flex items-center gap-1 font-semibold text-foreground leading-tight max-w-[140px]">
          <span className="truncate">{isAggregate ? 'כל הצוות' : (rep.full_name || rep.email || 'לא ידוע')}</span>
          <TrendDot delta={trend} />
        </span>
        <span className="block text-[10px] text-muted-foreground leading-tight">
          {Number(rep.conversion || 0).toFixed(0)}% סגירה · {rep.leads_count || 0} לידים
        </span>
      </span>
    </button>
  );
}

export default function TeamTab({ demoMode = false }) {
  const [rangeId, setRangeId] = useState('1m');
  const [selectedKey, setSelectedKey] = useState('__team__');
  const [compareEnabled, setCompareEnabled] = useState(true);

  // Resolve the local range. Independent of the global Dashboard2
  // range picker — TeamTab fetches its own slice so a user can drill
  // into a 6-month rep view without disturbing the cockpit overview.
  const preset = useMemo(
    () => RANGE_PRESETS.find((r) => r.id === rangeId) || RANGE_PRESETS[0],
    [rangeId],
  );
  const { start, end } = useMemo(() => {
    const now = new Date();
    return { start: startOfDay(subDays(now, preset.days)), end: endOfDay(now) };
  }, [preset]);

  // Previous period: same length, shifted back so the user gets a
  // like-for-like comparison ("חודש אחרון" vs the month before, etc).
  const { prevStart, prevEnd } = useMemo(() => {
    const lengthMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - lengthMs);
    return { prevStart, prevEnd };
  }, [start, end]);

  // Live query only runs outside demo mode. When demo mode is on,
  // synthesise the same shape via getDemoData so the chips/podium/funnel
  // render with plausible numbers instead of "אין נתוני נציגים".
  const liveQuery = useDashboard2Data({
    start,
    end,
    enabled: !demoMode,
    label: `team-${rangeId}`,
  });
  const demoSnapshot = useMemo(() => {
    if (!demoMode) return null;
    const customRange = preset.demoRangeKey === 'custom' ? { from: start, to: end } : null;
    return getDemoData(preset.demoRangeKey, customRange, { start, end });
  }, [demoMode, preset.demoRangeKey, start, end]);

  // Mirror queries for the previous period — only enabled when the
  // comparison toggle is on so the tab doesn't double its load by default.
  const prevLiveQuery = useDashboard2Data({
    start: prevStart,
    end: prevEnd,
    enabled: compareEnabled && !demoMode,
    label: `team-${rangeId}-prev`,
  });
  const prevDemoSnapshot = useMemo(() => {
    if (!demoMode || !compareEnabled) return null;
    const customRange = preset.demoRangeKey === 'custom' ? { from: prevStart, to: prevEnd } : null;
    return getDemoData(preset.demoRangeKey, customRange, { start: prevStart, end: prevEnd });
  }, [demoMode, compareEnabled, preset.demoRangeKey, prevStart, prevEnd]);

  const data = demoMode ? demoSnapshot : liveQuery.data;
  const prevData = compareEnabled ? (demoMode ? prevDemoSnapshot : prevLiveQuery.data) : null;
  const isLoading = !demoMode && liveQuery.isLoading && !liveQuery.data;
  const isFetching = !demoMode && (liveQuery.isFetching || (compareEnabled && prevLiveQuery.isFetching));

  // Tasks slice. Only pulls the columns we actually need so the payload
  // stays small even on very busy teams. Scoped to tasks CREATED within
  // the chosen window — same window as the reps cards above so the
  // "זמן טיפול ממוצע" metric covers the same population the user is
  // already eyeballing.
  const tasksQuery = useQuery({
    queryKey: ['teamTabTasks', rangeId, start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('sales_tasks')
        .select('task_status, assigned_to, created_date, updated_date')
        .gte('created_date', start.toISOString())
        .lte('created_date', end.toISOString());
      if (error) throw error;
      return rows || [];
    },
    enabled: !demoMode,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const prevTasksQuery = useQuery({
    queryKey: ['teamTabTasks', rangeId, prevStart.toISOString(), prevEnd.toISOString(), 'prev'],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('sales_tasks')
        .select('task_status, assigned_to, created_date, updated_date')
        .gte('created_date', prevStart.toISOString())
        .lte('created_date', prevEnd.toISOString());
      if (error) throw error;
      return rows || [];
    },
    enabled: compareEnabled && !demoMode,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const reps = useMemo(() => {
    const list = [...(data?.reps || [])];
    list.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    return list;
  }, [data]);

  const teamAgg = useMemo(() => aggregateTeam(reps), [reps]);

  const prevReps = useMemo(() => {
    const list = [...(prevData?.reps || [])];
    list.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    return list;
  }, [prevData]);
  const prevTeamAgg = useMemo(() => aggregateTeam(prevReps), [prevReps]);

  const selectedRep = useMemo(() => {
    if (selectedKey === '__team__') return teamAgg;
    return reps.find((r) => (r.email || r.full_name) === selectedKey) || teamAgg;
  }, [reps, selectedKey, teamAgg]);

  const prevSelectedRep = useMemo(() => {
    if (!compareEnabled) return null;
    if (selectedKey === '__team__') return prevTeamAgg;
    return prevReps.find((r) => (r.email || r.full_name) === selectedKey) || prevTeamAgg;
  }, [compareEnabled, prevReps, selectedKey, prevTeamAgg]);

  const topRep = reps[0];
  const conv = Number(selectedRep.conversion || 0);
  const inHandling = Number(selectedRep.in_handling_rate || 0);
  const lost = Number(selectedRep.lost_rate || 0);
  const isAggregate = selectedRep === teamAgg;

  // Build the per-rep tasks slice once we know who's selected. For demo
  // mode the helper synthesises the entire shape; live mode filters the
  // raw rows pulled above to the chosen rep (or sums everything for the
  // team aggregate) and computes avg handling time from completed rows.
  const taskStats = useMemo(() => {
    if (demoMode) {
      const repEmail = isAggregate ? null : (selectedRep.email || selectedRep.full_name);
      return demoTasksFor(repEmail, rangeId);
    }
    const rows = tasksQuery.data || [];
    const scoped = isAggregate
      ? rows
      : rows.filter((r) => r.assigned_to === (selectedRep.email || selectedRep.full_name));
    const counts = { not_completed: 0, completed: 0, not_done: 0, cancelled: 0 };
    let handlingSum = 0;
    let handlingN = 0;
    for (const r of scoped) {
      const k = r.task_status;
      if (k in counts) counts[k] += 1;
      // Average handling time: only completed tasks contribute, and we
      // need both timestamps. Skips rows where updated_date < created_date
      // (clock skew / bad data) so a single weird row can't wreck the mean.
      if (k === 'completed' && r.updated_date && r.created_date) {
        const ms = new Date(r.updated_date).getTime() - new Date(r.created_date).getTime();
        if (Number.isFinite(ms) && ms > 0) {
          handlingSum += ms;
          handlingN += 1;
        }
      }
    }
    return {
      counts,
      avgHandlingMs: handlingN > 0 ? handlingSum / handlingN : 0,
      completedCount: handlingN,
    };
  }, [demoMode, isAggregate, selectedRep, rangeId, tasksQuery.data]);

  // Previous-period equivalent computed the same way so the deltas
  // below stay consistent (same scoping, same demo synth, same dedup).
  const prevTaskStats = useMemo(() => {
    if (!compareEnabled) return null;
    if (demoMode) {
      const repEmail = isAggregate ? null : (selectedRep.email || selectedRep.full_name);
      // Slightly perturbed demo numbers — the seed includes "prev" so they
      // differ from the current snapshot, otherwise every delta would be 0.
      return demoTasksFor(repEmail, `${rangeId}-prev`);
    }
    const rows = prevTasksQuery.data || [];
    const scoped = isAggregate
      ? rows
      : rows.filter((r) => r.assigned_to === (selectedRep.email || selectedRep.full_name));
    const counts = { not_completed: 0, completed: 0, not_done: 0, cancelled: 0 };
    let handlingSum = 0;
    let handlingN = 0;
    for (const r of scoped) {
      const k = r.task_status;
      if (k in counts) counts[k] += 1;
      if (k === 'completed' && r.updated_date && r.created_date) {
        const ms = new Date(r.updated_date).getTime() - new Date(r.created_date).getTime();
        if (Number.isFinite(ms) && ms > 0) {
          handlingSum += ms;
          handlingN += 1;
        }
      }
    }
    return {
      counts,
      avgHandlingMs: handlingN > 0 ? handlingSum / handlingN : 0,
      completedCount: handlingN,
    };
  }, [compareEnabled, demoMode, isAggregate, selectedRep, rangeId, prevTasksQuery.data]);

  const tasksTotal = useMemo(
    () => Object.values(taskStats.counts).reduce((s, n) => s + n, 0),
    [taskStats],
  );

  // Deltas for the five hero tiles. higherIsBetter is true for everything
  // except "אבד%" — there, a smaller number is the good direction.
  const deltas = useMemo(() => {
    if (!compareEnabled || !prevSelectedRep) return {};
    return {
      leads:     computeDelta(selectedRep.leads_count, prevSelectedRep.leads_count),
      closing:   computeDelta(conv, prevSelectedRep.conversion, { isPercent: true }),
      handling:  computeDelta(inHandling, prevSelectedRep.in_handling_rate, { isPercent: true }),
      lost:      computeDelta(lost, prevSelectedRep.lost_rate, { higherIsBetter: false, isPercent: true }),
      revenue:   computeDelta(selectedRep.revenue, prevSelectedRep.revenue),
      avgHandling: prevTaskStats
        ? computeDelta(taskStats.avgHandlingMs, prevTaskStats.avgHandlingMs, { higherIsBetter: false })
        : null,
    };
  }, [compareEnabled, prevSelectedRep, selectedRep, conv, inHandling, lost, taskStats, prevTaskStats]);

  // Per-rep "trend dot" for the chip strip — derived from total leads
  // change, the simplest single-number proxy for "moving in the right
  // direction" at the chip-density we have.
  const repTrends = useMemo(() => {
    if (!compareEnabled) return new Map();
    const map = new Map();
    for (const r of reps) {
      const key = r.email || r.full_name;
      const prev = prevReps.find((p) => (p.email || p.full_name) === key);
      if (!prev) { map.set(key, null); continue; }
      map.set(key, computeDelta(r.leads_count, prev.leads_count));
    }
    return map;
  }, [compareEnabled, reps, prevReps]);

  const periodLabel = preset.shortLabel;
  const prevPeriodLabel = PREV_LABEL_BY_ID[preset.id] || `${preset.shortLabel} קודם`;
  const taskRows = useMemo(() => {
    const tone = {
      completed:     { stripe: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-50' },
      not_completed: { stripe: 'bg-amber-500',   text: 'text-amber-700',   badge: 'bg-amber-50' },
      not_done:      { stripe: 'bg-red-500',     text: 'text-red-700',     badge: 'bg-red-50' },
      cancelled:     { stripe: 'bg-slate-400',   text: 'text-slate-600',   badge: 'bg-slate-50' },
    };
    return TASK_STATUS_OPTIONS.map((opt) => ({
      status: opt.value,
      label: opt.label,
      count: taskStats.counts[opt.value] || 0,
      tone: tone[opt.value] || tone.cancelled,
    })).sort((a, b) => b.count - a.count);
  }, [taskStats]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Range selector + header link */}
      <Card className="border-border shadow-card">
        <CardHeader className="pb-2 border-b border-border/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              ביצועי צוות מכירות
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-full bg-muted p-0.5">
                {RANGE_PRESETS.map((p) => {
                  const active = p.id === rangeId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setRangeId(p.id)}
                      className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                        active ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setCompareEnabled((v) => !v)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                  compareEnabled
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                }`}
                title="השוואה לתקופה הקודמת באותו אורך"
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                {compareEnabled ? 'משווה לתקופה קודמת' : 'הפעל השוואה'}
              </button>
              <Link to={createPageUrl('Representatives')}>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  לדף הנציגים
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>

        {/* Rep chip row — first chip is the "all team" aggregate */}
        <CardContent className="p-3">
          {isLoading ? (
            <div className="flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-32 rounded-full" />
              ))}
            </div>
          ) : reps.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              אין נתוני נציגים בטווח שנבחר
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <RepChip
                rep={teamAgg}
                idx={-1}
                isAggregate
                selected={selectedKey === '__team__'}
                onClick={() => setSelectedKey('__team__')}
              />
              {reps.map((r, idx) => {
                const key = r.email || r.full_name || `rep-${idx}`;
                return (
                  <RepChip
                    key={key}
                    rep={r}
                    idx={idx}
                    selected={selectedKey === key}
                    trend={repTrends.get(key)}
                    onClick={() => setSelectedKey(key)}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail panel for the selected rep / aggregate */}
      <Card className="border-border shadow-card">
        <CardHeader className="pb-2 border-b border-border/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`h-10 w-10 rounded-full ${isAggregate ? 'bg-indigo-600' : colorForRep(selectedRep, 0)} text-white text-sm font-bold flex items-center justify-center`}>
                {isAggregate ? 'כל' : initialsFor(selectedRep.full_name || selectedRep.email)}
              </span>
              <div>
                <p className="text-base font-bold text-foreground">
                  {isAggregate ? 'כל הצוות' : (selectedRep.full_name || selectedRep.email || 'לא ידוע')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {RANGE_PRESETS.find((r) => r.id === rangeId)?.label} · {reps.length} נציגים בטווח
                </p>
              </div>
            </div>
            {topRep && !isAggregate && (selectedRep.email || selectedRep.full_name) === (topRep.email || topRep.full_name) ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                <Crown className="h-3.5 w-3.5" /> מוביל הצוות
              </span>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {/* Big stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatTile
              label="לידים בטווח"
              value={Number(selectedRep.leads_count || 0).toLocaleString()}
              icon={Users}
              tone="blue"
              delta={deltas.leads}
              deltaFormat={(n) => Number(n || 0).toLocaleString()}
              periodLabel={periodLabel}
              prevPeriodLabel={prevPeriodLabel}
            />
            <StatTile
              label="אחוז סגירה"
              value={`${conv.toFixed(0)}%`}
              sub={`${selectedRep.won_count || 0} עסקאות`}
              icon={Target}
              tone="emerald"
              delta={deltas.closing}
              deltaFormat={(n) => `${Number(n || 0).toFixed(1)}%`}
              deltaSuffix="pp"
              periodLabel={periodLabel}
              prevPeriodLabel={prevPeriodLabel}
            />
            <StatTile
              label="בטיפול"
              value={`${inHandling.toFixed(0)}%`}
              icon={Activity}
              tone="amber"
              delta={deltas.handling}
              deltaFormat={(n) => `${Number(n || 0).toFixed(1)}%`}
              deltaSuffix="pp"
              periodLabel={periodLabel}
              prevPeriodLabel={prevPeriodLabel}
            />
            <StatTile
              label="אבד"
              value={`${lost.toFixed(0)}%`}
              icon={XCircle}
              tone="red"
              delta={deltas.lost}
              deltaFormat={(n) => `${Number(n || 0).toFixed(1)}%`}
              deltaSuffix="pp"
              periodLabel={periodLabel}
              prevPeriodLabel={prevPeriodLabel}
            />
            <StatTile
              label="הכנסות"
              value={formatCurrencyCompact(selectedRep.revenue)}
              sub={formatCurrency(selectedRep.revenue)}
              icon={DollarSign}
              tone="violet"
              delta={deltas.revenue}
              deltaFormat={(n) => formatCurrencyCompact(n)}
              periodLabel={periodLabel}
              prevPeriodLabel={prevPeriodLabel}
            />
          </div>

          {/* Compare banner — tells the user what the deltas mean and
              what time window they're rolling up. Hidden when off. */}
          {compareEnabled && prevSelectedRep ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground bg-primary/5 border border-primary/20 rounded-md px-3 py-1.5">
              <GitCompareArrows className="h-3.5 w-3.5 text-primary" />
              <span>
                משווה <span className="font-semibold text-foreground">{periodLabel}</span> מול <span className="font-semibold text-foreground">{prevPeriodLabel}</span>
              </span>
              <span className="opacity-60">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                ירוק = שיפור
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                אדום = ירידה
              </span>
              <span className="opacity-60">·</span>
              <span>החץ מראה את כיוון השינוי, הצבע מראה אם זה לטובה</span>
            </div>
          ) : null}

          {/* Funnel breakdown */}
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3">
              חלוקת לידים: סגירה · בטיפול · אבד
            </p>
            <FunnelBar closing={conv} handling={inHandling} lost={lost} />
          </div>

          {/* Tasks-by-status + avg handling time */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 rounded-lg border border-border/50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/40">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <ListChecks className="h-3.5 w-3.5 text-indigo-600" />
                  משימות לפי סטטוס
                </div>
                <span className="text-[11px] text-muted-foreground">סה״כ {tasksTotal.toLocaleString()}</span>
              </div>
              {tasksTotal === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">אין משימות בטווח</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-1.5 text-right font-semibold">סטטוס</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-20">{periodLabel}</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-14">%</th>
                      <th className="px-3 py-1.5 text-right font-semibold">חלוקה</th>
                      {compareEnabled && prevTaskStats ? (
                        <>
                          <th className="px-2 py-1.5 text-center font-semibold w-20">{prevPeriodLabel}</th>
                          <th className="px-2 py-1.5 text-center font-semibold w-24">שינוי</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {taskRows.map((row) => {
                      const pct = tasksTotal > 0 ? (row.count / tasksTotal) * 100 : 0;
                      // For "not_completed" / "not_done" / "cancelled" a *decrease* is
                      // a good thing; for "completed" an *increase* is good.
                      const higherIsBetter = row.status === 'completed';
                      const rowDelta = compareEnabled && prevTaskStats
                        ? computeDelta(row.count, prevTaskStats.counts[row.status], { higherIsBetter })
                        : null;
                      return (
                        <tr key={row.status} className="hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${row.tone.stripe} flex-shrink-0`} />
                              <span>{row.label}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`inline-block min-w-[2rem] px-1.5 py-0.5 rounded-md text-xs font-semibold ${row.tone.badge} ${row.tone.text}`}>
                              {row.count.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
                            {pct.toFixed(0)}%
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                              <div className={`h-full ${row.tone.stripe}`} style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                          </td>
                          {compareEnabled && prevTaskStats ? (
                            <>
                              <td className="px-2 py-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
                                {(prevTaskStats.counts[row.status] || 0).toLocaleString()}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <DeltaChip delta={rowDelta} />
                              </td>
                            </>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-lg border border-border/50 bg-gradient-to-br from-cyan-50 to-blue-50 p-4 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-800">
                <Clock className="h-4 w-4" />
                זמן טיפול ממוצע
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground leading-none mt-3">
                  {formatDuration(taskStats.avgHandlingMs)}
                </p>
                {compareEnabled && deltas.avgHandling ? (
                  <DeltaDetail
                    delta={deltas.avgHandling}
                    format={(n) => formatDuration(n)}
                    suffix="%"
                    periodLabel={periodLabel}
                    prevPeriodLabel={prevPeriodLabel}
                  />
                ) : null}
                <p className="text-[11px] text-muted-foreground mt-2">
                  ממוצע משימות שהושלמו · נסמך על {taskStats.completedCount.toLocaleString()} משימות
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  מחושב מהפרש בין יצירת המשימה לסיומה (updated_date − created_date)
                </p>
              </div>
            </div>
          </div>

          {/* Team-wide comparison list — shown only when looking at one rep */}
          {!isAggregate && reps.length > 1 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">השוואה לשאר הצוות</p>
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <div
                  className="grid items-center gap-2 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40"
                  style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(4, minmax(0, 1fr)) minmax(0, 1.2fr)' }}
                >
                  <div className="text-right">נציג</div>
                  <div className="text-center">לידים</div>
                  <div className="text-center text-emerald-700/80">סגירה</div>
                  <div className="text-center text-amber-700/80">בטיפול</div>
                  <div className="text-center text-red-700/80">אבד</div>
                  <div className="text-end">הכנסות</div>
                </div>
                <div className="divide-y divide-border/50">
                  {reps.map((rep, idx) => {
                    const tier = tierFor(rep.conversion);
                    const isTop = idx === 0;
                    const isSelected = (rep.email || rep.full_name) === selectedKey;
                    return (
                      <div
                        key={rep.email || rep.full_name || idx}
                        className={`grid items-center gap-2 px-3 py-2 text-xs ${isSelected ? 'bg-primary/5' : 'hover:bg-muted/20'} transition-colors`}
                        style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(4, minmax(0, 1fr)) minmax(0, 1.2fr)' }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isTop ? (
                            <Trophy className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                          ) : (
                            <span className={`h-2 w-2 rounded-full ${tier.dot} flex-shrink-0`} />
                          )}
                          <span className="font-semibold truncate" title={rep.full_name || rep.email}>
                            {rep.full_name || rep.email || 'לא ידוע'}
                          </span>
                        </div>
                        <div className="text-center text-muted-foreground">{rep.leads_count || 0}</div>
                        <div className="text-center font-semibold text-emerald-700">{Number(rep.conversion || 0).toFixed(0)}%</div>
                        <div className="text-center font-semibold text-amber-700">{Number(rep.in_handling_rate || 0).toFixed(0)}%</div>
                        <div className="text-center font-semibold text-red-700">{Number(rep.lost_rate || 0).toFixed(0)}%</div>
                        <div className="text-end font-bold whitespace-nowrap">{formatCurrencyCompact(rep.revenue)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {/* When viewing the team aggregate, surface a podium of the top 3 */}
          {isAggregate && reps.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {reps.slice(0, 3).map((rep, idx) => {
                const podiumTone = ['from-amber-200 to-amber-50 border-amber-300', 'from-slate-200 to-slate-50 border-slate-300', 'from-orange-200 to-orange-50 border-orange-300'][idx];
                const rank = ['1', '2', '3'][idx];
                return (
                  <button
                    type="button"
                    key={rep.email || rep.full_name || idx}
                    onClick={() => setSelectedKey(rep.email || rep.full_name)}
                    className={`text-right rounded-xl border bg-gradient-to-b ${podiumTone} p-4 hover:shadow-md transition-shadow`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-muted-foreground">מקום {rank}</span>
                      {idx === 0 ? <Crown className="h-4 w-4 text-amber-600" /> : null}
                    </div>
                    <p className="text-sm font-bold text-foreground truncate" title={rep.full_name || rep.email}>
                      {rep.full_name || rep.email || 'לא ידוע'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {Number(rep.conversion || 0).toFixed(0)}% סגירה · {rep.leads_count || 0} לידים
                    </p>
                    <p className="text-base font-bold text-foreground mt-2">
                      {formatCurrencyCompact(rep.revenue)}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : null}

          {isFetching && !isLoading ? (
            <p className="text-[11px] text-center text-muted-foreground">מעדכן...</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
