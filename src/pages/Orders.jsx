import React, { useState, useMemo } from 'react';
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
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, LayoutDashboard } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canViewOrdersWorkspace, filterOrdersForUser, canAccessAdminOnly } from '@/lib/rbac';
import { getDateRange } from '@/utils/dateRange';
import Dashboard2DateRange from '@/components/dashboard2/Dashboard2DateRange';
import OrdersTab from '@/components/dashboard2/tabs/OrdersTab';
import useDashboard2Data from '@/components/dashboard2/useDashboard2Data';

const filterOptions = [
  {
    key: 'payment_status',
    label: 'תשלום',
    options: [
      { value: 'unpaid', label: 'לא שולם' },
      { value: 'deposit_paid', label: 'מקדמה' },
      { value: 'paid', label: 'שולם' },
    ]
  },
  {
    key: 'production_status',
    label: 'ייצור',
    options: [
      { value: 'not_started', label: 'בתור לייצור' },
      { value: 'in_production', label: 'ייצור' },
      { value: 'ready', label: 'מוכן' },
    ]
  },
  {
    key: 'delivery_status',
    label: 'משלוח',
    options: [
      { value: 'need_scheduling', label: 'לתאום' },
      { value: 'scheduled', label: 'מתואם' },
      { value: 'delivered', label: 'נמסר' },
    ]
  },
];

// Reverse-map an incoming start/end back to a preset key. The control
// center's "כניסה לדשבורד" drill lands here as /Orders?startDate&endDate,
// so this lets the range picker show "היום" / "החודש" instead of a raw
// date span. Falls back to 'custom' when the dates don't line up with a
// preset, and null when there are no usable dates.
function rangeKeyFromDates(startIso, endIso, now = new Date()) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const matches = (key) => {
    const r = getDateRange(key, null, null, now);
    return Math.abs(r.start.getTime() - start.getTime()) < 1000
      && Math.abs(r.end.getTime() - end.getTime()) < 1000;
  };
  return ['today', 'yesterday', 'week', 'month', '90days', 'year'].find(matches) || 'custom';
}

export default function Orders() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [activeTab, setActiveTab] = useState(['all', 'pending_payment', 'in_production', 'ready_delivery'].includes(initialTab) ? initialTab : 'all');
  const [filters, setFilters] = useState({ search: '', payment_status: 'all', production_status: 'all', delivery_status: 'all' });
  const canAccessSales = canViewOrdersWorkspace(effectiveUser);
  const isManager = canAccessAdminOnly(effectiveUser);

  // Managerial period snapshot (KPI cubes + revenue trend) mirroring the
  // control center's orders view, so the manager gets the same picture on
  // this page too. Initialises from the deep-link range when present,
  // otherwise defaults to today.
  const [rangeKey, setRangeKey] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return rangeKeyFromDates(sp.get('startDate'), sp.get('endDate')) || 'today';
  });
  const [customRange, setCustomRange] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get('startDate');
    const e = sp.get('endDate');
    return rangeKeyFromDates(s, e) === 'custom' && s && e
      ? { from: new Date(s), to: new Date(e) }
      : null;
  });
  const { start, end } = useMemo(
    () => getDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );
  const overviewDateRange = useMemo(() => ({ from: start, to: end }), [start, end]);
  const { data: snapshot = {}, isLoading: isSnapshotLoading } = useDashboard2Data({
    start,
    end,
    enabled: isManager,
    label: 'current',
  });
  const handlePresetChange = (key) => {
    setRangeKey(key);
    if (key !== 'custom') setCustomRange(null);
  };
  const handleCustomChange = (range) => {
    setCustomRange(range || null);
    if (range?.from && range?.to) setRangeKey('custom');
  };

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date'),
    staleTime: 60000,
    enabled: canAccessSales,
  });

  const scopedOrders = filterOrdersForUser(effectiveUser, orders);
  let filteredOrders = scopedOrders;

  if (activeTab === 'pending_payment') {
    filteredOrders = filteredOrders.filter(o => o.payment_status === 'unpaid' || o.payment_status === 'deposit_paid');
  } else if (activeTab === 'in_production') {
    filteredOrders = filteredOrders.filter(o => o.production_status === 'in_production');
  } else if (activeTab === 'ready_delivery') {
    filteredOrders = filteredOrders.filter(o => o.production_status === 'ready' && o.delivery_status !== 'delivered');
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredOrders = filteredOrders.filter(o =>
      o.order_number?.toLowerCase().includes(searchLower) ||
      o.customer_name?.toLowerCase().includes(searchLower) ||
      o.customer_phone?.includes(filters.search)
    );
  }
  if (filters.payment_status && filters.payment_status !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.payment_status === filters.payment_status);
  }
  if (filters.production_status && filters.production_status !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.production_status === filters.production_status);
  }
  if (filters.delivery_status && filters.delivery_status !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.delivery_status === filters.delivery_status);
  }

  const columns = [
    {
      header: 'מס\' הזמנה',
      accessor: 'order_number',
      render: (row) => (
        <span className="font-medium text-primary">#{row.order_number}</span>
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
      accessor: 'total',
      render: (row) => (
        <span className="font-semibold">₪{row.total?.toLocaleString()}</span>
      )
    },
    {
      header: 'תשלום',
      render: (row) => <StatusBadge status={row.payment_status} />
    },
    {
      header: 'ייצור',
      render: (row) => <StatusBadge status={row.production_status} />
    },
    {
      header: 'משלוח',
      render: (row) => <StatusBadge status={row.delivery_status} />
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
          type="order" 
          data={row}
          onView={() => navigate(createPageUrl('OrderDetails') + `?id=${row.id}`)}
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
        <p className="text-muted-foreground">אין לך הרשאה לגשת להזמנות</p>
      </div>
    );
  }

  const pendingPaymentCount = scopedOrders.filter(o => o.payment_status === 'unpaid' || o.payment_status === 'deposit_paid').length;
  const inProductionCount = scopedOrders.filter(o => o.production_status === 'in_production').length;
  const readyDeliveryCount = scopedOrders.filter(o => o.production_status === 'ready' && o.delivery_status !== 'delivered').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">הזמנות</h1>
          <p className="text-sm text-muted-foreground">ניהול הזמנות ומעקב אחרי תהליך המכירה</p>
        </div>
        <Link to={createPageUrl('NewOrder')}>
          <Button>
            <Plus className="h-4 w-4 me-2" />
            הזמנה חדשה
          </Button>
        </Link>
      </div>

      {isManager ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-primary" />
              תמונת מצב — הזמנות והכנסות
            </h2>
            <Dashboard2DateRange
              rangeKey={rangeKey}
              dateRange={overviewDateRange}
              onPresetChange={handlePresetChange}
              onCustomChange={handleCustomChange}
            />
          </div>
          {isSnapshotLoading && !snapshot.ordersCount ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <OrdersTab current={snapshot} showListLink={false} />
          )}
        </section>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-col sm:flex-row bg-card border h-auto gap-1 p-1.5 rounded-lg shadow-card">
          <TabsTrigger value="all" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">כל ההזמנות ({scopedOrders.length})</TabsTrigger>
          <TabsTrigger value="pending_payment" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            ממתין לתשלום ({pendingPaymentCount})
          </TabsTrigger>
          <TabsTrigger value="in_production" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            ייצור ({inProductionCount})
          </TabsTrigger>
          <TabsTrigger value="ready_delivery" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            מוכן למשלוח ({readyDeliveryCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', payment_status: 'all', production_status: 'all', delivery_status: 'all' })}
        searchPlaceholder="חפש לפי מספר הזמנה, שם או טלפון..."
      />

      <DataTable
        columns={columns}
        data={filteredOrders}
        isLoading={isLoading}
        emptyMessage="לא נמצאו הזמנות"
        onRowClick={(row) => navigate(createPageUrl('OrderDetails') + `?id=${row.id}`)}
      />
    </div>
  );
}
