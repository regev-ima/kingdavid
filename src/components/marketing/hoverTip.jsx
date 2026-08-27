import React, { useCallback, useState } from 'react';

// Instant hover tooltip for data cells — the heatmap treatment, generalized.
// Rendered position:fixed so table scroll containers can't clip it, appears
// with no browser delay, and flips below the cell when there's no room above.
export function useHoverTip() {
  const [tip, setTip] = useState(null);

  const show = useCallback((e, content) => {
    if (!content) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const below = rect.top < 150;
    const half = 150; // ~max-w/2 — keep the card inside the viewport
    const x = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
    setTip({ ...content, below, x, y: below ? rect.bottom : rect.top });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  const overlay = tip ? (
    <div
      dir="rtl"
      className={`fixed z-50 pointer-events-none -translate-x-1/2 ${tip.below ? '' : '-translate-y-full'} w-max max-w-[300px] rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-elevated text-right`}
      style={{ left: tip.x, top: tip.below ? tip.y + 6 : tip.y - 6 }}
    >
      <p className="font-bold text-foreground mb-0.5">{tip.title}</p>
      {tip.lines.map((line, i) => (
        <p key={i} className="text-muted-foreground leading-relaxed">{line}</p>
      ))}
    </div>
  ) : null;

  return { show, hide, overlay };
}
