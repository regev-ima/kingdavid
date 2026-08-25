import React from 'react';
import { SOURCE_CHANNELS } from '@/constants/sourceChannels';
import { channelLabel } from './channelVisuals';

// One clickable chip per channel that actually has data in the range, ordered
// by lead volume. This is the panel's main cut: everything below it re-slices
// instantly (client-side) to the selected channel.
export default function ChannelChips({ channels = [], selected, onSelect }) {
  const total = channels.reduce((acc, c) => acc + c.leads, 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onSelect('all')}
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
          selected === 'all'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-card text-foreground border-border hover:bg-muted/50'
        }`}
      >
        כל הערוצים
        <span className={`ms-1.5 tabular-nums ${selected === 'all' ? 'opacity-80' : 'text-muted-foreground'}`}>
          {total.toLocaleString()}
        </span>
      </button>
      {channels.map((c) => {
        const meta = SOURCE_CHANNELS[c.channel] || SOURCE_CHANNELS.unknown;
        const active = selected === c.channel;
        return (
          <button
            key={c.channel}
            type="button"
            onClick={() => onSelect(active ? 'all' : c.channel)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : `bg-card border-border hover:bg-muted/50 ${meta.text}`
            }`}
            title={channelLabel(c.channel)}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {channelLabel(c.channel)}
            <span className={`tabular-nums ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
              {c.leads.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
