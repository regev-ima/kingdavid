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
import { Factory as FactoryIcon, Package, Clock, CheckCircle, AlertTriangle, List, LayoutGrid } from "lucide-react";
import { format, differenceInDays } from '@/lib/safe-date-fns';
import FactoryKanban from '@/components/factory/FactoryKanban';
import FactoryCalendarBoard from '@/components/factory/FactoryCalendarBoard';

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
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'kanban' | 'list'
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

  // Map of order_id → has-shipment, used by the kanban cards to show
  // a "משלוח פתוח" badge after auto-create. Cheap one-shot fetch; we
  // refresh it via the queryKey on each kanban move.
  const { data: shipmentsByOrderId = {} } = useQuery({
    queryKey: ['factory-shipments'],
    queryFn: async () => {
      const list = await base44.entities.DeliveryShipment.list();
      const map = {};
      for (const s of list || []) {
        if (s.order_id) map[s.order_id] = s;
      }
      return map;
    },
    enabled: viewMode === 'kanban' || viewMode === 'calendar',
    staleTime: 60_000,
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">מפעל</h1>
          <p className="text-muted-foreground">ניהול ייצור ותור עבודה</p>
        </div>
        <div className="inline-flex h-9 rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 rounded-md px-3 transition-colors ${
              viewMode === 'calendar' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> קלנדר
          </button>
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={`flex items-center gap-1.5 rounded-md px-3 transition-colors ${
              viewMode === 'kanban' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> קנבן
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 rounded-md px-3 transition-colors ${
              viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="h-3.5 w-3.5" /> רשימה
          </button>
        </div>
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

      {viewMode === 'calendar' || viewMode === 'kanban' ? (
        viewMode === 'calendar' ? (
          <FactoryCalendarBoard
            // Same handoff rule: hide orders whose shipment has moved past
            // need_scheduling. The calendar is the factory's plan, not a
            // logistics archive.
            orders={factoryOrders.filter((o) => {
              const ship = shipmentsByOrderId[o.id];
              if (!ship) return true;
              return !ship.status || ship.status === 'need_scheduling';
            })}
            shipmentsByOrderId={shipmentsByOrderId}
          />
        ) : (
          <FactoryKanban
            orders={factoryOrders.filter((o) => {
              const ship = shipmentsByOrderId[o.id];
              if (!ship) return true;
              return !ship.status || ship.status === 'need_scheduling';
            })}
            shipmentsByOrderId={shipmentsByOrderId}
          />
        )
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}