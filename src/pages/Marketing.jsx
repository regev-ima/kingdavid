import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Megaphone, Users, Target, TrendingUp, DollarSign, RefreshCw, Trophy, AlertTriangle,
} from 'lucide-react';
import { getDateRange } from '@/utils/dateRange';
import Dashboard2DateRange from '@/components/dashboard2/Dashboard2DateRange';
import useMarketingStats from '@/components/marketing/useMarketingStats';
import LeadListTable from '@/components/lead/LeadListTable';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';

// A stable accent colour per known source so the same channel always looks the
// same across the cubes and table. Source NAMES are shown exactly as stored
// (utm_source) — not translated — only the empty bucket gets a Hebrew label.
const SOURCE_META = {
  facebook: { dot: 'bg-blue-500', ring: 'border-blue-200 bg-blue-50/60' },
  instant_form: { dot: 'bg-blue-500', ring: 'border-blue-200 bg-blue-50/60' },
  instagram: { dot: 'bg-pink-500', ring: 'border-pink-200 bg-pink-50/60' },
  google: { dot: 'bg-amber-500', ring: 'border-amber-200 bg-amber-50/60' },
  tiktok: { dot: 'bg-gray-800', ring: 'border-gray-200 bg-gray-50' },
  taboola: { dot: 'bg-cyan-500', ring: 'border-cyan-200 bg-cyan-50/60' },
  outbrain: { dot: 'bg-orange-500', ring: 'border-orange-200 bg-orange-50/60' },
  whatsapp: { dot: 'bg-emerald-500', ring: 'border-emerald-200 bg-emerald-50/60' },
  other: { dot: 'bg-slate-400', ring: 'border-slate-200 bg-slate-50' },
};
const sourceLabel = (name) => (name === 'other' ? 'ללא מקור' : name);
const sourceRing = (name) => SOURCE_META[name]?.ring || 'border-indigo-200 bg-indigo-50/60';
const sourceDot = (name) => SOURCE_META[name]?.dot || 'bg-indigo-500';

const fmtCurrency = (v) => `₪${Number(v || 0).toLocaleString()}`;
const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n.toLocaleString()}`;
};

function RoiBadge({ value }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const n = Number(value);
  const cls = n >= 2 ? 'bg-emerald-100 text-emerald-800' : n >= 1 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{n.toFixed(2)}x</span>;
}

function ConvBar({ value }) {
  const n = Math.max(0, Math.min(100, Number(value || 0)));
  const tone = n >= 30 ? 'bg-emerald-500' : n >= 15 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${n}%` }} />
      </div>
      <span className="text-xs tabular-nums font-semibold">{n.toFixed(0)}%</span>
    </div>
  );
}

// Compact overall-KPI tile (kept small so the source cubes stay the star).
function MiniKpi({ label, value, sub, icon: Icon, tone = 'indigo' }) {
  const cls = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
  }[tone];
  return (
    <div className={`rounded-xl border ${cls} p-3`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[11px] font-medium opacity-80">{label}</p>
        {Icon ? <Icon className="h-3.5 w-3.5 opacity-60" /> : null}
      </div>
      <p className="text-xl font-bold leading-none">{value}</p>
      {sub ? <p className="text-[10px] mt-1.5 opacity-70">{sub}</p> : null}
    </div>
  );
}

export default function Marketing() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const [rangeKey, setRangeKey] = useState('30days');
  const [customRange, setCustomRange] = useState(null);
  const [activeTab, setActiveTab] = useState('sources');
  const [sourceFilter, setSourceFilter] = useState('all');

  const { start, end } = useMemo(
    () => getDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );
  const dateRange = useMemo(() => ({ from: start, to: end }), [start, end]);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const { data, isLoading, isFetching, error, refetch } = useMarketingStats({
    start, end, enabled: isAdmin,
  });

  // Open a lead in the same popup ניהול לידים uses, and resolve rep emails to
  // names for the shared leads table.
  const { openLead, lastOpenedLeadId } = useLeadModal();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin,
  });
  const repNameByEmail = useMemo(() => new Map(users.map((u) => [u.email, u.full_name || u.email])), [users]);

  // Lead-level rows for the "לידים" tab + source drill-down. Fetched only for
  // the selected range and only when that tab is open. The table renders at
  // most 500 rows, so ONE capped page is enough — the previous fetchAllFiltered
  // paged the entire range into the browser (with a 150ms pause per page) just
  // to throw everything past 500 away, which is why this tab crawled.
  const { data: rangeLeads = [], isFetching: leadsFetching } = useQuery({
    queryKey: ['marketingLeads', startIso, endIso],
    enabled: isAdmin && activeTab === 'leads',
    staleTime: 60 * 1000,
    queryFn: () => base44.entities.Lead.filter(
      { created_date: { $gte: startIso, $lte: endIso } },
      '-created_date',
      1000,
    ),
  });

  const sources = data?.sources || [];
  const campaigns = data?.campaigns || [];
  const totals = data?.totals || {};
  const failures = data?.failures || [];

  const visibleSources = sourceFilter === 'all' ? sources : sources.filter((s) => s.name === sourceFilter);
  const visibleCampaigns = sourceFilter === 'all' ? campaigns : campaigns.filter((c) => c.source === sourceFilter);

  const normSource = (l) => {
    const s = String(l?.utm_source || l?.source || '').toLowerCase();
    if (!s) return 'other';
    if (s.includes('facebook') || s === 'fb' || s.includes('meta')) return 'facebook';
    if (s.includes('instagram') || s === 'ig') return 'instagram';
    if (s.includes('google') || s.includes('adwords')) return 'google';
    if (s.includes('tiktok')) return 'tiktok';
    if (s.includes('taboola')) return 'taboola';
    if (s.includes('outbrain')) return 'outbrain';
    if (s.includes('whatsapp')) return 'whatsapp';
    return s;
  };
  const displayLeads = sourceFilter === 'all'
    ? rangeLeads
    : rangeLeads.filter((l) => normSource(l) === sourceFilter);

  const drillToSource = (name) => { setSourceFilter(name); setActiveTab('leads'); };

  if (isLoadingUser) return <div className="text-center py-12 text-muted-foreground">טוען...</div>;
  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת לדשבורד שיווק</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-orange-100">
            <Megaphone className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">דשבורד שיווק</h1>
            <p className="text-sm text-muted-foreground">מקורות הלידים, עלויות, המרה והחזר השקעה (ROI)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dashboard2DateRange
            rangeKey={rangeKey}
            dateRange={dateRange}
            onPresetChange={(k) => { setRangeKey(k); if (k !== 'custom') setCustomRange(null); }}
            onCustomChange={(r) => { setCustomRange(r || null); if (r?.from && r?.to) setRangeKey('custom'); }}
          />
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            רענן
          </Button>
        </div>
      </div>

      {/* Source filter pill */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">סינון מקור:</span>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל המקורות</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.name} value={s.name}>{sourceLabel(s.name)} ({s.leads})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-900 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">לא הצלחנו לטעון את נתוני השיווק: {error.message || String(error)}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>נסה שוב</Button>
        </div>
      ) : failures.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 flex items-center gap-2 text-xs">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          חלק מהמקורות לא נטענו ({failures.join(' · ')}) — ייתכן שחלק מהמספרים חלקיים.
        </div>
      ) : null}

      {/* ── Source cubes (no graphs) ─────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-foreground mb-2">מקורות לידים</h2>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
        ) : visibleSources.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 bg-muted/30 rounded-xl">
            אין לידים בטווח שנבחר. נסה טווח רחב יותר (למשל "30 יום אחרון").
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {visibleSources.map((s, idx) => (
              <button
                key={s.name}
                type="button"
                onClick={() => drillToSource(s.name)}
                className={`text-right rounded-xl border p-4 transition-all hover:shadow-card-hover hover:-translate-y-0.5 ${sourceRing(s.name)}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground truncate" title={sourceLabel(s.name)}>
                    {idx === 0 ? <Trophy className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" /> : <span className={`h-2 w-2 rounded-full flex-shrink-0 ${sourceDot(s.name)}`} />}
                    <span className="truncate">{sourceLabel(s.name)}</span>
                  </span>
                </div>
                <div className="text-3xl font-bold text-foreground leading-none">{s.leads.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">לידים</div>
                <div className="flex items-center justify-between mt-2 text-[11px]">
                  <span className="text-emerald-700 font-semibold">סגירה {s.conversion.toFixed(0)}%</span>
                  <span className="text-muted-foreground">{s.revenue > 0 ? fmtCompact(s.revenue) : '—'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Overall KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MiniKpi label="סה״כ לידים" value={(totals.leads || 0).toLocaleString()} sub={`${totals.won || 0} נסגרו`} icon={Users} tone="indigo" />
        <MiniKpi label="הוצאות שיווק" value={fmtCurrency(totals.cost)} icon={DollarSign} tone="rose" />
        <MiniKpi label="עלות לליד (CPL)" value={fmtCurrency(totals.cpl)} icon={Target} tone="amber" />
        <MiniKpi label="עלות ללקוח (CAC)" value={fmtCurrency(totals.cac)} icon={Target} tone="emerald" />
        <MiniKpi label="ROI כולל" value={totals.roi != null ? `${totals.roi}x` : '—'} sub={`המרה ${totals.conversion || 0}%`} icon={TrendingUp} tone={totals.roi != null && totals.roi >= 1 ? 'emerald' : 'rose'} />
      </div>

      {/* Tabs: source table / campaigns / leads */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border w-full h-auto flex-wrap justify-start">
          <TabsTrigger value="sources">לפי מקור</TabsTrigger>
          <TabsTrigger value="campaigns">קמפיינים</TabsTrigger>
          <TabsTrigger value="leads">דוח לידים</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'sources' && (
        <Card>
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm">מאיפה מגיעים הלידים — פירוט לפי מקור</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">מקור</TableHead>
                    <TableHead className="text-center">לידים</TableHead>
                    <TableHead className="text-right">סגירה</TableHead>
                    <TableHead className="text-center">בטיפול</TableHead>
                    <TableHead className="text-center">אבד</TableHead>
                    <TableHead className="text-center">עלות</TableHead>
                    <TableHead className="text-center">CPL</TableHead>
                    <TableHead className="text-center">CAC</TableHead>
                    <TableHead className="text-end">הכנסות</TableHead>
                    <TableHead className="text-center">ROI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">טוען…</TableCell></TableRow>
                  ) : visibleSources.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">אין נתוני מקור בטווח</TableCell></TableRow>
                  ) : visibleSources.map((s) => (
                    <TableRow key={s.name} className="hover:bg-muted/20">
                      <TableCell>
                        <button type="button" className="flex items-center gap-2 font-medium hover:underline" onClick={() => drillToSource(s.name)}>
                          <span className={`h-2 w-2 rounded-full ${sourceDot(s.name)}`} />
                          {sourceLabel(s.name)}
                        </button>
                      </TableCell>
                      <TableCell className="text-center tabular-nums font-semibold">{s.leads.toLocaleString()}</TableCell>
                      <TableCell><ConvBar value={s.conversion} /></TableCell>
                      <TableCell className="text-center tabular-nums text-amber-700">{s.in_handling_rate.toFixed(0)}%</TableCell>
                      <TableCell className="text-center tabular-nums text-red-700">{s.lost_rate.toFixed(0)}%</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{fmtCurrency(s.cost)}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{fmtCurrency(s.cpl)}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{s.cac != null ? fmtCurrency(s.cac) : '—'}</TableCell>
                      <TableCell className="text-end font-bold tabular-nums">{fmtCompact(s.revenue)}</TableCell>
                      <TableCell className="text-center"><RoiBadge value={s.roi} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'campaigns' && (
        <Card>
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm">קמפיינים — מה מביא הכי הרבה</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">קמפיין</TableHead>
                    <TableHead className="text-center">לידים</TableHead>
                    <TableHead className="text-center">נסגרו</TableHead>
                    <TableHead className="text-right">המרה</TableHead>
                    <TableHead className="text-center">עלות</TableHead>
                    <TableHead className="text-center">CPL</TableHead>
                    <TableHead className="text-end">הכנסות</TableHead>
                    <TableHead className="text-center">ROI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">טוען…</TableCell></TableRow>
                  ) : visibleCampaigns.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">אין קמפיינים בטווח</TableCell></TableRow>
                  ) : visibleCampaigns.slice(0, 30).map((c, idx) => (
                    <TableRow key={`${c.name}-${idx}`} className="hover:bg-muted/20">
                      <TableCell>
                        <div className="font-medium truncate max-w-[220px]" title={c.name}>{c.name}</div>
                        {c.source ? <div className="text-[10px] text-muted-foreground">{sourceLabel(c.source)}</div> : null}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{c.leads.toLocaleString()}</TableCell>
                      <TableCell className="text-center tabular-nums text-emerald-700 font-semibold">{c.won.toLocaleString()}</TableCell>
                      <TableCell><ConvBar value={c.conversion} /></TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{fmtCurrency(c.cost)}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{fmtCurrency(c.cpl)}</TableCell>
                      <TableCell className="text-end font-bold tabular-nums">{fmtCompact(c.revenue)}</TableCell>
                      <TableCell className="text-center"><RoiBadge value={c.roi} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'leads' && (
        <Card>
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span>דוח לידים {sourceFilter !== 'all' ? `— ${sourceLabel(sourceFilter)}` : ''}</span>
              <span className="text-xs font-normal text-muted-foreground">{leadsFetching ? 'טוען…' : `${displayLeads.length} לידים`}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {/* Same table as ניהול לידים — click a row to open the lead in the
                same popup. */}
            <LeadListTable
              leads={displayLeads.slice(0, 500)}
              isLoading={leadsFetching && displayLeads.length === 0}
              repNameByEmail={repNameByEmail}
              onRowClick={(lead) => openLead(lead.id)}
              highlightId={lastOpenedLeadId}
              emptyMessage="לא נמצאו לידים בטווח"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
