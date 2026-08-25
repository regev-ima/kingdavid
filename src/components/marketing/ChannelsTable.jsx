import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/utils/currency';
import { ConvBar, RoiBadge, DeltaBadge, ChannelBadge, formatMins } from './PanelBits';

// Channel scoreboard: full economics per channel including the median
// first-response time — the number that explains half of every "conversion"
// argument before anyone touches the ad account.
export default function ChannelsTable({ channels = [], isLoading, onChannelClick }) {
  return (
    <Card>
      <CardHeader className="pb-2 border-b border-border/50">
        <CardTitle className="text-sm">ערוצים — התמונה המלאה</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">ערוץ</TableHead>
                <TableHead className="text-center">לידים</TableHead>
                <TableHead className="text-right">המרה</TableHead>
                <TableHead className="text-center">טופלו</TableHead>
                <TableHead className="text-center">הצעות</TableHead>
                <TableHead className="text-center">זמן תגובה</TableHead>
                <TableHead className="text-end">הכנסות</TableHead>
                <TableHead className="text-center">עלות</TableHead>
                <TableHead className="text-center">CPL</TableHead>
                <TableHead className="text-center">CAC</TableHead>
                <TableHead className="text-center">ROAS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">טוען…</TableCell></TableRow>
              ) : channels.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">אין נתונים בטווח</TableCell></TableRow>
              ) : channels.map((c) => (
                <TableRow key={c.channel} className="hover:bg-muted/20">
                  <TableCell>
                    <button type="button" className="hover:opacity-70" onClick={() => onChannelClick?.(c.channel)}>
                      <ChannelBadge channel={c.channel} />
                    </button>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="tabular-nums font-semibold">{c.leads.toLocaleString()}</span>
                      <DeltaBadge value={c.leadsDelta} />
                    </div>
                  </TableCell>
                  <TableCell><ConvBar value={c.conversion} /></TableCell>
                  <TableCell className="text-center tabular-nums text-xs">{c.contactedRate.toFixed(0)}%</TableCell>
                  <TableCell className="text-center tabular-nums text-xs">{c.quoteRate.toFixed(0)}%</TableCell>
                  <TableCell className="text-center tabular-nums text-xs">{formatMins(c.medianMins)}</TableCell>
                  <TableCell className="text-end font-bold tabular-nums">{formatCurrency(c.revenue)}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{c.spend > 0 ? formatCurrency(c.spend) : '—'}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{c.cpl != null ? formatCurrency(c.cpl) : '—'}</TableCell>
                  <TableCell className="text-center text-xs tabular-nums">{c.cac != null ? formatCurrency(c.cac) : '—'}</TableCell>
                  <TableCell className="text-center"><RoiBadge value={c.roas} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
