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
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, filterOrdersForUser } from '@/lib/rbac';

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
      { value: 'not_started', label: 'טרם התחיל' },
      { value: 'in_production', label: 'בייצור' },
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

export default function Orders() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [activeTab, setActiveTab] = useState(['all', 'pending_payment', 'in_production', 'ready_delivery'].includes(initialTab) ? initialTab : 'all');
  const [filters, setFilters] = useState({ search: '', payment_status: 'all', production_status: 'all', delivery_status: 'all' });
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

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
    filteredOrders = filteredOrders.filter(o => ['materials_check', 'in_production', 'qc'].includes(o.production_status));
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
  const inProductionCount = scopedOrders.filter(o => ['materials_check', 'in_production', 'qc'].includes(o.production_status)).length;
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-col sm:flex-row bg-card border h-auto gap-1 p-1.5 rounded-lg shadow-card">
          <TabsTrigger value="all" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">כל ההזמנות ({scopedOrders.length})</TabsTrigger>
          <TabsTrigger value="pending_payment" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            ממתין לתשלום ({pendingPaymentCount})
          </TabsTrigger>
          <TabsTrigger value="in_production" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            בייצור ({inProductionCount})
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
