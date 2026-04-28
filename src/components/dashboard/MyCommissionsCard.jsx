import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Wallet, ChevronRight } from 'lucide-react';
import { isWithinInterval } from '@/lib/safe-date-fns';
import { formatCurrency } from '@/utils/currency';
import { getDateRange } from '@/utils/dateRange';
import { createPageUrl } from '@/utils';

// Per-rep visibility into their own commissions. The Commission entity isn't
// admin-gated server-side, so we fetch the full list and filter client-side
// to rows where the current user is rep1 or rep2 — taking the matching
// `rep1_amount` / `rep2_amount` per row so a deal split between two reps
// surfaces only the portion that belongs to this user.
export default function MyCommissionsCard({ effectiveUser }) {
  const [range, setRange] = useState('month');
  const userEmail = effectiveUser?.email;

  const { data: commissions = [], isLoading } = useQuery({
    queryKey: ['commissions', 'mine', userEmail],
    queryFn: () => base44.entities.Commission.list('-created_date'),
    enabled: !!userEmail,
    staleTime: 60000,
  });

  const summary = useMemo(() => {
    if (!userEmail) return { total: 0, pending: 0, approved: 0, paid: 0, count: 0 };
    const { start, end } = getDateRange(range);
    let total = 0;
    let pending = 0;
    let approved = 0;
    let paid = 0;
    let count = 0;
    commissions.forEach((c) => {
      const d = c.created_date ? new Date(c.created_date) : null;
      if (!d || !isWithinInterval(d, { start, end })) return;
      const myShare =
        c.rep1 === userEmail
          ? (c.rep1_amount || 0)
          : c.rep2 === userEmail
          ? (c.rep2_amount || 0)
          : 0;
      if (myShare === 0) return;
      total += myShare;
      count += 1;
      if (c.status === 'pending') pending += myShare;
      else if (c.status === 'approved') approved += myShare;
      else if (c.status === 'paid') paid += myShare;
    });
    return { total, pending, approved, paid, count };
  }, [commissions, userEmail, range]);

  const rangeLabel =
    range === 'today' ? 'היום' : range === 'week' ? 'השבוע' : range === 'month' ? 'החודש' : 'בטווח';

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-xl bg-purple-100 p-2.5">
            <Wallet className="h-5 w-5 text-purple-600" />
          </div>
          העמלות שלי
        </CardTitle>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">היום</SelectItem>
            <SelectItem value="week">השבוע</SelectItem>
            <SelectItem value="month">החודש</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground">סה"כ {rangeLabel}</p>
          <p className="text-3xl font-bold text-foreground leading-none mt-1">
            {isLoading ? '…' : formatCurrency(summary.total)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.count.toLocaleString()} עמלות
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <p className="text-[10px] text-amber-700">ממתין</p>
            <p className="text-sm font-semibold text-amber-900 mt-0.5">{formatCurrency(summary.pending)}</p>
          </div>
          <div className="rounded-lg bg-blue-50 px-3 py-2">
            <p className="text-[10px] text-blue-700">מאושר</p>
            <p className="text-sm font-semibold text-blue-900 mt-0.5">{formatCurrency(summary.approved)}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2">
            <p className="text-[10px] text-emerald-700">שולם</p>
            <p className="text-sm font-semibold text-emerald-900 mt-0.5">{formatCurrency(summary.paid)}</p>
          </div>
        </div>

        <Link to={createPageUrl('Orders')} className="block">
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs">
            ההזמנות שלי
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
