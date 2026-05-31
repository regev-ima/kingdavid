import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

// Shared stat cube: the platform's standard KPI card (white Card +
// shadow-card + rounded icon chip + muted label + bold value). Used by the
// Orders snapshot and the Sales-Tasks header so they look identical.
//
// Props:
//   label    – muted caption
//   value    – the big number / currency string (pre-formatted)
//   icon     – lucide icon component
//   tone     – icon-chip colour key (see TONE)
//   sub      – optional small caption under the value
//   onClick  – makes the card clickable (button semantics + hover lift)
//   active   – draws the primary ring (selected filter)
//   disabled – read-only card: no pointer, no hover, ignores clicks
//   title    – native tooltip

// Static class strings (no interpolation) so Tailwind's purge keeps them.
const TONE = {
  emerald: 'bg-emerald-100 text-emerald-600',
  blue: 'bg-blue-100 text-blue-600',
  indigo: 'bg-indigo-100 text-indigo-600',
  amber: 'bg-amber-100 text-amber-600',
  violet: 'bg-violet-100 text-violet-600',
  cyan: 'bg-cyan-100 text-cyan-600',
  slate: 'bg-slate-100 text-slate-600',
  red: 'bg-red-100 text-red-600',
  rose: 'bg-rose-100 text-rose-600',
  sky: 'bg-sky-100 text-sky-600',
};

export default function StatCube({
  label,
  value,
  icon: Icon,
  tone = 'slate',
  sub,
  onClick,
  active = false,
  disabled = false,
  title,
}) {
  const interactive = typeof onClick === 'function' && !disabled;

  return (
    <Card
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={title}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e);
        }
      } : undefined}
      className={`shadow-card border-border transition-all ${
        interactive
          ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          : ''
      } ${active ? 'ring-2 ring-primary border-primary' : ''} ${disabled ? 'opacity-90' : ''}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate" title={label}>{label}</p>
            <p className="text-2xl font-bold text-foreground mt-1 truncate tabular-nums" title={String(value ?? '')}>
              {value}
            </p>
            {sub ? <p className="text-[11px] text-muted-foreground mt-1 leading-tight truncate" title={sub}>{sub}</p> : null}
          </div>
          {Icon ? (
            <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${TONE[tone] || TONE.slate}`}>
              <Icon className="w-5 h-5" />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
