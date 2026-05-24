import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import KPICard from '@/components/shared/KPICard';
import { TrendingUp, Users, DollarSign, FileSpreadsheet } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import ImportCustomers from '@/components/customer/ImportCustomers';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, buildOrdersByCustomerId, canAccessSalesWorkspace, filterCustomersForUser, isAdmin } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

// Cap for the in-memory list. The table only ever shows the first
// PAGE_SIZE rows (the user scrolls within them) — we don't need to
// stream the whole 15k-row table just to render a list.
const PAGE_SIZE = 500;

// Max rows pulled for aggregate computation when a filter narrows the
// set. Any single rep is comfortably under this; a busy search term
// might exceed it, in which case the KPI uses the count + average.
const AGG_LIMIT = 5000;

// Build a Supabase filter object from the page's filter state. Shared
// between the row query, the count query, and the aggregate query so
// they always agree on what "matches the current cut" means.
function buildCustomerFilters({ search, rep }) {
  const filters = {};
  if (rep && rep !== 'all') {
    filters.$or = [{ account_manager: rep }, { rep2: rep }];
  }
  if (search && search.trim()) {
    const trimmed = search.trim();
    const term = { $regex: trimmed, $options: 'i' };
    // Use $and so this $or doesn't clobber the rep $or above.
    const searchOr = { $or: [{ full_name: term }, { phone: term }, { email: term }] };
    if (filters.$or) {
      filters.$and = [{ $or: filters.$or }, searchOr];
      delete filters.$or;
    } else {
      Object.assign(filters, searchOr);
    }
  }
  return filters;
}

export default function Customers() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [filterValues, setFilterValues] = useState({ search: '', rep: 'all' });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);
  const adminUser = isAdmin(effectiveUser);
  const hasFilter = filterValues.rep !== 'all' || Boolean(filterValues.search.trim());

  // Server-side filtered + paginated list. Replaces the previous
  // fetchAllList(Customer) which pulled all 15k+ rows in 31 sequential
  // batches with 150ms throttling and made the page take ~5+ seconds
  // before anything appeared.
  const queryFilters = useMemo(() => buildCustomerFilters(filterValues), [filterValues]);
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', filterValues, PAGE_SIZE],
    queryFn: () => base44.entities.Customer.filter(queryFilters, '-created_date', PAGE_SIZE),
    staleTime: 60000,
    enabled: canAccessSales,
    placeholderData: (prev) => prev,
  });

  // Exact match count for the active filter. Cheap (head:true, no row
  // transfer) and drives the "X מתוך Y" sub-label below.
  const { data: matchCount = null } = useQuery({
    queryKey: ['customers-count', filterValues],
    queryFn: () => base44.entities.Customer.count(queryFilters),
    staleTime: 60000,
    enabled: canAccessSales,
    placeholderData: (prev) => prev,
  });

  // Global stats (whole table). Used when no filter is active and as
  // the "of total" denominator when a filter is.
  const { data: stats = { total: 0, revenue: 0, orders: 0 } } = useQuery({
    queryKey: ['customers-stats'],
    staleTime: 60000,
    enabled: canAccessSales,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .from('customers_stats')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data || { total: 0, revenue: 0, orders: 0 };
    },
  });

  // Filtered KPI aggregates — only fetched when a filter is active.
  // Pulls up to AGG_LIMIT matching rows in one request and sums client-
  // side, since PostgREST aggregate selects aren't enabled project-wide.
  // For any single rep this is one round-trip of a few thousand rows
  // at most.
  const { data: filteredAgg = null } = useQuery({
    queryKey: ['customers-filtered-agg', filterValues],
    enabled: canAccessSales && hasFilter,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const rows = await base44.entities.Customer.filter(queryFilters, '-created_date', AGG_LIMIT);
      const revenue = rows.reduce((s, c) => s + (Number(c.total_revenue) || 0), 0);
      const orders = rows.reduce((s, c) => s + (Number(c.total_orders) || 0), 0);
      return { revenue, orders, sampleSize: rows.length };
    },
  });

  // Non-admin RBAC scoping needs lead + order ownership data. Admins
  // bypass `canViewCustomer` entirely, so we skip those fetches for
  // them — they were the other major drag on the page (a second
  // fetchAllList of leads).
  const { data: orders = [] } = useQuery({
    queryKey: ['orders-for-customers-rbac'],
    queryFn: () => base44.entities.Order.list(),
    staleTime: 60000,
    enabled: canAccessSales && !adminUser,
  });
  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-customers-rbac'],
    queryFn: () => fetchAllList(base44.entities.Lead, '-created_date'),
    staleTime: 60000,
    enabled: canAccessSales && !adminUser,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: canAccessSales,
  });

  // For admins this is a pass-through (canViewCustomer short-circuits
  // to true), so we don't pay for buildLeadsById / buildOrdersByCustomerId.
  const scopedCustomers = useMemo(() => {
    if (adminUser) return customers;
    return filterCustomersForUser(effectiveUser, customers, {
      leadsById: buildLeadsById(leads),
      ordersByCustomerId: buildOrdersByCustomerId(orders),
    });
  }, [adminUser, effectiveUser, customers, leads, orders]);

  const repOptions = users
    .filter((u) => u.role === 'user' || u.role === 'admin')
    .map((u) => ({ value: u.email, label: u.full_name || u.email }));
  const filterOptions = [
    { key: 'rep', label: 'נציג מטפל', allLabel: 'כל הנציגים', options: repOptions },
  ];

  // KPI numbers. When a filter is active we read the count from the
  // count() query (exact) and revenue/orders from the aggregate query.
  // When no filter is active we use the customers_stats view, which is
  // a single-row aggregate over the whole table.
  const globalCount = Number(stats.total) || 0;
  const totalCustomers = hasFilter
    ? (matchCount ?? scopedCustomers.length)
    : globalCount;
  const totalRevenue = hasFilter
    ? Number(filteredAgg?.revenue ?? 0)
    : (Number(stats.revenue) || 0);
  const totalOrders = hasFilter
    ? Number(filteredAgg?.orders ?? 0)
    : (Number(stats.orders) || 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const countSub = hasFilter && globalCount > 0
    ? `מתוך ${globalCount.toLocaleString()} סה״כ`
    : null;

  const columns = [
    {
      header: 'לקוח',
      render: (customer) => (
        <div>
          <p className="font-medium">{customer.full_name}</p>
          <p className="text-xs text-muted-foreground">{customer.phone}</p>
        </div>
      )
    },
    {
      header: 'אימייל',
      render: (customer) => customer.email || '-'
    },
    {
      header: 'הזמנות',
      render: (customer) => (
        <Badge variant="outline">{customer.total_orders || 0}</Badge>
      )
    },
    {
      header: 'סה"כ הכנסות',
      render: (customer) => (
        <span className="font-semibold">₪{(customer.total_revenue || 0).toLocaleString()}</span>
      )
    },
    {
      header: 'הזמנה ראשונה',
      render: (customer) => {
        if (!customer.first_order_date) return '-';
        try { return format(new Date(customer.first_order_date), 'dd/MM/yyyy'); } catch { return '-'; }
      }
    },
    {
      header: '',
      render: (customer) => (
        <div className="flex items-center gap-2">
          <Link to={createPageUrl('CustomerDetails') + `?id=${customer.id}`}>
            <Button variant="outline" size="sm">פרטים</Button>
          </Link>
        </div>
      )
    }
  ];

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSales) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת ללקוחות</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">לקוחות</h1>
          <p className="text-sm text-muted-foreground">ניהול מאגר לקוחות</p>
        </div>
        <Button onClick={() => setShowImportDialog(true)} variant="outline" className="w-full sm:w-auto">
          <FileSpreadsheet className="h-4 w-4 me-2" />
          ייבוא מ-Sheets
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <KPICard
          title={hasFilter ? 'לקוחות בסינון' : 'סה״כ לקוחות'}
          value={totalCustomers.toLocaleString()}
          subtitle={countSub}
          icon={Users}
          color="blue"
        />
        <KPICard title="סה״כ הכנסות" value={`₪${totalRevenue.toLocaleString()}`} icon={DollarSign} color="emerald" />
        <KPICard title="ממוצע הזמנה" value={`₪${avgOrderValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={TrendingUp} color="blue" />
      </div>

      <FilterBar
        filters={filterOptions}
        values={filterValues}
        onChange={(key, value) => setFilterValues(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilterValues({ search: '', rep: 'all' })}
      />

      <DataTable
        columns={columns}
        data={scopedCustomers}
        isLoading={isLoading}
        emptyMessage="לא נמצאו לקוחות"
        onRowClick={(row) => navigate(createPageUrl('CustomerDetails') + `?id=${row.id}`)}
      />

      {/* Import Customers Dialog */}
      <ImportCustomers isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} />
    </div>
  );
}
