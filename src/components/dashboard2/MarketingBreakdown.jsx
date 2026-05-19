import React from 'react';
import { Crown, Trophy } from 'lucide-react';

function formatCurrencyCompact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n.toLocaleString()}`;
}

function tierForConversion(conv) {
  if (conv >= 30) return { dot: 'bg-emerald-500' };
  if (conv >= 15) return { dot: 'bg-amber-500' };
  return { dot: 'bg-red-500' };
}

function StatPill({ label, value, tone }) {
  const toneClass = {
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    red: 'text-red-700 bg-red-50 border-red-100',
    blue: 'text-blue-700 bg-blue-50 border-blue-100',
  }[tone];
  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${toneClass}`}
      title={`${label}: ${value}`}
    >
      <span className="opacity-75">{label}</span>
      <span>{value}</span>
    </span>
  );
}

// Per-source marketing leaderboard for the Overview tab. Same shape as
// RepLeaderboard so the customer's eye doesn't have to relearn it: rank
// dot + name on the right, closing/handling/lost % in the middle, ROI on
// the left. Sorted by ROI descending — best marketing dollar on top.
export default function MarketingBreakdown({ sources = [], limit = 5 }) {
  const sorted = [...sources]
    .sort((a, b) => (Number(b.roi || 0)) - (Number(a.roi || 0)))
    .slice(0, limit);

  if (sorted.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 bg-muted/30 rounded-md">
        אין נתוני שיווק בטווח שנבחר
      </div>
    );
  }

  return (
    <div className="space-y-1.5" dir="rtl">
      {sorted.map((src, idx) => {
        const conv = Number(src.conversion ?? 0);
        const inHandling = Number(src.in_handling_rate ?? 0);
        const lost = Number(src.lost_rate ?? 0);
        const tier = tierForConversion(conv);
        const isTop = idx === 0;
        const roiLabel = src.roi != null ? `${src.roi}x` : '—';
        return (
          <div
            key={src.name}
            className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
              {isTop ? (
                <Trophy className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${tier.dot} flex-shrink-0`} />
              )}
              <span className="text-xs font-semibold text-foreground truncate" title={src.name}>
                {src.name}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {src.leads_count || 0} לידים
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              <StatPill label="סגירה" value={`${conv.toFixed(0)}%`} tone="emerald" />
              <StatPill label="בטיפול" value={`${inHandling.toFixed(0)}%`} tone="amber" />
              <StatPill label="אבד" value={`${lost.toFixed(0)}%`} tone="red" />
              <span
                className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700"
                title={`עלות: ${formatCurrencyCompact(src.cost)}`}
              >
                ROI {roiLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
