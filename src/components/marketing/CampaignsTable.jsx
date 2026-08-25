import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis } from 'recharts';
import { formatCurrency } from '@/utils/currency';
import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';
import { useCampaignDrill } from './useMarketingPanelData';
import { ConvBar, RoiBadge, DeltaBadge, ChannelBadge } from './PanelBits';

const STATUS_LABELS = Object.fromEntries(LEAD_STATUS_OPTIONS.map((s) => [s.value, s.label]));

// Recommendation badge — fed by the same computeInsights result the insights
// panel shows, so the table and the cards never disagree.
const RECO_META = {
  scale_up: { label: 'להעלות תקציב', cls: 'bg-emerald-100 text-emerald-800' },
  scale_down: { label: 'להוריד תקציב', cls: 'bg-red-100 text-red-800' },
  cost_no_leads: { label: 'עלות בלי לידים', cls: 'bg-red-100 text-red-800' },
  handling_gap: { label: 'לשפר טיפול', cls: 'bg-amber-100 text-amber-800' },
  rising: { label: 'בעלייה', cls: 'bg-blue-100 text-blue-800' },
  falling: { label: 'בירידה', cls: 'bg-orange-100 text-orange-800' },
};

function RecoBadge({ type }) {
  const meta = RECO_META[type];
  if (!meta) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>;
}

const SORTS = [
  { key: 'leads', label: 'לידים' },
  { key: 'conversion', label: 'המרה' },
  { key: 'revenue', label: 'הכנסות' },
  { key: 'spend', label: 'עלות' },
  { key: 'roas', label: 'ROAS' },
  { key: 'cpl', label: 'CPL' },
];

function SortableHead({ label, sortKey, sort, onSort, className = 'text-center' }) {
  const active = sort.key === sortKey;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active
          ? (sort.dir === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );
}

const fmtDay = (d) => (typeof d === 'string' ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);

function DrillSection({ title, children }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-xs font-bold text-foreground mb-2">{title}</p>
      {children}
    </div>
  );
}

function MiniBreakdownTable({ rows, nameKey, emptyText }) {
  if (!rows?.length) return <p className="text-xs text-muted-foreground py-2">{emptyText}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const leads = Number(r.leads || 0);
        const won = Number(r.won || 0);
        const conv = leads > 0 ? (won / leads) * 100 : 0;
        return (
          <div key={`${r[nameKey]}-${i}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium" title={r[nameKey]}>{r[nameKey]}</span>
            <span className="flex items-center gap-2 flex-shrink-0 tabular-nums text-muted-foreground">
              <span><b className="text-foreground">{leads.toLocaleString()}</b> לידים</span>
              <span className={conv >= 15 ? 'text-emerald-700 font-semibold' : ''}>{conv.toFixed(0)}%</span>
              <span className="text-foreground font-semibold">{Number(r.revenue || 0) > 0 ? formatCurrency(r.revenue) : '—'}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// The expanded row: a full server-side drill into ONE campaign (same RPC with
// p_campaign) — daily trend, adsets, ads, landing pages and status breakdown.
function CampaignDrillRow({ campaign, start, end }) {
  const { data, isLoading, error } = useCampaignDrill({ campaign, start, end });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-1">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
      </div>
    );
  }
  if (error) {
    return <p className="text-xs text-red-600 p-2">שגיאה בטעינת פירוט הקמפיין: {error.message || String(error)}</p>;
  }

  const dailyRows = (data?.daily || [])
    .reduce((map, r) => map.set(r.d, (map.get(r.d) || 0) + Number(r.leads || 0)), new Map());
  const trend = [...dailyRows.entries()].map(([d, leads]) => ({ d, leads })).sort((a, b) => a.d.localeCompare(b.d));
  const statuses = (data?.statuses || []).slice(0, 8);
  const statusMax = Math.max(1, ...statuses.map((s) => Number(s.count || 0)));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-1">
      <DrillSection title="לידים לאורך התקופה">
        {trend.length === 0 ? <p className="text-xs text-muted-foreground py-2">אין נתונים</p> : (
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="d" reversed hide />
              <YAxis hide domain={[0, 'dataMax']} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, direction: 'rtl' }}
                labelFormatter={fmtDay}
                formatter={(value) => [Number(value).toLocaleString(), 'לידים']}
              />
              <Line type="monotone" dataKey="leads" stroke="#4f46e5" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </DrillSection>

      <DrillSection title="מה קורה עם הלידים (סטטוסים מובילים)">
        {statuses.length === 0 ? <p className="text-xs text-muted-foreground py-2">אין נתונים</p> : (
          <div className="space-y-1.5">
            {statuses.map((s) => (
              <div key={s.status} className="flex items-center gap-2 text-xs">
                <span className="w-44 truncate" title={STATUS_LABELS[s.status] || s.status}>
                  {STATUS_LABELS[s.status] || s.status || 'ללא סטטוס'}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className={`h-full ${s.status === 'deal_closed' ? 'bg-emerald-500' : 'bg-indigo-400'}`}
                    style={{ width: `${(Number(s.count || 0) / statusMax) * 100}%` }}
                  />
                </div>
                <span className="tabular-nums font-semibold w-10 text-left">{Number(s.count || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </DrillSection>

      <DrillSection title="סטים של מודעות (Adsets)">
        <MiniBreakdownTable rows={(data?.adsets || []).slice(0, 8)} nameKey="adset" emptyText="אין נתוני אדסטים לקמפיין הזה" />
      </DrillSection>

      <DrillSection title="מודעות מובילות">
        <MiniBreakdownTable rows={(data?.ads || []).slice(0, 8)} nameKey="ad" emptyText="אין נתוני מודעות לקמפיין הזה" />
      </DrillSection>

      <DrillSection title="דפי נחיתה של הקמפיין">
        <MiniBreakdownTable rows={(data?.landing_pages || []).slice(0, 6)} nameKey="lp" emptyText="אין נתוני דפי נחיתה" />
      </DrillSection>

      <DrillSection title="סיכום הקמפיין">
        {data?.summary ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>לידים: <b className="tabular-nums">{Number(data.summary.leads || 0).toLocaleString()}</b></div>
            <div>טופלו: <b className="tabular-nums">{Number(data.summary.contacted || 0).toLocaleString()}</b></div>
            <div>הצעות: <b className="tabular-nums">{Number(data.summary.quoted || 0).toLocaleString()}</b></div>
            <div>נסגרו: <b className="tabular-nums text-emerald-700">{Number(data.summary.won || 0).toLocaleString()}</b></div>
            <div>הזמנות: <b className="tabular-nums">{Number(data.summary.orders || 0).toLocaleString()}</b></div>
            <div>הכנסות: <b className="tabular-nums">{formatCurrency(data.summary.revenue || 0)}</b></div>
          </div>
        ) : <p className="text-xs text-muted-foreground py-2">אין נתונים</p>}
      </DrillSection>
    </div>
  );
}

export default function CampaignsTable({
  campaigns = [], isLoading, start, end, insightByCampaign = new Map(),
  focusCampaign, focusNonce, onFocusHandled,
}) {
  const [search, setSearch] = useState('');
  const [minLeads, setMinLeads] = useState('0');
  const [sort, setSort] = useState({ key: 'leads', dir: 'desc' });
  const [expanded, setExpanded] = useState(null);
  const focusRef = useRef(null);

  // An insight card click lands here with a campaign to spotlight: clear the
  // filters that could hide it, expand it, scroll to it — once. onFocusHandled
  // clears the page-level focus so a tab remount doesn't replay it.
  useEffect(() => {
    if (!focusCampaign) return;
    setSearch('');
    setMinLeads('0');
    setExpanded(focusCampaign);
  }, [focusCampaign, focusNonce]);
  useEffect(() => {
    if (focusCampaign && expanded === focusCampaign && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocusHandled?.();
    }
  }, [focusCampaign, focusNonce, expanded, onFocusHandled]);

  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const min = Number(minLeads);
    const filtered = campaigns.filter((c) =>
      (min === 0 || c.leads >= min || c.costOnly)
      && (!term || c.campaign.toLowerCase().includes(term)));
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key]; const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av === bv ? 0 : (av > bv ? dir : -dir);
    });
  }, [campaigns, search, minLeads, sort]);

  return (
    <Card>
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-sm">קמפיינים — מי מצדיק תקציב ומי לא</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש קמפיין…"
                className="h-8 w-[200px] pr-8 text-xs"
              />
            </div>
            <Select value={minLeads} onValueChange={setMinLeads}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">כל הקמפיינים</SelectItem>
                <SelectItem value="5">מ-5 לידים</SelectItem>
                <SelectItem value="10">מ-10 לידים</SelectItem>
                <SelectItem value="25">מ-25 לידים</SelectItem>
                <SelectItem value="50">מ-50 לידים</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">קמפיין</TableHead>
                <SortableHead label="לידים" sortKey="leads" sort={sort} onSort={onSort} />
                <SortableHead label="המרה" sortKey="conversion" sort={sort} onSort={onSort} className="text-right" />
                <TableHead className="text-center">טופלו</TableHead>
                <TableHead className="text-center">הצעות</TableHead>
                <TableHead className="text-center">נסגרו</TableHead>
                <SortableHead label="הכנסות" sortKey="revenue" sort={sort} onSort={onSort} className="text-end" />
                <SortableHead label="עלות" sortKey="spend" sort={sort} onSort={onSort} />
                <SortableHead label="CPL" sortKey="cpl" sort={sort} onSort={onSort} />
                <SortableHead label="ROAS" sortKey="roas" sort={sort} onSort={onSort} />
                <TableHead className="text-center">המלצה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">טוען…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">אין קמפיינים בטווח</TableCell></TableRow>
              ) : rows.map((c) => {
                const isOpen = expanded === c.campaign;
                return (
                  <React.Fragment key={c.campaign}>
                    <TableRow
                      ref={c.campaign === focusCampaign ? focusRef : undefined}
                      className={`cursor-pointer hover:bg-muted/20 ${isOpen ? 'bg-indigo-50/40' : ''}`}
                      onClick={() => setExpanded(isOpen ? null : c.campaign)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[240px]" title={c.campaign}>{c.campaign}</div>
                            <ChannelBadge channel={c.channel} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="tabular-nums font-semibold">{c.leads.toLocaleString()}</span>
                          <DeltaBadge value={c.leadsDelta} />
                        </div>
                      </TableCell>
                      <TableCell><ConvBar value={c.conversion} /></TableCell>
                      <TableCell className="text-center tabular-nums text-xs">{c.leads > 0 ? `${c.contactedRate.toFixed(0)}%` : '—'}</TableCell>
                      <TableCell className="text-center tabular-nums text-xs">{c.leads > 0 ? `${c.quoteRate.toFixed(0)}%` : '—'}</TableCell>
                      <TableCell className="text-center tabular-nums font-semibold text-emerald-700">{c.won.toLocaleString()}</TableCell>
                      <TableCell className="text-end font-bold tabular-nums">{c.revenue > 0 ? formatCurrency(c.revenue) : '—'}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{c.spend > 0 ? formatCurrency(c.spend) : '—'}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{c.cpl != null ? formatCurrency(c.cpl) : '—'}</TableCell>
                      <TableCell className="text-center"><RoiBadge value={c.roas} /></TableCell>
                      <TableCell className="text-center"><RecoBadge type={insightByCampaign.get(c.campaign)} /></TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={11} className="bg-muted/20 p-3">
                          {/* drillKey = the raw server-side campaign key of the
                              dominant variant — the display name is normalized
                              and may match nothing in SQL. */}
                          <CampaignDrillRow campaign={c.drillKey || c.campaign} start={start} end={end} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {!isLoading && rows.length > 0 && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/50">
            לחיצה על שורה פותחת פירוט מלא — טרנד, אדסטים, מודעות, דפי נחיתה וסטטוסים. ההכנסות הן מכל ההזמנות של לידי התקופה (גם אם ההזמנה נסגרה אחריה).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
