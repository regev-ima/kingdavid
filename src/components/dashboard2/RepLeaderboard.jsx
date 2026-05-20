import React from 'react';
import { Crown } from 'lucide-react';

function formatCurrencyCompact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n.toLocaleString()}`;
}

function tierForConversion(conv) {
  if (conv >= 30) return 'bg-emerald-500';
  if (conv >= 15) return 'bg-amber-500';
  return 'bg-red-500';
}

// Compact rep leaderboard sized for a 1/4-width SectionCard at 1920×1080.
// Header row labels the metrics once; each rep row is just colored numbers
// in those columns. Sorted by revenue desc.
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
    <div className="rounded-md border border-border/50 overflow-hidden" dir="rtl">
      <div
        className="grid items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr)' }}
      >
        <div className="text-right">נציג</div>
        <div className="text-center text-emerald-700/80">סגירה</div>
        <div className="text-center text-amber-700/80">בטיפול</div>
        <div className="text-center text-red-700/80">אבד</div>
        <div className="text-end">הכנסות</div>
      </div>
      <div className="divide-y divide-border/50">
        {sorted.map((rep, idx) => {
          const conv = Number(rep.conversion ?? 0);
          const inHandling = Number(rep.in_handling_rate ?? 0);
          const lost = Number(rep.lost_rate ?? 0);
          const dot = tierForConversion(conv);
          const isTop = idx === 0;
          const displayName = rep.full_name || rep.email || 'לא ידוע';
          return (
            <div
              key={rep.email || displayName}
              className="grid items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-muted/20 transition-colors"
              style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr)' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isTop ? (
                  <Crown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                ) : (
                  <span className={`h-2 w-2 rounded-full ${dot} flex-shrink-0`} />
                )}
                <span className="font-semibold text-foreground truncate" title={displayName}>
                  {displayName}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {rep.leads_count || 0}
                </span>
              </div>
              <div className="text-center font-semibold text-emerald-700">{conv.toFixed(0)}%</div>
              <div className="text-center font-semibold text-amber-700">{inHandling.toFixed(0)}%</div>
              <div className="text-center font-semibold text-red-700">{lost.toFixed(0)}%</div>
              <div className="text-end font-bold text-foreground whitespace-nowrap">
                {formatCurrencyCompact(rep.revenue)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
