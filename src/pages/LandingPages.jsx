import React, { useState, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Globe, Search, ArrowUpDown } from 'lucide-react';

function formatCurrency(v) {
  return `₪${Number(v || 0).toLocaleString()}`;
}

export default function LandingPages() {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('total_leads');
  const [sortDir, setSortDir] = useState('desc');
  const [sourceFilter, setSourceFilter] = useState('all');

  // Single round-trip — public.landing_pages_stats does the per-landing-page
  // aggregation server-side (see supabase/migrations/.._landing_pages_stats_view.sql).
  // The previous fetchAll() approach pulled every lead/order/quote in 500-row
  // batches and aggregated in the browser, which timed out on a 100k-lead
  // dataset and made the page unloadable.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['landingPagesStats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('landing_pages_stats').select('*');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const allSources = useMemo(() => {
    const s = new Set();
    rows.forEach(r => {
      if (!r.sources || r.sources === '-') return;
      r.sources.split(',').forEach(part => {
        const t = part.trim();
        if (t) s.add(t);
      });
    });
    return Array.from(s).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    let result = rows;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.landing_page?.toLowerCase().includes(q) ||
        r.sources?.toLowerCase().includes(q)
      );
    }

    if (sourceFilter !== 'all') {
      result = result.filter(r => r.sources?.includes(sourceFilter));
    }

    result = [...result].sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === 'string' || typeof bVal === 'string') {
        return sortDir === 'desc' ? String(bVal).localeCompare(String(aVal)) : String(aVal).localeCompare(String(bVal));
      }
      return sortDir === 'desc' ? Number(bVal) - Number(aVal) : Number(aVal) - Number(bVal);
    });

    return result;
  }, [rows, search, sourceFilter, sortField, sortDir]);

  const totals = useMemo(() => {
    return filteredRows.reduce((acc, r) => ({
      leads: acc.leads + (Number(r.total_leads) || 0),
      won: acc.won + (Number(r.won_leads) || 0),
      quotes: acc.quotes + (Number(r.quote_leads) || 0),
      revenue: acc.revenue + (Number(r.revenue) || 0),
      open: acc.open + (Number(r.open_leads) || 0),
    }), { leads: 0, won: 0, quotes: 0, revenue: 0, open: 0 });
  }, [filteredRows]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortHeader = ({ field, children }) => (
    <TableHead
      className="text-right cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <ArrowUpDown className="h-3 w-3 text-primary" />
        )}
      </div>
    </TableHead>
  );

  if (isLoading) {
    return (
      <div className="space-y-4" dir="rtl">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Globe className="h-6 w-6 text-teal-600" />
            דפי נחיתה
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ניתוח ביצועים לפי דף נחיתה — כלל הנתונים במערכת
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-blue-100 bg-blue-50/40">
          <CardContent className="p-4 text-right">
            <p className="text-xs text-muted-foreground mb-1">סה"כ דפי נחיתה</p>
            <p className="text-2xl font-bold">{filteredRows.length}</p>
          </CardContent>
        </Card>
        <Card className="border-indigo-100 bg-indigo-50/40">
          <CardContent className="p-4 text-right">
            <p className="text-xs text-muted-foreground mb-1">סה"כ לידים</p>
            <p className="text-2xl font-bold">{totals.leads.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-100 bg-emerald-50/40">
          <CardContent className="p-4 text-right">
            <p className="text-xs text-muted-foreground mb-1">סגירות</p>
            <p className="text-2xl font-bold">{totals.won}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-100 bg-purple-50/40">
          <CardContent className="p-4 text-right">
            <p className="text-xs text-muted-foreground mb-1">הצעות נשלחו</p>
            <p className="text-2xl font-bold">{totals.quotes}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-100 bg-amber-50/40">
          <CardContent className="p-4 text-right">
            <p className="text-xs text-muted-foreground mb-1">הכנסות</p>
            <p className="text-2xl font-bold">{formatCurrency(totals.revenue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="חיפוש דף נחיתה..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="כל המקורות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המקורות</SelectItem>
                {allSources.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader field="landing_page">דף נחיתה</SortHeader>
                  <TableHead className="text-right">מקורות</TableHead>
                  <SortHeader field="total_leads">לידים</SortHeader>
                  <SortHeader field="open_leads">פתוחים</SortHeader>
                  <SortHeader field="quote_rate">% הצעה</SortHeader>
                  <SortHeader field="conversion_rate">% המרה</SortHeader>
                  <SortHeader field="won_leads">סגירות</SortHeader>
                  <SortHeader field="revenue">הכנסות</SortHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      לא נמצאו דפי נחיתה
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => (
                    <TableRow key={row.landing_page}>
                      <TableCell className="font-medium max-w-[250px]">
                        <span className="block truncate" title={row.landing_page}>
                          {row.landing_page}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{row.sources || '-'}</span>
                      </TableCell>
                      <TableCell className="font-semibold">{row.total_leads}</TableCell>
                      <TableCell>{row.open_leads}</TableCell>
                      <TableCell>
                        <Badge variant={row.quote_rate >= 30 ? 'success' : row.quote_rate >= 15 ? 'info' : 'secondary'}>
                          {row.quote_rate}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.conversion_rate >= 5 ? 'success' : row.conversion_rate >= 2 ? 'info' : 'secondary'}>
                          {row.conversion_rate}%
                        </Badge>
                      </TableCell>
                      <TableCell>{row.won_leads}</TableCell>
                      <TableCell className="font-semibold">{formatCurrency(row.revenue)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
