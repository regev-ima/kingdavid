import React from 'react';
import { Crown } from 'lucide-react';

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

function tierForConversion(conv) {
  if (conv >= 30) return { dot: 'bg-emerald-500' };
  if (conv >= 15) return { dot: 'bg-amber-500' };
  return { dot: 'bg-red-500' };
}

// Three-color breakdown so the customer can see at a glance, per rep:
// סגירה (won) / בטיפול (still open) / אבד (lost or timed out).
// The three percentages should sum to ~100 — they describe what happened
// to every lead the rep ever touched in the selected window.
function StatPill({ label, value, tone }) {
  const toneClass = {
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    red: 'text-red-700 bg-red-50 border-red-100',
  }[tone];
  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${toneClass}`}
      title={`${label}: ${value}%`}
    >
      <span className="opacity-75">{label}</span>
      <span>{Number(value || 0).toFixed(0)}%</span>
    </span>
  );
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
    <div className="space-y-1.5" dir="rtl">
      {sorted.map((rep, idx) => {
        const conv = Number(rep.conversion ?? 0);
        const inHandling = Number(rep.in_handling_rate ?? 0);
        const lost = Number(rep.lost_rate ?? 0);
        const tier = tierForConversion(conv);
        const isTop = idx === 0;
        const displayName = rep.full_name || rep.email || 'לא ידוע';
        return (
          <div
            key={rep.email || displayName}
            className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
              {isTop ? (
                <Crown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${tier.dot} flex-shrink-0`} />
              )}
              <span className="text-xs font-semibold text-foreground truncate" title={displayName}>
                {displayName}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              <StatPill label="סגירה" value={conv} tone="emerald" />
              <StatPill label="בטיפול" value={inHandling} tone="amber" />
              <StatPill label="אבד" value={lost} tone="red" />
              <span className="text-xs font-bold text-foreground whitespace-nowrap ms-1">
                {formatCurrency(rep.revenue)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
