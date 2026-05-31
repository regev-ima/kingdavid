import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Check } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';

export const DEFAULT_PRESETS = [
  { key: 'today', label: 'היום' },
  { key: 'yesterday', label: 'אתמול' },
  { key: 'week', label: 'השבוע' },
  { key: 'month', label: 'החודש' },
  { key: '90days', label: '90 יום' },
  { key: 'year', label: 'השנה' },
  { key: 'custom', label: 'מותאם' },
];

function formatLabel(rangeKey, dateRange, presets) {
  const preset = presets.find((p) => p.key === rangeKey);
  const presetLabel = preset?.label || 'בחר טווח';
  if (rangeKey === 'custom' && dateRange?.from && dateRange?.to) {
    return `${format(dateRange.from, 'dd.MM.yy')} - ${format(dateRange.to, 'dd.MM.yy')}`;
  }
  return presetLabel;
}

export default function Dashboard2DateRange({ rangeKey, dateRange, onPresetChange, onCustomChange, presets = DEFAULT_PRESETS }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 text-xs font-normal gap-2" dir="rtl">
          <CalendarIcon className="h-4 w-4" />
          <span>{formatLabel(rangeKey, dateRange, presets)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" dir="rtl">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-col gap-1 p-3 border-s border-border/50 bg-muted/40 min-w-[140px]">
            {presets.map((preset) => {
              const active = rangeKey === preset.key;
              return (
                <Button
                  key={preset.key}
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => onPresetChange(preset.key)}
                  className="justify-between font-normal h-8 text-xs"
                >
                  <span>{preset.label}</span>
                  {active ? <Check className="h-3.5 w-3.5" /> : null}
                </Button>
              );
            })}
          </div>
          {rangeKey === 'custom' ? (
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={onCustomChange}
              numberOfMonths={2}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
