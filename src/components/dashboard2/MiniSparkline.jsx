import React from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { format, parseISO, isValid } from '@/lib/safe-date-fns';

function formatTooltipDate(value) {
  try {
    if (typeof value === 'string' && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
      // Hourly buckets used for "today" / "yesterday" demo views.
      const [, hh] = value.split(' ');
      const [d] = value.split(' ');
      const dt = parseISO(d);
      if (isValid(dt)) return `${format(dt, 'dd.MM')} ${hh}`;
      return value;
    }
    const d = typeof value === 'string' ? parseISO(value) : new Date(value);
    if (!isValid(d)) return value;
    return format(d, 'dd.MM');
  } catch {
    return value;
  }
}

// Tiny line chart for trend visualization inside SectionCards.
// Data shape: [{ date, value }]
export default function MiniSparkline({ data = [], color = '#4f46e5', height = 56, valueLabel = '' }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground bg-muted/30 rounded-md"
        style={{ height }}
      >
        אין נתונים בטווח
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: '2 2' }}
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
              padding: '4px 8px',
            }}
            labelFormatter={formatTooltipDate}
            formatter={(value) => [value, valueLabel || 'ערך']}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
