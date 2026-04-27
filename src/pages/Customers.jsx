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
import { Crown, TrendingUp, Users, DollarSign, FileSpreadsheet } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import ImportCustomers from '@/components/customer/ImportCustomers';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, buildOrdersByCustomerId, canAccessSalesWorkspace, filterCustomersForUser } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

const VIP_FILTER = { key: 'vip', label: 'VIP', options: [
  { value: 'true', label: 'VIP' },
  { value: 'false', label: 'רגיל' }
]};

export default function Customers() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [filterValues, setFilterValues] = useState({ search: '', vip: 'all', rep: 'all' });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('-created_date'),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  // PostgREST silently caps .list() at 1000 rows, so the customers array
  // stops growing past 1000 and "סה״כ לקוחות" was rendering 1,000 even
  // when there are 15k+ rows. The customers_stats view aggregates every
  // KPI for the whole table in a single round-trip
  // (see supabase/migrations/.._customers_stats_view.sql).
  const { data: stats = { total: 0, vip: 0, revenue: 0, orders: 0 } } = useQuery({
    queryKey: ['customers-stats'],
    staleTime: 60000,
    enabled: canAccessSales,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .from('customers_stats')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data || { total: 0, vip: 0, revenue: 0, orders: 0 };
    },
  });
  const totalCustomers = Number(stats.total) || 0;
  const vipCustomers = Number(stats.vip) || 0;

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
    VIP_FILTER,
    { key: 'rep', label: 'נציג מטפל', options: repOptions },
  ];

  const filteredCustomers = scopedCustomers.filter(customer => {
    const searchLower = filterValues.search.toLowerCase();
    const matchSearch = !filterValues.search ||
      customer.full_name?.toLowerCase().includes(searchLower) ||
      customer.phone?.includes(filterValues.search) ||
      customer.email?.toLowerCase().includes(searchLower);

    const matchVip = filterValues.vip === 'all' ||
      (filterValues.vip === 'true' && customer.vip_status) ||
      (filterValues.vip === 'false' && !customer.vip_status);

    const matchRep = filterValues.rep === 'all' ||
      customer.account_manager === filterValues.rep ||
      customer.rep2 === filterValues.rep;

    return matchSearch && matchVip && matchRep;
  });

  // KPI numbers come from the customers_stats view above so they reflect
  // the entire table (not just the first page that the customers list
  // query returns).
  const totalRevenue = Number(stats.revenue) || 0;
  const totalOrders = Number(stats.orders) || 0;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const columns = [
    {
      header: 'לקוח',
      render: (customer) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{customer.full_name}</p>
            {customer.vip_status && <Crown className="h-4 w-4 text-yellow-500" />}
          </div>
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

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="סה״כ לקוחות" value={totalCustomers} icon={Users} color="blue" />
        <KPICard title="לקוחות VIP" value={vipCustomers} icon={Crown} color="amber" />
        <KPICard title="סה״כ הכנסות" value={`₪${totalRevenue.toLocaleString()}`} icon={DollarSign} color="emerald" />
        <KPICard title="ממוצע הזמנה" value={`₪${avgOrderValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`} icon={TrendingUp} color="blue" />
      </div>

      <FilterBar
        filters={filterOptions}
        values={filterValues}
        onChange={(key, value) => setFilterValues(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilterValues({ search: '', vip: 'all', rep: 'all' })}
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
