import React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useLeadSourceIcons } from '@/hooks/useLeadSourceIcons';
import { SourceIconGlyph, SOURCE_ICON_MAP, DEFAULT_SOURCE_ICON_ID } from '@/constants/leadSourceIcons';
import { SOURCE_LABELS } from '@/constants/leadOptions';

// Renders a lead's arrival source as an icon (instead of raw text) so reps
// identify the channel at a glance. The icon is resolved from the admin's
// per-source override (Settings → מקורות הגעה) or auto-matched from the source
// string, falling back to a neutral default. Hovering the icon reveals the
// source details (the exact source text + the recognised channel).
export default function LeadSourceIcon({ source, className = 'h-5 w-5' }) {
  const { resolveIconId } = useLeadSourceIcons();

  if (!source) {
    return <span className="text-muted-foreground/40" title="ללא מקור">—</span>;
  }

  const iconId = resolveIconId(source);
  const label = SOURCE_LABELS[source] || source;
  const channelLabel = SOURCE_ICON_MAP[iconId]?.label;
  const showChannel = iconId !== DEFAULT_SOURCE_ICON_ID && channelLabel && channelLabel !== label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center" aria-label={label}>
          <SourceIconGlyph iconId={iconId} className={className} />
        </span>
      </TooltipTrigger>
      <TooltipContent dir="rtl" className="text-center">
        <p className="text-xs font-semibold">מקור: {label}</p>
        {showChannel && <p className="text-[11px] opacity-75">ערוץ מזוהה: {channelLabel}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
