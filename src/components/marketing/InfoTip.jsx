import React from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// The ⓘ next to every metric on the marketing panel. Click-to-open Popover
// rather than a hover Tooltip on purpose: it works on touch, and the
// explanations are full sentences the reader should be able to keep open.
export default function InfoTip({ title, children, side = 'bottom', className = '' }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground transition-colors ${className}`}
          aria-label={`הסבר: ${title}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-80 max-w-[90vw] p-3 text-xs leading-relaxed"
      >
        <p className="font-bold text-foreground mb-1">{title}</p>
        <div className="text-muted-foreground space-y-1.5 [&_b]:text-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
