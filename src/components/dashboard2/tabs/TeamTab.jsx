import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
} from 'lucide-react';
import { startOfDay, endOfDay, subMonths } from '@/lib/safe-date-fns';
import useDashboard2Data from '@/components/dashboard2/useDashboard2Data';
import { getDemoData } from '@/components/dashboard2/demoData';

// Time windows specific to the Team tab — independent of the global
// Dashboard2 range picker. The product brief calls these out explicitly:
// "חודש אחרון, שלושה חודשים וחצי שנה". `demoRangeKey` maps each window
// onto a getDemoData() key so demo mode scales the numbers convincingly
// (the demo generator only understands the global preset names).
const RANGE_PRESETS = [
  { id: '1m', label: 'חודש אחרון', months: 1, demoRangeKey: 'month'   },
  { id: '3m', label: '3 חודשים',   months: 3, demoRangeKey: '90days'  },
  { id: '6m', label: 'חצי שנה',    months: 6, demoRangeKey: 'custom'  },
];

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

// Big stat card used in the detail panel. The accent ring + colored
// value make each metric scannable at a glance from across the room.
function StatTile({ label, value, sub, icon: Icon, tone = 'indigo' }) {
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
function RepChip({ rep, idx, selected, onClick, isAggregate }) {
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
        <span className="block font-semibold text-foreground leading-tight max-w-[110px] truncate">
          {isAggregate ? 'כל הצוות' : (rep.full_name || rep.email || 'לא ידוע')}
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

  // Resolve the local range. Independent of the global Dashboard2
  // range picker — TeamTab fetches its own slice so a user can drill
  // into a 6-month rep view without disturbing the cockpit overview.
  const preset = useMemo(
    () => RANGE_PRESETS.find((r) => r.id === rangeId) || RANGE_PRESETS[0],
    [rangeId],
  );
  const { start, end } = useMemo(() => {
    const now = new Date();
    return { start: startOfDay(subMonths(now, preset.months)), end: endOfDay(now) };
  }, [preset]);

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

  const data = demoMode ? demoSnapshot : liveQuery.data;
  const isLoading = !demoMode && liveQuery.isLoading && !liveQuery.data;
  const isFetching = !demoMode && liveQuery.isFetching;

  const reps = useMemo(() => {
    const list = [...(data?.reps || [])];
    list.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    return list;
  }, [data]);

  const teamAgg = useMemo(() => aggregateTeam(reps), [reps]);

  const selectedRep = useMemo(() => {
    if (selectedKey === '__team__') return teamAgg;
    return reps.find((r) => (r.email || r.full_name) === selectedKey) || teamAgg;
  }, [reps, selectedKey, teamAgg]);

  const topRep = reps[0];
  const conv = Number(selectedRep.conversion || 0);
  const inHandling = Number(selectedRep.in_handling_rate || 0);
  const lost = Number(selectedRep.lost_rate || 0);
  const isAggregate = selectedRep === teamAgg;

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
            />
            <StatTile
              label="אחוז סגירה"
              value={`${conv.toFixed(0)}%`}
              sub={`${selectedRep.won_count || 0} עסקאות`}
              icon={Target}
              tone="emerald"
            />
            <StatTile
              label="בטיפול"
              value={`${inHandling.toFixed(0)}%`}
              icon={Activity}
              tone="amber"
            />
            <StatTile
              label="אבד"
              value={`${lost.toFixed(0)}%`}
              icon={XCircle}
              tone="red"
            />
            <StatTile
              label="הכנסות"
              value={formatCurrencyCompact(selectedRep.revenue)}
              sub={formatCurrency(selectedRep.revenue)}
              icon={DollarSign}
              tone="violet"
            />
          </div>

          {/* Funnel breakdown */}
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3">
              חלוקת לידים: סגירה · בטיפול · אבד
            </p>
            <FunnelBar closing={conv} handling={inHandling} lost={lost} />
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
