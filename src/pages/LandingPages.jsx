import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Globe, Search, TrendingUp, Users, FileText, DollarSign, ArrowUpDown } from 'lucide-react';

function formatCurrency(v) {
  return `₪${Number(v || 0).toLocaleString()}`;
}

async function fetchAll(entity, query, sort = '-created_date') {
  const all = [];
  let skip = 0;
  const BATCH = 500;
  while (true) {
    const batch = await base44.entities[entity].filter(query, sort, BATCH, skip);
    all.push(...batch);
    if (batch.length < BATCH) break;
    skip += BATCH;
  }
  return all;
}

function aggregateLandingPages(leads, orders, quotes) {
  const leadsById = new Map(leads.map(l => [l.id, l]));
  const lpMap = new Map();

  const getRow = (lp) => {
    if (!lpMap.has(lp)) {
      lpMap.set(lp, {
        landing_page: lp,
        sources: new Set(),
        total_leads: 0,
        won_leads: 0,
        quote_leads: 0,
        open_leads: 0,
        revenue: 0,
        statuses: {},
      });
    }
    return lpMap.get(lp);
  };

  const quoteLeadIds = new Set(quotes.map(q => q.lead_id).filter(Boolean));

  leads.forEach(lead => {
    const lp = (lead.landing_page || '').trim() || 'ללא דף נחיתה';
    const row = getRow(lp);
    row.total_leads += 1;
    if (lead.utm_source || lead.source) row.sources.add(lead.utm_source || lead.source);
    if (lead.status === 'deal_closed') row.won_leads += 1;
    if (quoteLeadIds.has(lead.id)) row.quote_leads += 1;

    const closed = new Set([
      'deal_closed','not_relevant_duplicate','mailing_remove_request',
      'lives_far_phone_concern','products_not_available','not_relevant_bought_elsewhere',
      'not_relevant_1000_nis','not_relevant_denies_contact','not_relevant_service',
      'not_interested_hangs_up','not_relevant_no_explanation','heard_price_not_interested',
      'not_relevant_wrong_number','closed_by_manager_to_mailing'
    ]);
    if (!closed.has(lead.status)) row.open_leads += 1;

    const status = lead.status || 'unknown';
    row.statuses[status] = (row.statuses[status] || 0) + 1;
  });

  orders.forEach(order => {
    const lead = order.lead_id ? leadsById.get(order.lead_id) : null;
    const lp = (lead?.landing_page || '').trim() || 'ללא דף נחיתה';
    getRow(lp).revenue += Number(order.total || 0);
  });

  return Array.from(lpMap.values()).map(row => ({
    ...row,
    sources: Array.from(row.sources).join(', ') || '-',
    conversion_rate: row.total_leads > 0 ? Math.round((row.won_leads / row.total_leads) * 1000) / 10 : 0,
    quote_rate: row.total_leads > 0 ? Math.round((row.quote_leads / row.total_leads) * 1000) / 10 : 0,
  }));
}

export default function LandingPages() {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('total_leads');
  const [sortDir, setSortDir] = useState('desc');
  const [sourceFilter, setSourceFilter] = useState('all');

  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['landing-pages-leads'],
    queryFn: () => fetchAll('Lead', {}, '-created_date'),
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['landing-pages-orders'],
    queryFn: () => fetchAll('Order', {}, '-created_date'),
  });

  const { data: quotes, isLoading: quotesLoading } = useQuery({
    queryKey: ['landing-pages-quotes'],
    queryFn: () => fetchAll('Quote', {}, '-created_date'),
  });

  const isLoading = leadsLoading || ordersLoading || quotesLoading;

  const rows = useMemo(() => {
    if (!leads || !orders || !quotes) return [];
    return aggregateLandingPages(leads, orders, quotes);
  }, [leads, orders, quotes]);

  const allSources = useMemo(() => {
    const s = new Set();
    (leads || []).forEach(l => {
      if (l.utm_source || l.source) s.add(l.utm_source || l.source);
    });
    return Array.from(s).sort();
  }, [leads]);

  const filteredRows = useMemo(() => {
    let result = rows;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.landing_page.toLowerCase().includes(q) || r.sources.toLowerCase().includes(q));
    }

    if (sourceFilter !== 'all') {
      result = result.filter(r => r.sources.includes(sourceFilter));
    }

    result.sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      return sortDir === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
    });

    return result;
  }, [rows, search, sourceFilter, sortField, sortDir]);

  const totals = useMemo(() => {
    return filteredRows.reduce((acc, r) => ({
      leads: acc.leads + r.total_leads,
      won: acc.won + r.won_leads,
      quotes: acc.quotes + r.quote_leads,
      revenue: acc.revenue + r.revenue,
      open: acc.open + r.open_leads,
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
                        <span className="text-xs text-muted-foreground">{row.sources}</span>
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