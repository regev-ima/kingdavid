import React, { useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import KPICard from '@/components/shared/KPICard';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Factory as FactoryIcon, Package, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { format, differenceInDays } from '@/lib/safe-date-fns';

const filterOptions = [
  {
    key: 'production_status',
    label: 'סטטוס',
    options: [
      { value: 'not_started', label: 'טרם התחיל' },
      { value: 'materials_check', label: 'בדיקת חומרים' },
      { value: 'in_production', label: 'בייצור' },
      { value: 'qc', label: 'בקרת איכות' },
      { value: 'ready', label: 'מוכן' },
    ]
  },
];

export default function Factory() {
  const [activeTab, setActiveTab] = useState('queue');
  const [filters, setFilters] = useState({ search: '', production_status: 'all' });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date'),
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => base44.entities.InventoryItem.list(),
  });

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Order.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['orders']);
    },
  });

  // Only show paid orders in factory queue
  const factoryOrders = orders.filter(o => 
    o.payment_status === 'paid' || o.payment_status === 'deposit_paid'
  );

  let filteredOrders = factoryOrders;

  if (activeTab === 'queue') {
    filteredOrders = filteredOrders.filter(o => o.production_status === 'not_started');
  } else if (activeTab === 'in_production') {
    filteredOrders = filteredOrders.filter(o => ['materials_check', 'in_production', 'qc'].includes(o.production_status));
  } else if (activeTab === 'ready') {
    filteredOrders = filteredOrders.filter(o => o.production_status === 'ready');
  } else if (activeTab === 'delayed') {
    filteredOrders = filteredOrders.filter(o => {
      if (o.production_status === 'ready') return false;
      const daysSinceOrder = differenceInDays(new Date(), new Date(o.created_date));
      return daysSinceOrder > 7;
    });
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredOrders = filteredOrders.filter(o =>
      o.order_number?.toLowerCase().includes(searchLower) ||
      o.customer_name?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.production_status && filters.production_status !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.production_status === filters.production_status);
  }

  const queueCount = factoryOrders.filter(o => o.production_status === 'not_started').length;
  const inProductionCount = factoryOrders.filter(o => ['materials_check', 'in_production', 'qc'].includes(o.production_status)).length;
  const readyCount = factoryOrders.filter(o => o.production_status === 'ready').length;
  const lowStockCount = inventory.filter(i => i.qty_on_hand <= (i.min_threshold || 0)).length;

  const handleStatusChange = useCallback((orderId, newStatus) => {
    updateOrderMutation.mutate({
      id: orderId,
      data: { production_status: newStatus }
    });
  }, [updateOrderMutation]);

  const columns = useMemo(() => [
    {
      header: 'מס\' הזמנה',
      render: (row) => (
        <span className="font-medium text-primary">#{row.order_number}</span>
      )
    },
    {
      header: 'לקוח',
      render: (row) => (
        <p className="font-medium">{row.customer_name}</p>
      )
    },
    {
      header: 'פריטים',
      render: (row) => (
        <div className="max-w-md space-y-2">
          {row.items?.slice(0, 2).map((item, idx) => (
            <div key={idx} className="text-sm">
              <p className="font-medium">
                {item.quantity}x {item.name}
              </p>
              {item.length_cm && item.width_cm && (
                <p className="text-xs text-primary">
                  {item.length_cm}×{item.width_cm}{item.height_cm ? `×${item.height_cm}` : ''} ס"מ
                </p>
              )}
              {item.selected_addons?.length > 0 && (
                <p className="text-xs text-primary">
                  תוספות: {item.selected_addons.map(a => a.name).join(', ')}
                </p>
              )}
            </div>
          ))}
          {row.items?.length > 2 && (
            <p className="text-xs text-muted-foreground">+{row.items.length - 2} עוד</p>
          )}
        </div>
      )
    },
    {
      header: 'תאריך הזמנה',
      render: (row) => {
        const days = differenceInDays(new Date(), new Date(row.created_date));
        return (
          <div>
            <p className="text-sm">{format(new Date(row.created_date), 'dd/MM/yyyy')}</p>
            <p className={`text-xs ${days > 7 ? 'text-red-500' : 'text-muted-foreground'}`}>
              לפני {days} ימים
            </p>
          </div>
        );
      }
    },
    {
      header: 'סטטוס ייצור',
      render: (row) => (
        <Select
          value={row.production_status}
          onValueChange={(value) => handleStatusChange(row.id, value)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_started">טרם התחיל</SelectItem>
            <SelectItem value="materials_check">בדיקת חומרים</SelectItem>
            <SelectItem value="in_production">בייצור</SelectItem>
            <SelectItem value="qc">בקרת איכות</SelectItem>
            <SelectItem value="ready">מוכן</SelectItem>
          </SelectContent>
        </Select>
      )
    },
    {
      header: 'הערות',
      render: (row) => (
        <p className="text-sm text-muted-foreground max-w-xs truncate">
          {row.notes_factory || '-'}
        </p>
      )
    },
  ], [handleStatusChange]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">מפעל</h1>
        <p className="text-muted-foreground">ניהול ייצור ותור עבודה</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="בתור לייצור"
          value={queueCount}
          icon={Clock}
          color="amber"
          onClick={() => setActiveTab('queue')}
        />
        <KPICard
          title="בייצור"
          value={inProductionCount}
          icon={FactoryIcon}
          color="indigo"
          onClick={() => setActiveTab('in_production')}
        />
        <KPICard
          title="מוכן למשלוח"
          value={readyCount}
          icon={CheckCircle}
          color="emerald"
          onClick={() => setActiveTab('ready')}
        />
        <KPICard
          title="חוסרים במלאי"
          value={lowStockCount}
          icon={AlertTriangle}
          color="red"
          onClick={() => navigate(createPageUrl('Inventory'))}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border w-full h-auto flex-wrap justify-start gap-1.5 p-1.5">
          <TabsTrigger
            value="all"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-bold"
          >
            הכל ({factoryOrders.length})
          </TabsTrigger>
          <TabsTrigger
            value="queue"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-bold"
          >
            תור ({queueCount})
          </TabsTrigger>
          <TabsTrigger
            value="in_production"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-bold"
          >
            בייצור ({inProductionCount})
          </TabsTrigger>
          <TabsTrigger
            value="ready"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-bold"
          >
            מוכן ({readyCount})
          </TabsTrigger>
          <TabsTrigger
            value="delayed"
            className="text-red-600 data-[state=active]:bg-red-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:font-bold"
          >
            באיחור
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', production_status: 'all' })}
        searchPlaceholder="חפש לפי מספר הזמנה או שם לקוח..."
      />

      <DataTable
        columns={columns}
        data={filteredOrders}
        isLoading={isLoading}
        emptyMessage="לא נמצאו הזמנות לייצור"
        onRowClick={(row) => navigate(createPageUrl('OrderDetails') + `?id=${row.id}`)}
      />
    </div>
  );
}