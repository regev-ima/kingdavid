import React from 'react';

const COLOR_CLASSES = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  orange: 'bg-orange-50 text-orange-700 border-orange-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  gray: 'bg-muted text-foreground border-border',
};

function formatNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('en-US');
  }
  return value ?? '0';
}

// Compact KPI shown inside a SectionCard. Larger value, small label.
// Optional onClick makes it a drill-down target.
export default function MiniKPI({ label, value, color = 'gray', onClick, suffix }) {
  const colorClass = COLOR_CLASSES[color] || COLOR_CLASSES.gray;
  const interactive = typeof onClick === 'function';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      dir="rtl"
      className={`group flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-right w-full transition-all ${colorClass} ${
        interactive
          ? 'cursor-pointer hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          : 'cursor-default'
      }`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-75 truncate w-full text-right" title={label}>
        {label}
      </span>
      <span className="block text-lg sm:text-xl font-bold leading-none whitespace-nowrap overflow-hidden text-ellipsis w-full text-right" title={String(value ?? '')}>
        {formatNumber(value)}
        {suffix ? <span className="text-xs font-medium opacity-70 me-1">{suffix}</span> : null}
      </span>
    </button>
  );
}
