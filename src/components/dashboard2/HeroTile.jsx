import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const COLOR_CLASSES = {
  blue: { bg: 'bg-blue-50/60', border: 'border-blue-100', iconBg: 'bg-blue-100', icon: 'text-blue-600', accent: 'text-blue-700' },
  emerald: { bg: 'bg-emerald-50/60', border: 'border-emerald-100', iconBg: 'bg-emerald-100', icon: 'text-emerald-600', accent: 'text-emerald-700' },
  amber: { bg: 'bg-amber-50/60', border: 'border-amber-100', iconBg: 'bg-amber-100', icon: 'text-amber-600', accent: 'text-amber-700' },
  red: { bg: 'bg-red-50/60', border: 'border-red-100', iconBg: 'bg-red-100', icon: 'text-red-600', accent: 'text-red-700' },
  violet: { bg: 'bg-violet-50/60', border: 'border-violet-100', iconBg: 'bg-violet-100', icon: 'text-violet-600', accent: 'text-violet-700' },
  indigo: { bg: 'bg-indigo-50/60', border: 'border-indigo-100', iconBg: 'bg-indigo-100', icon: 'text-indigo-600', accent: 'text-indigo-700' },
};

// Compact KPI tile sized for a 6-up hero row that has to survive a 1920×1080
// viewport behind a 256-px sidebar. KPICard's `text-4xl` value wraps full
// currency strings ("₪287,400" → "₪287,4 \n 00") at this density, so this
// one uses smaller type and `whitespace-nowrap` on the value.
export default function HeroTile({
  title,
  value,
  icon: Icon,
  color = 'indigo',
  onClick,
  delta,
  deltaPolarity = 'positive',
}) {
  const c = COLOR_CLASSES[color] || COLOR_CLASSES.indigo;
  const interactive = typeof onClick === 'function';

  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const positive = hasDelta && delta > 0;
  const negative = hasDelta && delta < 0;
  const good = (positive && deltaPolarity === 'positive') || (negative && deltaPolarity === 'negative');
  const bad = (negative && deltaPolarity === 'positive') || (positive && deltaPolarity === 'negative');
  const deltaTone = good ? 'text-emerald-700 bg-emerald-50' : bad ? 'text-red-700 bg-red-50' : 'text-muted-foreground bg-muted';
  const ArrowIcon = positive ? TrendingUp : negative ? TrendingDown : Minus;
  const deltaText = hasDelta ? `${Math.abs(delta * 100).toFixed(0)}%` : '—';

  const handleKeyDown = (e) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(e);
    }
  };

  return (
    <div
      onClick={interactive ? onClick : undefined}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`rounded-xl border ${c.border} ${c.bg} p-3 transition-all text-right ${
        interactive ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary' : ''
      }`}
      dir="rtl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide truncate" title={title}>
            {title}
          </p>
          <p
            className="text-2xl font-bold text-foreground leading-tight mt-1 whitespace-nowrap overflow-hidden text-ellipsis"
            title={String(value)}
          >
            {value}
          </p>
        </div>
        {Icon ? (
          <div className={`p-1.5 rounded-lg ${c.iconBg} flex-shrink-0`}>
            <Icon className={`h-4 w-4 ${c.icon}`} />
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-1">
        <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${deltaTone}`}>
          <ArrowIcon className="h-3 w-3" />
          {deltaText}
        </span>
        <span className="text-[10px] text-muted-foreground">מהתקופה הקודמת</span>
      </div>
    </div>
  );
}
