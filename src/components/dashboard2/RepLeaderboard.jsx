import React from 'react';
import { Crown, TrendingUp } from 'lucide-react';

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

// Top sales reps for the selected period. Color codes conversion rate
// (≥30% green, 15-30% amber, <15% red) so the customer can spot at a glance
// who is performing and who is not.
function tierForConversion(conv) {
  if (conv >= 30) return { dot: 'bg-emerald-500', label: 'text-emerald-700' };
  if (conv >= 15) return { dot: 'bg-amber-500', label: 'text-amber-700' };
  return { dot: 'bg-red-500', label: 'text-red-700' };
}

export default function RepLeaderboard({ reps = [], limit = 5 }) {
  const sorted = [...reps]
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
    .slice(0, limit);

  if (sorted.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 bg-muted/30 rounded-md">
        אין נתוני נציגים בטווח שנבחר
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {sorted.map((rep, idx) => {
        const conv = Number(rep.conversion ?? 0);
        const tier = tierForConversion(conv);
        const isTop = idx === 0;
        const displayName = rep.full_name || rep.email || 'לא ידוע';
        return (
          <div
            key={rep.email || displayName}
            className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isTop ? (
                <Crown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${tier.dot} flex-shrink-0`} />
              )}
              <span className="text-xs font-semibold text-foreground truncate" title={displayName}>
                {displayName}
              </span>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 text-[11px]">
              <span className="text-muted-foreground">
                {rep.leads_count || 0} לידים
              </span>
              <span className={`font-semibold ${tier.label}`}>
                {conv.toFixed(0)}%
              </span>
              <span className="font-bold text-foreground">
                {formatCurrency(rep.revenue)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
