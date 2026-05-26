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

// Build the customers list query as a raw Supabase select. The
// generic entities.filter helper composed $or → PostgREST `.or()`
// in a way that intermittently returned 0 rows for valid rep
// matches (suspect: clauses with empty/null sibling columns +
// case-sensitive `.eq.`). Building the URL ourselves keeps the
// filter shape obvious and lets us use `.ilike.` for an exact but
// case-insensitive comparison on rep emails — defensive against
// data that's a mix of "izhak" / "Izhak" / "izhak " (trailing space
// from older imports).
function applyCustomerFilters(query, { search, rep }) {
  if (rep && rep !== 'all') {
    // PostgREST `.or()` lets us OR account_manager / rep2 in one
    // expression. Wrap the rep value in quotes so a `+` or `,` inside
    // the email doesn't break the comma-separated clause list.
    const safe = String(rep).replace(/[",()]/g, ''); // strip URL-special chars
    query = query.or(`account_manager.ilike.${safe},rep2.ilike.${safe}`);
  }
  if (search && search.trim()) {
    const term = search.trim().replace(/[",()]/g, '');
    query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
  }
  return query;
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
  // PostgREST pages with 150 ms inter-page throttling and made the
  // page take ~5 seconds before anything appeared.
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', filterValues, PAGE_SIZE],
    queryFn: async () => {
      let q = base44.supabase.from('customers').select('*').order('created_date', { ascending: false }).limit(PAGE_SIZE);
      q = applyCustomerFilters(q, filterValues);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    staleTime: 60000,
    enabled: canAccessSales,
    placeholderData: (prev) => prev,
  });

  // Exact match count for the active filter. Cheap (head:true, no row
  // transfer) and drives the "X מתוך Y" sub-label below.
  const { data: matchCount = null } = useQuery({
    queryKey: ['customers-count', filterValues],
    queryFn: async () => {
      let q = base44.supabase.from('customers').select('*', { count: 'exact', head: true });
      q = applyCustomerFilters(q, filterValues);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
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
      let q = base44.supabase
        .from('customers')
        .select('total_revenue, total_orders')
        .limit(AGG_LIMIT);
      q = applyCustomerFilters(q, filterValues);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
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

  // Lookup map for resolving rep emails → display names in the table.
  // Building it once per render is cheap (the users list is small) and
  // saves an .find() per row per rep.
  const repNameByEmail = useMemo(() => {
    const map = new Map();
    for (const u of users) {
      if (u?.email) map.set(u.email, u.full_name || u.email);
    }
    return map;
  }, [users]);
  const renderRepCell = (email, fallbackText = '—') => {
    if (!email) return <span className="text-muted-foreground">{fallbackText}</span>;
    return <span>{repNameByEmail.get(email) || email}</span>;
  };

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
      header: 'נציג אחראי',
      // Primary rep is `account_manager`; show the secondary rep
      // underneath when one exists so the column captures both without
      // adding a second column for what's usually empty.
      render: (customer) => (
        <div className="text-sm">
          <div>{renderRepCell(customer.account_manager, 'לא משויך')}</div>
          {customer.rep2 ? (
            <div className="text-xs text-muted-foreground">
              משני: {repNameByEmail.get(customer.rep2) || customer.rep2}
            </div>
          ) : null}
        </div>
      )
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
