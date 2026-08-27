import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoTip from './InfoTip';

// When do leads arrive — hour (Israel time) × day-of-week intensity grid.
// Useful for dayparting: budget and staffing follow the hot cells.
const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']; // DOW 0 = Sunday

export default function MarketingHeatmap({ hours = [], note }) {
  const { grid, max, total } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    let m = 0;
    let t = 0;
    for (const r of hours) {
      const dow = Number(r.dow);
      const hour = Number(r.hour);
      if (dow < 0 || dow > 6 || hour < 0 || hour > 23) continue;
      const v = Number(r.leads || 0);
      g[dow][hour] += v;
      t += v;
      if (g[dow][hour] > m) m = g[dow][hour];
    }
    return { grid: g, max: m, total: t };
  }, [hours]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            מתי מגיעים הלידים (שעה ישראל)
            <InfoTip title="מתי מגיעים הלידים">
              <p>כל משבצת = יום בשבוע × שעה ביממה. כהה יותר = יותר לידים נכנסו בשעה הזאת לאורך הטווח.</p>
              <p>למה זה שווה כסף: המשבצות הכהות אומרות מתי לתגבר את המוקד ומתי לרכז תקציב פרסום; משבצות בהירות בשעות שמפרסמים בהן = תקציב שנשרף על שעות חלשות.</p>
              <p>ריחוף על משבצת מציג את היום, השעה ומספר הלידים המדויק.</p>
            </InfoTip>
          </span>
          {note ? <span className="text-[11px] font-normal text-muted-foreground">{note}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {total === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">אין נתונים בטווח</div>
        ) : (
          <div className="overflow-x-auto">
            {/* The hour axis is a number line — keep it LTR even on an RTL page. */}
            <div dir="ltr" className="min-w-[560px]">
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))' }}>
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-center text-[9px] text-muted-foreground tabular-nums">
                    {h % 3 === 0 ? h : ''}
                  </div>
                ))}
                {grid.map((row, dow) => (
                  <React.Fragment key={dow}>
                    <div className="flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                      {DAY_LABELS[dow]}
                    </div>
                    {row.map((v, h) => (
                      <div
                        key={h}
                        title={`יום ${DAY_LABELS[dow]} ${String(h).padStart(2, '0')}:00 — ${v.toLocaleString()} לידים`}
                        className="aspect-square rounded-[3px] min-w-[14px]"
                        style={{
                          backgroundColor: v > 0
                            ? `rgba(79, 70, 229, ${0.12 + 0.88 * (v / max)})`
                            : 'hsl(var(--muted) / 0.35)',
                        }}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
