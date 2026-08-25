import React from 'react';
import { SOURCE_CHANNELS } from '@/constants/sourceChannels';
import { channelLabel } from './channelVisuals';

// Tiny display atoms shared by the marketing panel tables.

export function ConvBar({ value }) {
  const n = Math.max(0, Math.min(100, Number(value || 0)));
  const tone = n >= 30 ? 'bg-emerald-500' : n >= 15 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${n}%` }} />
      </div>
      <span className="text-xs tabular-nums font-semibold">{n.toFixed(0)}%</span>
    </div>
  );
}

export function RoiBadge({ value }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const n = Number(value);
  const cls = n >= 2 ? 'bg-emerald-100 text-emerald-800' : n >= 1 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${cls}`}>{n.toFixed(2)}x</span>;
}

// Period-over-period badge. `value` is a fraction (+0.25 = +25%); polarity
// 'negative' flips colors for metrics where rising is bad (CPL, CAC).
export function DeltaBadge({ value, polarity = 'positive' }) {
  if (value == null || !Number.isFinite(value)) return null;
  const rising = value > 0;
  const good = (rising && polarity === 'positive') || (!rising && value < 0 && polarity === 'negative');
  const cls = value === 0
    ? 'bg-muted text-muted-foreground'
    : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700';
  const arrow = rising ? '▲' : value < 0 ? '▼' : '•';
  return (
    <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}>
      {arrow} {Math.abs(value * 100).toFixed(0)}%
    </span>
  );
}

export function ChannelBadge({ channel }) {
  const meta = SOURCE_CHANNELS[channel] || SOURCE_CHANNELS.unknown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.border} ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {channelLabel(channel)}
    </span>
  );
}

// "12 דק׳" / "1.5 שע׳" — median first-response time.
export function formatMins(mins) {
  if (mins == null || !Number.isFinite(mins)) return '—';
  if (mins < 60) return `${Math.round(mins)} דק׳`;
  return `${(mins / 60).toFixed(1)} שע׳`;
}
