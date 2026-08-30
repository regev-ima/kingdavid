import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import QuickActions from '@/components/shared/QuickActions';
import { useCreationModal } from '@/components/shared/CreationModalContext';
import { useQuoteModal } from '@/components/quote/QuoteModalContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, X, TrendingUp, TrendingDown } from "lucide-react";
import { format, differenceInDays } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canViewOrdersWorkspace, filterQuotesForUser, canViewQuote, isPhoneLookupTerm, isAdmin } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';
import { getDateRange, getPreviousDateRange } from '@/utils/dateRange';
import Dashboard2DateRange, { DEFAULT_PRESETS } from '@/components/dashboard2/Dashboard2DateRange';

const filterOptions = [
  {
    key: 'status',
    label: 'סטטוס',
    options: [
      { value: 'draft', label: 'טיוטה' },
      { value: 'sent', label: 'נשלח' },
      { value: 'approved', label: 'מאושר' },
      { value: 'rejected', label: 'נדחה' },
      { value: 'expired', label: 'פג תוקף' },
    ]
  },
];

// Like Orders, the quotes list opens on every quote rather than an empty
// "today" — the range narrows it down, it doesn't define it.
const QUOTES_PRESETS = [{ key: 'all', label: 'הכול' }, ...DEFAULT_PRESETS];

const TABS = ['all', 'open', 'draft', 'pending', 'expiring', 'expired'];

const sumTotal = (rows) => rows.reduce((sum, q) => sum + (q.total || 0), 0);

const repKeyOf = (quote) => String(quote?.created_by_rep || 'unassigned').toLowerCase();

// Days left on the quote's validity — negative once it has lapsed, null when
// there is no (or an unusable) valid_until.
function daysLeft(quote) {
  if (!quote?.valid_until) return null;
  const days = differenceInDays(new Date(quote.valid_until), new Date());
  return Number.isFinite(days) ? days : null;
}

// Not yet finalized: still awaiting a customer response.
const isOpenQuote = (q) => q.status === 'draft' || q.status === 'sent';

// A draft lapses exactly like a sent quote does, so both count here — scoping
// this to 'sent' is what used to leave the expiring tab reading 0 while the
// table showed rows in amber.
function isExpiringQuote(q) {
  if (!isOpenQuote(q)) return false;
  const days = daysLeft(q);
  return days !== null && days >= 0 && days <= 3;
}

function isExpiredQuote(q) {
  if (q.status === 'approved' || q.status === 'rejected') return false;
  if (q.status === 'expired') return true;
  const days = daysLeft(q);
  return days !== null && days < 0;
}

function withinRange(quote, from, to) {
  const t = new Date(quote?.created_date).getTime();
  return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
}

function StatTile({ label, count, total, tone = 'default', active, onClick }) {
  const valueTone = {
    default: 'text-foreground',
    primary: 'text-primary',
    amber: 'text-amber-600',
    red: 'text-red-600',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-start transition-colors ${
        active
          ? 'bg-primary/10 border border-primary ring-1 ring-primary'
          : 'bg-muted/40 border border-border hover:bg-muted hover:border-primary/40'
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold leading-tight ${valueTone}`}>
        ₪{Math.round(total).toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground">{count.toLocaleString()} הצעות</p>
    </button>
  );
}

export default function Quotes() {
  const { openNewQuote } = useCreationModal();
  const { openQuote } = useQuoteModal();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [activeTab, setActiveTab] = useState(TABS.includes(initialTab) ? initialTab : 'all');
  const [filters, setFilters] = useState({ search: '', status: 'all' });
  // Narrows the table to one rep, on top of the tab/search/status filters.
  // Driven by clicking a per-rep card on the summary above.
  const [repFilter, setRepFilter] = useState('');
  // Period the whole screen is scoped to, by quote creation date: counters,
  // summary, per-rep breakdown and the table all read the same window.
  const [rangeKey, setRangeKey] = useState('all');
  const [customRange, setCustomRange] = useState(null);
  const canAccessSales = canViewOrdersWorkspace(effectiveUser);

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => base44.entities.Quote.list('-created_date'),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-quotes-access'],
    queryFn: () => fetchAllList(base44.entities.Lead, '-created_date'),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: canAccessSales,
  });

  const leadsById = buildLeadsById(leads);
  const scopedQuotes = filterQuotesForUser(effectiveUser, quotes, leadsById);
  // A phone search lets a rep find OTHER reps' quotes too (view-only); counts
  // and the per-rep drilldown keep using the rep's own scopedQuotes.
  const phoneSearch = isPhoneLookupTerm(filters.search);
  const searchableQuotes = phoneSearch
    ? quotes.map((q) => ({ ...q, _readOnly: !canViewQuote(effectiveUser, q, leadsById) }))
    : scopedQuotes;

  const { start: rangeStart, end: rangeEnd } = getDateRange(rangeKey, customRange?.from, customRange?.to);
  // "הכול" has no meaningful predecessor, so the comparison strip is hidden there.
  const prevRange = rangeKey === 'all'
    ? null
    : getPreviousDateRange(rangeKey, customRange?.from, customRange?.to);
  const rangeQuotes = scopedQuotes.filter(q => withinRange(q, rangeStart, rangeEnd));
  const prevQuotes = prevRange ? scopedQuotes.filter(q => withinRange(q, prevRange.start, prevRange.end)) : [];

  // Expiry is about the validity date, not when the quote was written: scoping
  // it to the selected period would hide a quote that lapses tomorrow just
  // because it was drafted last month. Those two views ignore the range.
  const isExpiryTab = activeTab === 'expiring' || activeTab === 'expired';
  let filteredQuotes = isExpiryTab
    ? searchableQuotes
    : searchableQuotes.filter(q => withinRange(q, rangeStart, rangeEnd));

  if (activeTab === 'open') {
    filteredQuotes = filteredQuotes.filter(isOpenQuote);
  } else if (activeTab === 'pending') {
    filteredQuotes = filteredQuotes.filter(q => q.status === 'sent');
  } else if (activeTab === 'draft') {
    filteredQuotes = filteredQuotes.filter(q => q.status === 'draft');
  } else if (activeTab === 'expiring') {
    filteredQuotes = filteredQuotes.filter(isExpiringQuote);
  } else if (activeTab === 'expired') {
    filteredQuotes = filteredQuotes.filter(isExpiredQuote);
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredQuotes = filteredQuotes.filter(q =>
      q.quote_number?.toLowerCase().includes(searchLower) ||
      q.customer_name?.toLowerCase().includes(searchLower) ||
      q.customer_phone?.includes(filters.search)
    );
  }
  if (filters.status && filters.status !== 'all') {
    filteredQuotes = filteredQuotes.filter(q => q.status === filters.status);
  }
  if (repFilter) {
    const repFilterKey = repFilter.toLowerCase();
    filteredQuotes = filteredQuotes.filter(q => repKeyOf(q) === repFilterKey);
  }

  const pendingCount = rangeQuotes.filter(q => q.status === 'sent').length;
  const draftCount = rangeQuotes.filter(q => q.status === 'draft').length;

  // "Open" quotes = not yet finalized (drafts + sent, awaiting customer response).
  const openQuotes = rangeQuotes.filter(isOpenQuote);
  const expiringQuotes = scopedQuotes.filter(isExpiringQuote);
  const expiredQuotes = scopedQuotes.filter(isExpiredQuote);

  const producedTotal = sumTotal(rangeQuotes);
  const prevProducedTotal = sumTotal(prevQuotes);
  // Percent change against the previous period. Null when there is nothing to
  // divide by — a jump from zero is shown as a plain "חדש" instead of ∞%.
  const producedDelta = producedTotal - prevProducedTotal;
  const producedPct = prevProducedTotal > 0 ? Math.round((producedDelta / prevProducedTotal) * 100) : null;

  const rangeLabel = rangeKey === 'custom' && customRange?.from && customRange?.to
    ? `${format(customRange.from, 'dd.MM.yy')} - ${format(customRange.to, 'dd.MM.yy')}`
    : QUOTES_PRESETS.find(p => p.key === rangeKey)?.label || '';

  // Per-rep breakdown — only meaningful when the viewer can see other reps'
  // quotes (i.e. admin). For sales users the list is already scoped to them.
  const showPerRep = isAdmin(effectiveUser);
  const userByEmail = users.reduce((acc, u) => {
    if (u?.email) acc[String(u.email).toLowerCase()] = u;
    return acc;
  }, {});
  const repTotals = [];
  if (showPerRep) {
    const byRep = new Map();
    const rowFor = (quote) => {
      const key = repKeyOf(quote);
      if (!byRep.has(key)) {
        const repEmail = quote.created_by_rep || 'unassigned';
        const repUser = userByEmail[key];
        byRep.set(key, {
          email: repEmail,
          name: repUser?.full_name || (key === 'unassigned' ? 'לא משויך' : repEmail),
          count: 0,
          total: 0,
          openCount: 0,
          prevCount: 0,
          prevTotal: 0,
        });
      }
      return byRep.get(key);
    };
    for (const q of rangeQuotes) {
      const row = rowFor(q);
      row.count += 1;
      row.total += q.total || 0;
      if (isOpenQuote(q)) row.openCount += 1;
    }
    // Reps with nothing this period but something last period still get a card,
    // so a drop to zero is visible instead of silently disappearing.
    for (const q of prevQuotes) {
      const row = rowFor(q);
      row.prevCount += 1;
      row.prevTotal += q.total || 0;
    }
    repTotals.push(...[...byRep.values()].sort((a, b) => b.total - a.total));
  }

  const columns = [
    {
      header: 'מס\' הצעה',
      render: (row) => (
        <span className="font-medium text-primary">#{row.quote_number}</span>
      )
    },
    {
      header: 'לקוח',
      render: (row) => (
        <div>
          <p className="font-medium">
            {row.customer_name}
            {row._readOnly && <span className="ms-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 align-middle">צפייה בלבד</span>}
          </p>
          <p className="text-sm text-muted-foreground">{row.customer_phone}</p>
        </div>
      )
    },
    {
      header: 'סכום',
      render: (row) => (
        <span className="font-semibold text-lg">₪{row.total?.toLocaleString()}</span>
      )
    },
    {
      header: 'סטטוס',
      render: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'תוקף',
      render: (row) => {
        if (!row.valid_until) return '-';
        const days = daysLeft(row);
        if (days === null) return '-';
        const isExpiring = days <= 3 && days >= 0;
        const isExpired = days < 0;
        return (
          <span className={`text-sm ${isExpired ? 'text-red-600' : isExpiring ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {format(new Date(row.valid_until), 'dd/MM/yyyy')}
            {isExpiring && <span className="block text-xs">נותרו {days} ימים</span>}
            {isExpired && <span className="block text-xs">פג לפני {Math.abs(days)} ימים</span>}
          </span>
        );
      }
    },
    {
      header: 'תאריך',
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(row.created_date), 'dd/MM/yyyy')}
        </span>
      )
    },
    {
      header: 'פעולות',
      render: (row) => (
        <QuickActions 
          type="quote" 
          data={row}
          onView={() => openQuote(row.id)}
        />
      )
    }
  ];

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSales) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת להצעות מחיר</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">הצעות מחיר</h1>
          <p className="text-sm text-muted-foreground">ניהול הצעות מחיר ללקוחות</p>
        </div>
        <Button onClick={() => openNewQuote({})}>
          <Plus className="h-4 w-4 me-2" />
          הצעה חדשה
        </Button>
      </div>

      <Card className="border-border shadow-card">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">סה"כ הצעות שהופקו · {rangeLabel}</p>
              <p className="text-2xl font-bold text-foreground leading-none mt-1">
                ₪{Math.round(producedTotal).toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {rangeQuotes.length.toLocaleString()} הצעות
              </p>
              {prevRange && (
                <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className={producedDelta >= 0 ? 'text-emerald-600 inline-flex items-center gap-1' : 'text-red-600 inline-flex items-center gap-1'}>
                    {producedDelta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                    {producedPct === null
                      ? (producedDelta > 0 ? 'חדש' : 'ללא שינוי')
                      : `${Math.abs(producedPct)}%`}
                  </span>
                  <span className="text-muted-foreground">
                    לעומת התקופה הקודמת ({prevQuotes.length.toLocaleString()} הצעות · ₪{Math.round(prevProducedTotal).toLocaleString()})
                  </span>
                </p>
              )}
            </div>
            <Dashboard2DateRange
              rangeKey={rangeKey}
              dateRange={{ from: rangeStart, to: rangeEnd }}
              onPresetChange={(key) => {
                setRangeKey(key);
                if (key !== 'custom') setCustomRange(null);
              }}
              onCustomChange={(range) => {
                setCustomRange(range || null);
                if (range?.from && range?.to) setRangeKey('custom');
              }}
              presets={QUOTES_PRESETS}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <StatTile
              label="פתוחות (טיוטה + נשלחו)"
              count={openQuotes.length}
              total={sumTotal(openQuotes)}
              tone="primary"
              active={activeTab === 'open'}
              onClick={() => setActiveTab(activeTab === 'open' ? 'all' : 'open')}
            />
            <StatTile
              label="ממתינות לתשובה"
              count={pendingCount}
              total={sumTotal(rangeQuotes.filter(q => q.status === 'sent'))}
              active={activeTab === 'pending'}
              onClick={() => setActiveTab(activeTab === 'pending' ? 'all' : 'pending')}
            />
            <StatTile
              label="עומדות לפוג (עד 3 ימים, כל התקופות)"
              count={expiringQuotes.length}
              total={sumTotal(expiringQuotes)}
              tone="amber"
              active={activeTab === 'expiring'}
              onClick={() => setActiveTab(activeTab === 'expiring' ? 'all' : 'expiring')}
            />
            <StatTile
              label="פג תוקף (כל התקופות)"
              count={expiredQuotes.length}
              total={sumTotal(expiredQuotes)}
              tone="red"
              active={activeTab === 'expired'}
              onClick={() => setActiveTab(activeTab === 'expired' ? 'all' : 'expired')}
            />
          </div>

          {showPerRep && repTotals.length > 0 && (
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                פילוח לפי נציג <span className="text-muted-foreground/70">(לחץ לסינון)</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {repTotals.map((rep) => {
                  const isActive = repFilter.toLowerCase() === rep.email.toLowerCase();
                  return (
                    <button
                      key={rep.email}
                      type="button"
                      onClick={() => setRepFilter(isActive ? '' : rep.email)}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-start transition-colors ${
                        isActive
                          ? 'bg-primary/10 border border-primary ring-1 ring-primary'
                          : 'bg-muted/40 border border-border hover:bg-muted hover:border-primary/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{rep.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {rep.count} הצעות · פתוחות {rep.openCount}
                        </p>
                        {prevRange && (
                          <p className="text-xs text-muted-foreground/70">
                            תקופה קודמת: {rep.prevCount} · ₪{Math.round(rep.prevTotal).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-primary whitespace-nowrap ms-3">
                        ₪{Math.round(rep.total).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-col sm:flex-row sm:flex-wrap bg-card border h-auto gap-1 p-1.5 rounded-lg shadow-card">
          <TabsTrigger value="all" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">הכל ({rangeQuotes.length})</TabsTrigger>
          <TabsTrigger value="open" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">פתוחות ({openQuotes.length})</TabsTrigger>
          <TabsTrigger value="draft" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">טיוטות ({draftCount})</TabsTrigger>
          <TabsTrigger value="pending" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">ממתינות ({pendingCount})</TabsTrigger>
          <TabsTrigger value="expiring" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-amber-600">
            פג תוקף בקרוב ({expiringQuotes.length})
          </TabsTrigger>
          <TabsTrigger value="expired" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-red-600">
            פג תוקף ({expiredQuotes.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => { setFilters({ search: '', status: 'all' }); setRepFilter(''); }}
        searchPlaceholder="חפש לפי מספר הצעה, שם או טלפון..."
      />

      {isExpiryTab && (
        <p className="text-xs text-muted-foreground px-1">
          תצוגות התוקף מציגות את כל ההצעות לפי תאריך התוקף — ללא תלות בטווח התאריכים שנבחר.
        </p>
      )}

      {repFilter && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="text-foreground">
            מציג הצעות של{' '}
            <span className="font-semibold">
              {repTotals.find(r => r.email.toLowerCase() === repFilter.toLowerCase())?.name || repFilter}
            </span>
            {' '}({filteredQuotes.length})
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRepFilter('')}
            className="h-7 px-2 text-xs gap-1"
          >
            <X className="h-3.5 w-3.5" />
            נקה סינון
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredQuotes}
        isLoading={isLoading}
        emptyMessage="לא נמצאו הצעות מחיר"
        onRowClick={(row) => openQuote(row.id)}
      />
    </div>
  );
}
