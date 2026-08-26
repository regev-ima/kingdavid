import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/utils/currency';
import { ConvBar, ChannelBadge } from './PanelBits';

// Landing pages for the SELECTED range — unlike the all-time landing_pages_stats
// view, these rows come from marketing_stats_v1 and respect the date filter.
export default function LandingPagesTable({ rows = [], isLoading }) {
  return (
    <Card>
      <CardHeader className="pb-2 border-b border-border/50">
        <CardTitle className="text-sm">דפי נחיתה בטווח הנבחר</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">דף נחיתה</TableHead>
                <TableHead className="text-right">ערוץ</TableHead>
                <TableHead className="text-center">לידים</TableHead>
                <TableHead className="text-right">המרה</TableHead>
                <TableHead className="text-center">הצעות</TableHead>
                <TableHead className="text-center">נסגרו</TableHead>
                <TableHead className="text-end">הכנסות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">טוען…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">אין נתוני דפי נחיתה בטווח</TableCell></TableRow>
              ) : rows.map((r, i) => {
                const leads = Number(r.leads || 0);
                const won = Number(r.won || 0);
                const quoted = Number(r.quoted || 0);
                return (
                  <TableRow key={`${r.lp}-${i}`} className="hover:bg-muted/20">
                    <TableCell>
                      <div dir="ltr" className="font-medium truncate max-w-[280px] text-right" title={r.lp}>{r.lp}</div>
                    </TableCell>
                    <TableCell><ChannelBadge channel={r.channel} /></TableCell>
                    <TableCell className="text-center tabular-nums font-semibold">{leads.toLocaleString()}</TableCell>
                    <TableCell><ConvBar value={leads > 0 ? (won / leads) * 100 : 0} /></TableCell>
                    <TableCell className="text-center tabular-nums text-xs">{leads > 0 ? `${((quoted / leads) * 100).toFixed(0)}%` : '—'}</TableCell>
                    <TableCell className="text-center tabular-nums font-semibold text-emerald-700">{won.toLocaleString()}</TableCell>
                    <TableCell className="text-end font-bold tabular-nums">{Number(r.revenue || 0) > 0 ? formatCurrency(r.revenue) : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
