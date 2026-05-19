import React from 'react';
import { Trophy } from 'lucide-react';

function tierForConversion(conv) {
  if (conv >= 30) return 'bg-emerald-500';
  if (conv >= 15) return 'bg-amber-500';
  return 'bg-red-500';
}

// Compact mini-table sized to live inside a 1/4-width SectionCard at
// 1920×1080. Pills-with-labels overflow there, so we drop to a plain
// columnar layout: a header row labels the metrics once, then each
// source row is just colored numbers under those columns. Sorted by
// ROI desc (best-performing source on top).
export default function MarketingBreakdown({ sources = [], limit = 5 }) {
  const sorted = [...sources]
    .sort((a, b) => Number(b.roi || 0) - Number(a.roi || 0))
    .slice(0, limit);

  if (sorted.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 bg-muted/30 rounded-md">
        אין נתוני שיווק בטווח שנבחר
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/50 overflow-hidden" dir="rtl">
      <div
        className="grid items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.2fr)' }}
      >
        <div className="text-right">מקור</div>
        <div className="text-center text-emerald-700/80">סגירה</div>
        <div className="text-center text-amber-700/80">בטיפול</div>
        <div className="text-center text-red-700/80">אבד</div>
        <div className="text-end text-blue-700/80">ROI</div>
      </div>
      <div className="divide-y divide-border/50">
        {sorted.map((src, idx) => {
          const conv = Number(src.conversion ?? 0);
          const inHandling = Number(src.in_handling_rate ?? 0);
          const lost = Number(src.lost_rate ?? 0);
          const dot = tierForConversion(conv);
          const isTop = idx === 0;
          const roiLabel = src.roi != null ? `${src.roi}x` : '—';
          return (
            <div
              key={src.name}
              className="grid items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-muted/20 transition-colors"
              style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) minmax(0, 1.2fr)' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isTop ? (
                  <Trophy className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                ) : (
                  <span className={`h-2 w-2 rounded-full ${dot} flex-shrink-0`} />
                )}
                <span className="font-semibold text-foreground truncate" title={src.name}>
                  {src.name}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {src.leads_count || 0}
                </span>
              </div>
              <div className="text-center font-semibold text-emerald-700">{conv.toFixed(0)}%</div>
              <div className="text-center font-semibold text-amber-700">{inHandling.toFixed(0)}%</div>
              <div className="text-center font-semibold text-red-700">{lost.toFixed(0)}%</div>
              <div className="text-end font-bold text-blue-700 whitespace-nowrap" title={src.cost ? `עלות: ₪${Number(src.cost).toLocaleString()}` : ''}>
                {roiLabel}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
