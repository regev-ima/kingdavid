import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoTip from './InfoTip';

// When do leads arrive — hour (Israel time) × day-of-week intensity grid.
// Useful for dayparting: budget and staffing follow the hot cells.
const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']; // DOW 0 = Sunday
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const hh = (h) => String(h).padStart(2, '0');

export default function MarketingHeatmap({ hours = [], note }) {
  // A custom instant tooltip instead of the native `title`: the browser one
  // appears after a ~1s delay (or not at all on touch), which makes scanning
  // the grid useless. Rendered position:fixed so the card's scroll container
  // can't clip it.
  const [hover, setHover] = useState(null); // { dow, hour, leads, won, x, y }

  const { grid, wonGrid, max, total } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    const w = Array.from({ length: 7 }, () => Array(24).fill(0));
    let m = 0;
    let t = 0;
    for (const r of hours) {
      const dow = Number(r.dow);
      const hour = Number(r.hour);
      if (dow < 0 || dow > 6 || hour < 0 || hour > 23) continue;
      const v = Number(r.leads || 0);
      g[dow][hour] += v;
      w[dow][hour] += Number(r.won || 0);
      t += v;
      if (g[dow][hour] > m) m = g[dow][hour];
    }
    return { grid: g, wonGrid: w, max: m, total: t };
  }, [hours]);

  const showCell = (e, dow, hour, leads, won) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Near the top of the viewport there's no room above the cell — flip below.
    const below = rect.top < 90;
    setHover({
      dow, hour, leads, won, below,
      x: rect.left + rect.width / 2,
      y: below ? rect.bottom : rect.top,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            מתי מגיעים הלידים (שעה ישראל)
            <InfoTip title="מתי מגיעים הלידים">
              <p>כל משבצת = יום בשבוע × שעה ביממה. כהה יותר = יותר לידים נכנסו בשעה הזאת לאורך הטווח.</p>
              <p>למה זה שווה כסף: המשבצות הכהות אומרות מתי לתגבר את המוקד ומתי לרכז תקציב פרסום; משבצות בהירות בשעות שמפרסמים בהן = תקציב שנשרף על שעות חלשות.</p>
              <p>מעבר עם העכבר על משבצת מציג את היום, השעה, מספר הלידים, חלקם מכלל התקופה וכמה מהם נסגרו.</p>
            </InfoTip>
          </span>
          {note ? <span className="text-[11px] font-normal text-muted-foreground">{note}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {total === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">אין נתונים בטווח</div>
        ) : (
          <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
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
                        onMouseEnter={(e) => showCell(e, dow, h, v, wonGrid[dow][h])}
                        onMouseMove={(e) => { if (!hover || hover.dow !== dow || hover.hour !== h) showCell(e, dow, h, v, wonGrid[dow][h]); }}
                        className={`aspect-square rounded-[3px] min-w-[14px] transition-shadow ${
                          hover && hover.dow === dow && hover.hour === h ? 'ring-2 ring-indigo-500 z-10' : ''
                        }`}
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
            {hover && (
              <div
                dir="rtl"
                className={`fixed z-50 pointer-events-none -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-elevated ${
                  hover.below ? '' : '-translate-y-full'
                }`}
                style={{ left: hover.x, top: hover.below ? hover.y + 6 : hover.y - 6 }}
              >
                <p className="font-bold text-foreground whitespace-nowrap">
                  יום {DAY_NAMES[hover.dow]} · {hh(hover.hour)}:00–{hh((hover.hour + 1) % 24)}:00
                </p>
                <p className="text-muted-foreground whitespace-nowrap mt-0.5">
                  <b className="text-foreground tabular-nums">{hover.leads.toLocaleString()}</b> לידים
                  {total > 0 && <> · {((hover.leads / total) * 100).toFixed(1)}% מהתקופה</>}
                </p>
                {hover.leads > 0 && (
                  <p className="text-muted-foreground whitespace-nowrap">
                    <b className="text-emerald-700 tabular-nums">{hover.won.toLocaleString()}</b> נסגרו
                    {' '}({((hover.won / hover.leads) * 100).toFixed(0)}% המרה)
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
