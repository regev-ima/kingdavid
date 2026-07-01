import React from 'react';
import { useLeadSourceIcons } from '@/hooks/useLeadSourceIcons';
import { SourceIconGlyph } from '@/constants/leadSourceIcons';
import { SOURCE_LABELS } from '@/constants/leadOptions';

// Renders a lead's arrival source as an icon (instead of raw text) so reps
// identify the channel at a glance. The icon is resolved from the admin's
// per-source override (Settings → מקורות הגעה) or auto-matched from the source
// string, falling back to a neutral default. The human-readable source stays
// available on hover via the title/aria-label.
export default function LeadSourceIcon({ source, className = 'h-5 w-5', showTitle = true }) {
  const { resolveIconId } = useLeadSourceIcons();

  if (!source) {
    return <span className="text-muted-foreground/40" title={showTitle ? 'ללא מקור' : undefined}>—</span>;
  }

  const iconId = resolveIconId(source);
  const label = SOURCE_LABELS[source] || source;

  return (
    <span
      className="inline-flex items-center justify-center"
      title={showTitle ? label : undefined}
      aria-label={label}
    >
      <SourceIconGlyph iconId={iconId} className={className} />
    </span>
  );
}
