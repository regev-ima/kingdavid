import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/utils/currency';
import { ConvBar, RoiBadge, DeltaBadge, ChannelBadge, formatMins } from './PanelBits';
import { channelLabel } from './channelVisuals';
import InfoTip from './InfoTip';
import { useHoverTip } from './hoverTip';
import { buildCellTip } from './cellTips';

function HeadWithTip({ label, tipTitle, children, className = 'text-center' }) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {label}
        <InfoTip title={tipTitle || label}>{children}</InfoTip>
      </span>
    </TableHead>
  );
}

// Channel scoreboard: full economics per channel including the median
// first-response time — the number that explains half of every "conversion"
// argument before anyone touches the ad account. Every data cell explains
// itself on hover (buildCellTip) — the exact counts behind the number, its
// share of the totals, and the previous-period comparison.
export default function ChannelsTable({ channels = [], totals, isLoading, onChannelClick }) {
  const { show, hide, overlay } = useHoverTip();
  const tip = (c, col) => (e) => show(e, buildCellTip({ row: c, col, totals, rowLabel: channelLabel(c.channel) }));

  return (
    <Card>
      <CardHeader className="pb-2 border-b border-border/50">
        <CardTitle className="text-sm flex items-center gap-1.5">
          ערוצים — התמונה המלאה
          <InfoTip title="טבלת הערוצים">
            <p>שורה לכל ערוץ שהביא לידים (או שהוזנו לו עלויות) בטווח. לחיצה על שם ערוץ מסננת את כל הפאנל אליו, ומעבר עכבר על כל מספר מציג את הנתונים שמאחוריו.</p>
            <p>ליד משתייך לערוץ לפי מקור ההגעה שלו: תגית utm מהקישור ← שדה המקור ← זיהוי פייסבוק. ליד שהגיע לאתר דרך מודעה נספר בערוץ המודעה, לא ב"אתר".</p>
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0" onMouseLeave={hide}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">ערוץ</TableHead>
                <HeadWithTip label="לידים">
                  <p>כמה לידים הביא הערוץ בטווח. החץ הקטן משווה לתקופה מקבילה קודמת.</p>
                </HeadWithTip>
                <HeadWithTip label="המרה" className="text-right">
                  <p>אחוז הלידים של הערוץ שסגרו עסקה. ירוק מ-30% ומעלה, צהוב מ-15%, אדום מתחת.</p>
                </HeadWithTip>
                <HeadWithTip label="טופלו">
                  <p>אחוז הלידים שקיבלו שיחה ראשונה. אחוז נמוך = הלידים של הערוץ לא נענים — אי אפשר לשפוט את הערוץ לפני שמטפלים בזה.</p>
                </HeadWithTip>
                <HeadWithTip label="הצעות">
                  <p>אחוז הלידים שקיבלו הצעת מחיר מהמערכת. נספרות רק הצעות שהופקו במערכת.</p>
                </HeadWithTip>
                <HeadWithTip label="זמן תגובה">
                  <p>הזמן החציוני מהגעת ליד של הערוץ ועד השיחה הראשונה אליו. ארוך = הערוץ מקבל עדיפות נמוכה במוקד.</p>
                </HeadWithTip>
                <HeadWithTip label="הכנסות" className="text-end">
                  <p>סך ההזמנות (ללא מבוטלות) של לידי הערוץ מהטווח — גם אם ההזמנה בוצעה אחרי הטווח.</p>
                </HeadWithTip>
                <HeadWithTip label="עלות">
                  <p>עלויות השיווק שהוזנו לערוץ בטווח. "—" = לא הוזנו עלויות.</p>
                </HeadWithTip>
                <HeadWithTip label="CPL">
                  <p>עלות לליד: עלות הערוץ חלקי הלידים שלו. נמוך = טוב.</p>
                </HeadWithTip>
                <HeadWithTip label="CAC">
                  <p>עלות לעסקה: עלות הערוץ חלקי העסקאות שנסגרו ממנו. המדד האמיתי להשוואת ערוצים.</p>
                </HeadWithTip>
                <HeadWithTip label="ROAS">
                  <p>החזר על השקעה: הכנסות חלקי עלות. ירוק מ-2x, צהוב מ-1x, אדום מתחת ל-1x (הפסד).</p>
                </HeadWithTip>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">טוען…</TableCell></TableRow>
              ) : channels.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">אין נתונים בטווח</TableCell></TableRow>
              ) : channels.map((c) => (
                <TableRow key={c.channel} className="hover:bg-muted/20">
                  <TableCell onMouseEnter={tip(c, 'name')}>
                    <button type="button" className="hover:opacity-70" onClick={() => onChannelClick?.(c.channel)}>
                      <ChannelBadge channel={c.channel} />
                    </button>
                  </TableCell>
                  <TableCell className="text-center" onMouseEnter={tip(c, 'leads')}>
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="tabular-nums font-semibold">{c.leads.toLocaleString()}</span>
                      <DeltaBadge value={c.leadsDelta} />
                    </div>
                  </TableCell>
                  <TableCell onMouseEnter={tip(c, 'conversion')}><ConvBar value={c.conversion} /></TableCell>
                  <TableCell className="text-center tabular-nums text-xs" onMouseEnter={tip(c, 'contacted')}>{c.contactedRate.toFixed(0)}%</TableCell>
                  <TableCell className="text-center tabular-nums text-xs" onMouseEnter={tip(c, 'quoted')}>{c.quoteRate.toFixed(0)}%</TableCell>
                  <TableCell className="text-center tabular-nums text-xs" onMouseEnter={tip(c, 'medianMins')}>{formatMins(c.medianMins)}</TableCell>
                  <TableCell className="text-end font-bold tabular-nums" onMouseEnter={tip(c, 'revenue')}>{formatCurrency(c.revenue)}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums" onMouseEnter={tip(c, 'spend')}>{c.spend > 0 ? formatCurrency(c.spend) : '—'}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums" onMouseEnter={tip(c, 'cpl')}>{c.cpl != null ? formatCurrency(c.cpl) : '—'}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums" onMouseEnter={tip(c, 'cac')}>{c.cac != null ? formatCurrency(c.cac) : '—'}</TableCell>
                  <TableCell className="text-center" onMouseEnter={tip(c, 'roas')}><RoiBadge value={c.roas} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {overlay}
      </CardContent>
    </Card>
  );
}
