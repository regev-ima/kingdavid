import React from 'react';
import { formatSourceLabel } from '@/constants/leadOptions';
import { SOURCE_CHANNELS, resolveSourceChannel } from '@/constants/sourceChannels';

/**
 * A lead's arrival channel, as a colour.
 *
 * The badge shows the CHANNEL ("גוגל"), not the raw source — campaign names run
 * to "גוגל דף חדש עלית - ליד מטופס וואטסאפ", which no badge can hold and no
 * column can scan. The raw value stays one hover away in the tooltip, so
 * nothing the rep relies on today is lost.
 *
 * A source that matches no rule is not hidden behind a generic "אחר": it prints
 * its own text in grey. Whatever is in there is the only thing anyone knows
 * about that lead's origin, and dropping it to make the column tidy would be
 * throwing away the data to make the display look better.
 */
export default function SourceBadge({ source, className = '' }) {
  const raw = formatSourceLabel(source);
  if (!raw) return <span className="text-xs text-muted-foreground">—</span>;

  const channel = resolveSourceChannel(source);
  const tone = SOURCE_CHANNELS[channel] || SOURCE_CHANNELS.unknown;
  const text = tone.label || raw;

  return (
    <span
      title={raw}
      className={`inline-flex items-center gap-1.5 max-w-full rounded-full border bg-background
                  px-2 py-0.5 text-xs font-medium ${tone.border} ${tone.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${tone.dot}`} />
      <span className="truncate">{text}</span>
    </span>
  );
}
