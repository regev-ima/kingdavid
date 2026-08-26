import React, { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, Area, AreaChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { channelHex, channelLabel } from './channelVisuals';

// Daily trends: leads stacked by channel (with the won line over them) and
// revenue per day. Data comes pre-summed from marketing_stats_v1 — 'daily' is
// {d, channel, leads, won} rows, 'revenueDaily' is {d, revenue} — so these are
// pure re-shapes, no fetching.

const MAX_STACKED_CHANNELS = 6;
const fmtDay = (d) => (typeof d === 'string' ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
  direction: 'rtl',
};

export default function TrendCharts({ daily = [], revenueDaily = [], selectedChannel = 'all' }) {
  const { rows, channels } = useMemo(() => {
    const filtered = selectedChannel === 'all' ? daily : daily.filter((r) => r.channel === selectedChannel);
    const totals = new Map();
    for (const r of filtered) totals.set(r.channel, (totals.get(r.channel) || 0) + Number(r.leads || 0));
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_STACKED_CHANNELS).map(([ch]) => ch);
    const topSet = new Set(top);

    const byDay = new Map();
    for (const r of filtered) {
      const row = byDay.get(r.d) || { d: r.d, won: 0, rest: 0 };
      const key = topSet.has(r.channel) ? r.channel : 'rest';
      row[key] = (row[key] || 0) + Number(r.leads || 0);
      row.won += Number(r.won || 0);
      byDay.set(r.d, row);
    }
    const sorted = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
    const hasRest = sorted.some((r) => r.rest > 0);
    const keys = hasRest ? [...top, 'rest'] : top;
    // Zero-fill: recharts stacks misrender days where a series is undefined.
    for (const row of sorted) for (const k of keys) row[k] = row[k] || 0;
    return { rows: sorted, channels: keys };
  }, [daily, selectedChannel]);

  const revRows = useMemo(
    () => (revenueDaily || []).map((r) => ({ d: r.d, revenue: Number(r.revenue || 0) })).sort((a, b) => a.d.localeCompare(b.d)),
    [revenueDaily],
  );

  const seriesLabel = (key) => (key === 'rest' ? 'שאר הערוצים' : channelLabel(key));
  const seriesColor = (key) => (key === 'rest' ? '#cbd5e1' : channelHex(key));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">לידים ביום — לפי ערוץ</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">אין נתונים בטווח</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" reversed tickFormatter={fmtDay} tick={{ fontSize: 11 }} minTickGap={18} />
                <YAxis orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={fmtDay}
                  formatter={(value, name) => [Number(value).toLocaleString(), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {channels.map((key) => (
                  <Bar key={key} dataKey={key} stackId="leads" name={seriesLabel(key)} fill={seriesColor(key)} radius={[2, 2, 0, 0]} />
                ))}
                <Line type="monotone" dataKey="won" name="נסגרו" stroke="#059669" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span>הכנסות ביום (הזמנות בתקופה)</span>
            {/* revenue_daily is aggregated per day only — the channel cut
                doesn't apply to it, same convention as the heatmap. */}
            {selectedChannel !== 'all' && (
              <span className="text-[11px] font-normal text-muted-foreground">כל הערוצים (ללא סינון)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {revRows.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">אין הכנסות בטווח</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={revRows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="mkRevFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="d" reversed tickFormatter={fmtDay} tick={{ fontSize: 11 }} minTickGap={18} />
                <YAxis orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : v)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={fmtDay}
                  formatter={(value) => [`₪${Number(value).toLocaleString()}`, 'הכנסות']}
                />
                <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} fill="url(#mkRevFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
