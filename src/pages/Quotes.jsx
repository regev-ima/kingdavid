import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import QuickActions from '@/components/shared/QuickActions';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { format, differenceInDays } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canAccessSalesWorkspace, filterQuotesForUser } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

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

export default function Quotes() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [activeTab, setActiveTab] = useState(['all', 'pending', 'draft', 'expiring'].includes(initialTab) ? initialTab : 'all');
  const [filters, setFilters] = useState({ search: '', status: 'all' });
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

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

  const leadsById = buildLeadsById(leads);
  const scopedQuotes = filterQuotesForUser(effectiveUser, quotes, leadsById);
  let filteredQuotes = scopedQuotes;

  if (activeTab === 'pending') {
    filteredQuotes = filteredQuotes.filter(q => q.status === 'sent');
  } else if (activeTab === 'draft') {
    filteredQuotes = filteredQuotes.filter(q => q.status === 'draft');
  } else if (activeTab === 'expiring') {
    filteredQuotes = filteredQuotes.filter(q => {
      if (!q.valid_until || q.status !== 'sent') return false;
      const daysUntilExpiry = differenceInDays(new Date(q.valid_until), new Date());
      return daysUntilExpiry <= 3 && daysUntilExpiry >= 0;
    });
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredQuotes = filteredQuotes.filter(q =>
      q.quote_number?.toLowerCase().includes(searchLower) ||
      q.customer_name?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.status && filters.status !== 'all') {
    filteredQuotes = filteredQuotes.filter(q => q.status === filters.status);
  }

  const pendingCount = scopedQuotes.filter(q => q.status === 'sent').length;
  const draftCount = scopedQuotes.filter(q => q.status === 'draft').length;
  const expiringCount = scopedQuotes.filter(q => {
    if (!q.valid_until || q.status !== 'sent') return false;
    const daysUntilExpiry = differenceInDays(new Date(q.valid_until), new Date());
    return daysUntilExpiry <= 3 && daysUntilExpiry >= 0;
  }).length;

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
          <p className="font-medium">{row.customer_name}</p>
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
        const daysUntilExpiry = differenceInDays(new Date(row.valid_until), new Date());
        const isExpiring = daysUntilExpiry <= 3 && daysUntilExpiry >= 0;
        const isExpired = daysUntilExpiry < 0;
        return (
          <span className={`text-sm ${isExpired ? 'text-red-600' : isExpiring ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {format(new Date(row.valid_until), 'dd/MM/yyyy')}
            {isExpiring && <span className="block text-xs">נותרו {daysUntilExpiry} ימים</span>}
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
          onView={() => navigate(createPageUrl('QuoteDetails') + `?id=${row.id}`)}
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
        <Link to={createPageUrl('NewQuote')}>
          <Button>
            <Plus className="h-4 w-4 me-2" />
            הצעה חדשה
          </Button>
        </Link>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-col sm:flex-row bg-card border h-auto gap-1 p-1.5 rounded-lg shadow-card">
          <TabsTrigger value="all" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">הכל ({scopedQuotes.length})</TabsTrigger>
          <TabsTrigger value="draft" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">טיוטות ({draftCount})</TabsTrigger>
          <TabsTrigger value="pending" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">ממתינות ({pendingCount})</TabsTrigger>
          <TabsTrigger value="expiring" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-amber-600">
            פג תוקף בקרוב ({expiringCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', status: 'all' })}
        searchPlaceholder="חפש לפי מספר הצעה או שם לקוח..."
      />

      <DataTable
        columns={columns}
        data={filteredQuotes}
        isLoading={isLoading}
        emptyMessage="לא נמצאו הצעות מחיר"
        onRowClick={(row) => navigate(createPageUrl('QuoteDetails') + `?id=${row.id}`)}
      />
    </div>
  );
}
