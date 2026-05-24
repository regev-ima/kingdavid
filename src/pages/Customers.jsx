import React, { useState } from 'react';
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
import { buildLeadsById, buildOrdersByCustomerId, canAccessSalesWorkspace, filterCustomersForUser } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

export default function Customers() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [filterValues, setFilterValues] = useState({ search: '', rep: 'all' });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  // Pull the full customers list (paginated under the hood). The page
  // does client-side search + rep filtering, which was silently broken
  // when there were > 1000 rows: PostgREST's default .list() cap meant
  // a rep with customers in rows 1001+ was invisible to the filter and
  // the KPI tiles below couldn't reflect them. Matches how leads are
  // already loaded on the same page.
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => fetchAllList(base44.entities.Customer, '-created_date'),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  // customers_stats is the global aggregate over the *entire* table —
  // used as the initial-render fallback for the KPI strip so we don't
  // show "0 לקוחות" for the second it takes the full list to arrive.
  // Once `customers` is in, we recompute from the filtered slice below.
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

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list(),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-customers-access'],
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

  const scopedCustomers = filterCustomersForUser(effectiveUser, customers, {
    leadsById: buildLeadsById(leads),
    ordersByCustomerId: buildOrdersByCustomerId(orders),
  });

  const repOptions = users
    .filter((u) => u.role === 'user' || u.role === 'admin')
    .map((u) => ({ value: u.email, label: u.full_name || u.email }));
  const filterOptions = [
    { key: 'rep', label: 'נציג מטפל', allLabel: 'כל הנציגים', options: repOptions },
  ];

  const filteredCustomers = scopedCustomers.filter(customer => {
    const searchLower = filterValues.search.toLowerCase();
    const matchSearch = !filterValues.search ||
      customer.full_name?.toLowerCase().includes(searchLower) ||
      customer.phone?.includes(filterValues.search) ||
      customer.email?.toLowerCase().includes(searchLower);

    const matchRep = filterValues.rep === 'all' ||
      customer.account_manager === filterValues.rep ||
      customer.rep2 === filterValues.rep;

    return matchSearch && matchRep;
  });

  // KPI numbers track the *filtered* slice — so picking a rep instantly
  // updates "סה״כ לקוחות / הכנסות / ממוצע הזמנה" to that rep's customers.
  // While the customers fetch is still in flight we fall back to the
  // global customers_stats view so the strip never blanks out to zero.
  const hasFilter = filterValues.rep !== 'all' || Boolean(filterValues.search);
  const customersLoaded = customers.length > 0;
  const filteredRevenue = filteredCustomers.reduce((s, c) => s + (Number(c.total_revenue) || 0), 0);
  const filteredOrders = filteredCustomers.reduce((s, c) => s + (Number(c.total_orders) || 0), 0);

  const totalCustomers = customersLoaded
    ? filteredCustomers.length
    : (Number(stats.total) || 0);
  const totalRevenue = customersLoaded
    ? filteredRevenue
    : (Number(stats.revenue) || 0);
  const totalOrders = customersLoaded
    ? filteredOrders
    : (Number(stats.orders) || 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // "X מתוך Y" sub-label on the count tile while a filter is active —
  // gives back the context of how big the slice is vs the full table.
  const globalCount = Number(stats.total) || 0;
  const countSub = hasFilter && customersLoaded && globalCount > 0
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
        data={filteredCustomers}
        isLoading={isLoading}
        emptyMessage="לא נמצאו לקוחות"
        onRowClick={(row) => navigate(createPageUrl('CustomerDetails') + `?id=${row.id}`)}
      />

      {/* Import Customers Dialog */}
      <ImportCustomers isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} />
    </div>
  );
}
