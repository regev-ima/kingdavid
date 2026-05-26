import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Megaphone, DollarSign, Users, Target, TrendingUp, ExternalLink,
  Lightbulb, Trophy,
} from 'lucide-react';

const SOURCE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

function formatCurrency(v) {
  return `₪${Number(v || 0).toLocaleString()}`;
}
function formatCurrencyCompact(v) {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n.toLocaleString()}`;
}

function KpiTile({ label, value, sub, tone = 'indigo', icon: Icon }) {
  const cls = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    cyan: 'bg-cyan-50 border-cyan-200 text-cyan-700',
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

// Coloured ROI badge — green > 2x, amber 1–2x, red < 1x. Drives the
// "where am I making / losing money" read at a glance across tables.
function RoiBadge({ value }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const n = Number(value);
  const cls = n >= 2 ? 'bg-emerald-100 text-emerald-800' : n >= 1 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{n.toFixed(1)}x</span>;
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

export default function MarketingTab({ current = {} }) {
  const navigate = useNavigate();

  const sources = useMemo(() => {
    const arr = current.marketingBreakdown || [];
    return [...arr].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  }, [current.marketingBreakdown]);

  const campaigns = useMemo(() => {
    const arr = current.campaigns || [];
    return [...arr].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  }, [current.campaigns]);

  const landingPages = useMemo(() => {
    const arr = current.landingPages || [];
    return [...arr].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  }, [current.landingPages]);

  // Reps sorted with the marketing lens: best closer first. Used so the
  // "who closes / who doesn't" panel highlights wins on the left and
  // lost rate on the right without needing a separate table.
  const reps = useMemo(() => {
    const arr = current.reps || [];
    return [...arr].sort((a, b) => (b.conversion || 0) - (a.conversion || 0));
  }, [current.reps]);

  const totalCost = Number(current.marketingCost || 0);
  const totalLeads = Number(current.marketingLeads || sources.reduce((s, r) => s + (r.leads_count || 0), 0));
  const totalWon = sources.reduce((s, r) => s + (r.won_count || 0), 0);
  const totalRevenue = Number(current.revenue || sources.reduce((s, r) => s + (r.revenue || 0), 0));
  const cpl = totalLeads > 0 ? Math.round(totalCost / totalLeads) : 0;
  const cac = totalWon > 0 ? Math.round(totalCost / totalWon) : 0;
  const roi = totalCost > 0 ? (totalRevenue / totalCost).toFixed(1) : null;
  const profit = totalRevenue - totalCost;

  // Source data prepared for the compact chart: revenue vs cost side by side.
  const chartData = sources.slice(0, 6).map((s) => ({
    name: s.name,
    revenue: s.revenue || 0,
    cost: s.cost || 0,
  }));

  // "איפה צריך לשפר" — the largest-spend source/campaign with ROI < 1
  // (paying for leads that aren't returning). The screen shows up to
  // two suggestions so the manager has a clear action item, not just a
  // wall of numbers.
  const opportunities = useMemo(() => {
    const all = [
      ...sources.map((s) => ({ ...s, kind: 'מקור' })),
      ...campaigns.map((c) => ({ ...c, kind: 'קמפיין' })),
    ].filter((row) => row.cost > 100 && row.roi != null && Number(row.roi) < 1);
    return all.sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 2);
  }, [sources, campaigns]);

  const topPerformers = useMemo(() => {
    const all = [
      ...campaigns.map((c) => ({ ...c, kind: 'קמפיין' })),
      ...sources.map((s) => ({ ...s, kind: 'מקור' })),
    ].filter((row) => row.roi != null && Number(row.roi) >= 2);
    return all.sort((a, b) => Number(b.roi || 0) - Number(a.roi || 0)).slice(0, 2);
  }, [sources, campaigns]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header with link to full page */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-orange-600" />
          <h2 className="text-lg font-bold">דשבורד שיווק</h2>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(createPageUrl('Marketing'))}>
          <ExternalLink className="h-3 w-3 me-1.5" />
          לדשבורד המלא
        </Button>
      </div>

      {/* Compact KPI strip — 5 tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile label="הוצאות שיווק" value={formatCurrency(totalCost)} icon={DollarSign} tone="rose" />
        <KpiTile label="לידים" value={totalLeads.toLocaleString()} sub={`${totalWon} נסגרו`} icon={Users} tone="indigo" />
        <KpiTile label="עלות לליד (CPL)" value={formatCurrency(cpl)} icon={Target} tone="amber" />
        <KpiTile label="עלות ללקוח (CAC)" value={formatCurrency(cac)} icon={Target} tone="emerald" />
        <KpiTile
          label="ROI כולל"
          value={roi != null ? `${roi}x` : '—'}
          sub={profit >= 0 ? `רווח: ${formatCurrency(profit)}` : `הפסד: ${formatCurrency(-profit)}`}
          icon={TrendingUp}
          tone={profit >= 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* Insights row — actionable summary, not a chart */}
      {(opportunities.length > 0 || topPerformers.length > 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {topPerformers.length > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-gradient-to-l from-emerald-50 to-white p-3">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-bold text-emerald-800">איפה עושים כסף</p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {topPerformers.map((t, i) => (
                  <li key={`${t.kind}-${t.name}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="truncate"><span className="text-[10px] text-muted-foreground me-1">[{t.kind}]</span>{t.name}</span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <RoiBadge value={t.roi} />
                      <span className="text-xs text-muted-foreground">{formatCurrencyCompact(t.revenue)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {opportunities.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-gradient-to-l from-amber-50 to-white p-3">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-bold text-amber-800">איפה צריך לשפר (ROI &lt; 1x)</p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {opportunities.map((t, i) => (
                  <li key={`${t.kind}-${t.name}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="truncate"><span className="text-[10px] text-muted-foreground me-1">[{t.kind}]</span>{t.name}</span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <RoiBadge value={t.roi} />
                      <span className="text-xs text-muted-foreground">עלות {formatCurrencyCompact(t.cost)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Compact chart — kept to h-44 so the tables below get the real
          estate. Two bars per source: revenue vs cost. */}
      <Card className="border-border shadow-card">
        <CardHeader className="pb-2 border-b border-border/50">
          <CardTitle className="text-sm">הכנסות מול עלויות לפי מקור</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {chartData.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">אין נתונים בטווח</div>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${v / 1000}K` : v} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(v, n) => [formatCurrency(v), n === 'revenue' ? 'הכנסות' : 'עלויות']}
                  />
                  <Bar dataKey="revenue" name="הכנסות" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cost"    name="עלויות"  fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The four tables — meat of the tab. Two-column grid on wide
          screens so the user gets all four breakdowns above the fold. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Sources */}
        <Card className="border-border shadow-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              מאיפה מגיעים הלידים — לפי מקור
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-1.5 text-right font-semibold">מקור</th>
                    <th className="px-2 py-1.5 text-center font-semibold">לידים</th>
                    <th className="px-2 py-1.5 text-center font-semibold">נסגרו</th>
                    <th className="px-2 py-1.5 text-right font-semibold">המרה</th>
                    <th className="px-2 py-1.5 text-center font-semibold">CPL</th>
                    <th className="px-2 py-1.5 text-center font-semibold">CAC</th>
                    <th className="px-2 py-1.5 text-end font-semibold">הכנסות</th>
                    <th className="px-2 py-1.5 text-center font-semibold">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {sources.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-xs text-muted-foreground">אין נתוני מקור בטווח</td></tr>
                  ) : sources.map((s, idx) => {
                    const cplVal = s.leads_count > 0 ? Math.round((s.cost || 0) / s.leads_count) : 0;
                    const cacVal = s.won_count > 0 ? Math.round((s.cost || 0) / s.won_count) : null;
                    return (
                      <tr key={s.name} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[idx % SOURCE_COLORS.length] }} />
                            <span className="font-medium">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center tabular-nums">{(s.leads_count || 0).toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700 font-semibold">{(s.won_count || 0).toLocaleString()}</td>
                        <td className="px-2 py-1.5"><ConvBar value={s.conversion} /></td>
                        <td className="px-2 py-1.5 text-center text-xs tabular-nums">{formatCurrency(cplVal)}</td>
                        <td className="px-2 py-1.5 text-center text-xs tabular-nums">{cacVal != null ? formatCurrency(cacVal) : '—'}</td>
                        <td className="px-2 py-1.5 text-end font-bold tabular-nums">{formatCurrencyCompact(s.revenue)}</td>
                        <td className="px-2 py-1.5 text-center"><RoiBadge value={s.roi} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Campaigns */}
        <Card className="border-border shadow-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              קמפיינים — מה מביא הכי הרבה הכנסה
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-1.5 text-right font-semibold">קמפיין</th>
                    <th className="px-2 py-1.5 text-center font-semibold">לידים</th>
                    <th className="px-2 py-1.5 text-center font-semibold">נסגרו</th>
                    <th className="px-2 py-1.5 text-center font-semibold">CPL</th>
                    <th className="px-2 py-1.5 text-end font-semibold">הכנסות</th>
                    <th className="px-2 py-1.5 text-center font-semibold">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {campaigns.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">אין קמפיינים בטווח</td></tr>
                  ) : campaigns.slice(0, 8).map((c) => (
                    <tr key={c.name} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5">
                        <div className="font-medium truncate max-w-[160px]" title={c.name}>{c.name}</div>
                        {c.source ? <div className="text-[10px] text-muted-foreground">{c.source}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{(c.leads_count || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700 font-semibold">{(c.won_count || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center text-xs tabular-nums">{formatCurrency(c.cpl || 0)}</td>
                      <td className="px-2 py-1.5 text-end font-bold tabular-nums">{formatCurrencyCompact(c.revenue)}</td>
                      <td className="px-2 py-1.5 text-center"><RoiBadge value={c.roi} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Landing pages */}
        <Card className="border-border shadow-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
              דפי נחיתה — איזה דף מביא לי הכי טוב
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-1.5 text-right font-semibold">דף נחיתה</th>
                    <th className="px-2 py-1.5 text-center font-semibold">לידים</th>
                    <th className="px-2 py-1.5 text-center font-semibold">נסגרו</th>
                    <th className="px-2 py-1.5 text-right font-semibold">המרה</th>
                    <th className="px-2 py-1.5 text-end font-semibold">הכנסות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {landingPages.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-xs text-muted-foreground">אין נתוני דפי נחיתה בטווח</td></tr>
                  ) : landingPages.slice(0, 8).map((p) => (
                    <tr key={p.name} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-xs truncate max-w-[200px]" title={p.name}>{p.name}</div>
                      </td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{(p.leads_count || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700 font-semibold">{(p.won_count || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5"><ConvBar value={p.conversion} /></td>
                      <td className="px-2 py-1.5 text-end font-bold tabular-nums">{formatCurrencyCompact(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Reps — who closes / who doesn't */}
        <Card className="border-border shadow-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              מי סוגר ומי לא — לפי נציג
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-1.5 text-right font-semibold">נציג</th>
                    <th className="px-2 py-1.5 text-center font-semibold">לידים</th>
                    <th className="px-2 py-1.5 text-center font-semibold text-emerald-700/80">% סגירה</th>
                    <th className="px-2 py-1.5 text-center font-semibold text-amber-700/80">% בטיפול</th>
                    <th className="px-2 py-1.5 text-center font-semibold text-red-700/80">% אבד</th>
                    <th className="px-2 py-1.5 text-end font-semibold">הכנסות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {reps.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">אין נתוני נציגים בטווח</td></tr>
                  ) : reps.slice(0, 8).map((r) => (
                    <tr key={r.email || r.full_name} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 font-medium truncate" title={r.full_name || r.email}>{r.full_name || r.email || 'לא ידוע'}</td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{(r.leads_count || 0).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-emerald-700">{Number(r.conversion || 0).toFixed(0)}%</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-amber-700">{Number(r.in_handling_rate || 0).toFixed(0)}%</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-red-700">{Number(r.lost_rate || 0).toFixed(0)}%</td>
                      <td className="px-2 py-1.5 text-end font-bold tabular-nums">{formatCurrencyCompact(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
