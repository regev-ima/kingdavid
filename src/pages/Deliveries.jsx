import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import KPICard from '@/components/shared/KPICard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Truck, Clock, CheckCircle, AlertTriangle, MapPin } from "lucide-react";
import { format } from 'date-fns';

const timeWindowLabels = {
  morning: 'בוקר (08:00-12:00)',
  afternoon: 'צהריים (12:00-16:00)',
  evening: 'ערב (16:00-20:00)',
  all_day: 'כל היום'
};

const filterOptions = [
  {
    key: 'status',
    label: 'סטטוס',
    options: [
      { value: 'need_scheduling', label: 'לתאום' },
      { value: 'scheduled', label: 'מתואם' },
      { value: 'dispatched', label: 'יצא לדרך' },
      { value: 'in_transit', label: 'בדרך' },
      { value: 'delivered', label: 'נמסר' },
      { value: 'failed', label: 'נכשל' },
    ]
  },
  {
    key: 'time_window',
    label: 'חלון זמן',
    options: [
      { value: 'morning', label: 'בוקר' },
      { value: 'afternoon', label: 'צהריים' },
      { value: 'evening', label: 'ערב' },
    ]
  },
];

export default function Deliveries() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [filters, setFilters] = useState({ search: '', status: 'all', time_window: 'all' });

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['shipments'],
    queryFn: () => base44.entities.DeliveryShipment.list('-created_date'),
    staleTime: 60000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list(),
    staleTime: 60000,
  });

  let filteredShipments = shipments;

  if (activeTab === 'need_scheduling') {
    filteredShipments = filteredShipments.filter(s => s.status === 'need_scheduling');
  } else if (activeTab === 'scheduled') {
    filteredShipments = filteredShipments.filter(s => s.status === 'scheduled');
  } else if (activeTab === 'today') {
    const today = format(new Date(), 'yyyy-MM-dd');
    filteredShipments = filteredShipments.filter(s => s.scheduled_date === today);
  } else if (activeTab === 'in_transit') {
    filteredShipments = filteredShipments.filter(s => ['dispatched', 'in_transit'].includes(s.status));
  } else if (activeTab === 'failed') {
    filteredShipments = filteredShipments.filter(s => s.status === 'failed');
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredShipments = filteredShipments.filter(s =>
      s.shipment_number?.toLowerCase().includes(searchLower) ||
      s.customer_name?.toLowerCase().includes(searchLower) ||
      s.customer_phone?.includes(filters.search) ||
      s.city?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.status && filters.status !== 'all') {
    filteredShipments = filteredShipments.filter(s => s.status === filters.status);
  }
  if (filters.time_window && filters.time_window !== 'all') {
    filteredShipments = filteredShipments.filter(s => s.time_window === filters.time_window);
  }

  const needScheduling = shipments.filter(s => s.status === 'need_scheduling').length;
  const scheduled = shipments.filter(s => s.status === 'scheduled').length;
  const todayDeliveries = shipments.filter(s => s.scheduled_date === format(new Date(), 'yyyy-MM-dd')).length;
  const inTransit = shipments.filter(s => ['dispatched', 'in_transit'].includes(s.status)).length;
  const failedDeliveries = shipments.filter(s => s.status === 'failed').length;

  const columns = [
    {
      header: 'מס\' משלוח',
      render: (row) => (
        <span className="font-medium text-primary">#{row.shipment_number}</span>
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
      header: 'כתובת',
      render: (row) => (
        <div className="max-w-xs">
          <p className="font-medium flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {row.city}
          </p>
          <p className="text-sm text-muted-foreground truncate">{row.address}</p>
          {row.floor && (
            <p className="text-xs text-muted-foreground/70">
              קומה {row.floor} {row.has_elevator ? '(יש מעלית)' : '(אין מעלית)'}
            </p>
          )}
        </div>
      )
    },
    {
      header: 'תאריך מתוכנן',
      render: (row) => (
        <div>
          {row.scheduled_date ? (
            <>
              <p className="font-medium">{format(new Date(row.scheduled_date), 'dd/MM/yyyy')}</p>
              <p className="text-xs text-muted-foreground">{timeWindowLabels[row.time_window] || row.time_window}</p>
            </>
          ) : (
            <span className="text-amber-600">לא תואם</span>
          )}
        </div>
      )
    },

    {
      header: 'סטטוס',
      render: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'מוביל',
      render: (row) => (
        <span className="text-sm">{row.carrier || '-'}</span>
      )
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">משלוחים ולוגיסטיקה</h1>
        <p className="text-muted-foreground">ניהול משלוחים, מסלולי חלוקה ותיאומים</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="לתאום"
          value={needScheduling}
          icon={Clock}
          color="amber"
          onClick={() => setActiveTab('need_scheduling')}
        />
        <KPICard
          title="מתוזמן"
          value={scheduled}
          icon={CheckCircle}
          color="green"
          onClick={() => setActiveTab('scheduled')}
        />
        <KPICard
          title="משלוחים היום"
          value={todayDeliveries}
          icon={Truck}
          color="indigo"
          onClick={() => setActiveTab('today')}
        />
        <KPICard
          title="בדרך"
          value={inTransit}
          icon={Truck}
          color="blue"
          onClick={() => setActiveTab('in_transit')}
        />
        <KPICard
          title="נכשלו"
          value={failedDeliveries}
          icon={AlertTriangle}
          color="red"
          onClick={() => setActiveTab('failed')}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border w-full h-auto flex-wrap justify-start">
          <TabsTrigger value="all">הכל ({shipments.length})</TabsTrigger>
          <TabsTrigger value="need_scheduling">
            לתאום ({needScheduling})
          </TabsTrigger>
          <TabsTrigger value="scheduled">מתוזמן ({scheduled})</TabsTrigger>
          <TabsTrigger value="today">היום ({todayDeliveries})</TabsTrigger>
          <TabsTrigger value="in_transit">בדרך ({inTransit})</TabsTrigger>
          <TabsTrigger value="failed" className="text-red-600">
            נכשלו ({failedDeliveries})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', status: 'all', time_window: 'all' })}
        searchPlaceholder="חפש לפי מספר משלוח, שם או עיר..."
      />

      <DataTable
        columns={columns}
        data={filteredShipments}
        isLoading={isLoading}
        emptyMessage="לא נמצאו משלוחים"
        onRowClick={(row) => navigate(createPageUrl('ShipmentDetails') + `?id=${row.id}`)}
      />
    </div>
  );
}