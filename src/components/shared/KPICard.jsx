import React from 'react';
import { TrendingUp, TrendingDown } from "lucide-react";

const formatNumber = (num) => {
  if (typeof num === 'string') {
    // Check if the string is purely numeric
    const parsed = parseFloat(num.replace(/,/g, ''));
    if (!isNaN(parsed)) {
      return new Intl.NumberFormat('en-US').format(parsed);
    }
    return num; // Return as-is if it contains non-numeric characters like "5 דק׳"
  }
  if (typeof num === 'number') {
    return new Intl.NumberFormat('en-US').format(num);
  }
  return num;
};

export default function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  color = 'indigo',
  onClick,
  delta,
  // 'positive' = rising is good (green ▲); 'negative' = rising is bad (e.g.
  // unpaid balance, pending commissions). Affects color of the delta badge.
  deltaPolarity = 'positive',
  deltaLabel,
}) {
  const displayValue = formatNumber(value);
  const colorConfig = {
    indigo: { bg: 'bg-indigo-50/50', icon: 'text-indigo-600', iconBg: 'bg-indigo-100', text: 'text-indigo-600', border: 'border-indigo-100/50' },
    emerald: { bg: 'bg-emerald-50/50', icon: 'text-emerald-600', iconBg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-100/50' },
    green: { bg: 'bg-emerald-50/50', icon: 'text-emerald-600', iconBg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-100/50' },
    amber: { bg: 'bg-amber-50/50', icon: 'text-amber-600', iconBg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-100/50' },
    red: { bg: 'bg-red-50/50', icon: 'text-red-600', iconBg: 'bg-red-100', text: 'text-red-600', border: 'border-red-100/50' },
    blue: { bg: 'bg-blue-50/50', icon: 'text-blue-600', iconBg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-100/50' },
    purple: { bg: 'bg-purple-50/50', icon: 'text-purple-600', iconBg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-100/50' },
    orange: { bg: 'bg-orange-50/50', icon: 'text-orange-600', iconBg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-100/50' },
    cyan: { bg: 'bg-cyan-50/50', icon: 'text-cyan-600', iconBg: 'bg-cyan-100', text: 'text-cyan-600', border: 'border-cyan-100/50' },
    violet: { bg: 'bg-violet-50/50', icon: 'text-violet-600', iconBg: 'bg-violet-100', text: 'text-violet-600', border: 'border-violet-100/50' },
    gray: { bg: 'bg-muted/50', icon: 'text-muted-foreground', iconBg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border/50' },
  };

  const c = colorConfig[color] || colorConfig.indigo;

  // Period-over-period delta. We render `null` for missing/non-finite numbers
  // (no prior data → "—") and treat 0 as a neutral "no change" so the card
  // doesn't claim a 100% rise out of nowhere. Polarity flips the colors for
  // KPIs where rising is bad (unpaid, refunds, pending commissions).
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const deltaIsPositive = hasDelta && delta > 0;
  const deltaIsNegative = hasDelta && delta < 0;
  const deltaIsGood =
    (deltaIsPositive && deltaPolarity === 'positive') ||
    (deltaIsNegative && deltaPolarity === 'negative');
  const deltaIsBad =
    (deltaIsNegative && deltaPolarity === 'positive') ||
    (deltaIsPositive && deltaPolarity === 'negative');
  const deltaToneClass = deltaIsGood
    ? 'bg-emerald-50 text-emerald-700'
    : deltaIsBad
    ? 'bg-red-50 text-red-700'
    : 'bg-muted text-muted-foreground';
  const deltaArrow = deltaIsPositive ? '▲' : deltaIsNegative ? '▼' : '•';
  const deltaText = hasDelta
    ? `${deltaArrow} ${Math.abs(delta * 100).toFixed(0)}%`
    : '—';

  return (
    <div 
      className={`relative overflow-hidden rounded-xl border ${c.border} ${c.bg} p-4 sm:p-6 transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 active:translate-y-0' : 'shadow-card'}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-6">
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-[10px] sm:text-xs font-semibold text-muted-foreground mb-1 sm:mb-2 truncate uppercase tracking-wide" title={title}>{title}</p>
          <p className={`text-xl sm:text-4xl font-bold text-foreground leading-tight break-words`}>{displayValue}</p>
          {subtitle && (
            <p className="text-[10px] sm:text-sm text-muted-foreground mt-1 sm:mt-2 truncate" title={subtitle}>{subtitle}</p>
          )}
          {trend && (
            <div className="flex items-center mt-1 sm:mt-3 gap-1">
              {trend === 'up' ? (
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3 w-3 sm:h-4 sm:w-4 text-red-500" />
              )}
              <span className={`text-xs sm:text-sm font-semibold ${trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
                {trendValue}
              </span>
            </div>
          )}
          {(hasDelta || deltaLabel) && (
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] sm:text-xs font-semibold ${deltaToneClass}`}
              >
                {deltaText}
              </span>
              {deltaLabel && (
                <span className="text-[10px] sm:text-xs text-muted-foreground truncate" title={deltaLabel}>
                  {deltaLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl ${c.iconBg} flex-shrink-0 self-start`}>
            <Icon className={`h-4 w-4 sm:h-6 sm:w-6 ${c.icon}`} />
          </div>
        )}
      </div>
    </div>
  );
}