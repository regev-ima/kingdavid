import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import KPICard from '@/components/shared/KPICard';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RotateCcw, Clock, CheckCircle, Truck } from "lucide-react";
import { format } from 'date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessReturnsWorkspace, filterReturnsForUser } from '@/lib/rbac';

const reasonLabels = {
  trial_period: 'ניסיון 30 יום',
  defect: 'פגם במוצר',
  wrong_product: 'מוצר שגוי',
  changed_mind: 'התחרטות',
  size_issue: 'בעיית מידה',
  other: 'אחר'
};

const filterOptions = [
  {
    key: 'reason',
    label: 'סיבה',
    options: Object.entries(reasonLabels).map(([value, label]) => ({ value, label }))
  },
  {
    key: 'status',
    label: 'סטטוס',
    options: [
      { value: 'requested', label: 'התקבלה בקשה' },
      { value: 'eligible', label: 'זכאי' },
      { value: 'pickup_scheduled', label: 'איסוף מתואם' },
      { value: 'received', label: 'התקבל' },
      { value: 'inspected', label: 'נבדק' },
      { value: 'refund_approved', label: 'זיכוי מאושר' },
      { value: 'refund_paid', label: 'זיכוי שולם' },
      { value: 'closed', label: 'סגור' },
    ]
  },
];

export default function Returns() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [activeTab, setActiveTab] = useState('all');
  const [filters, setFilters] = useState({ search: '', reason: 'all', status: 'all' });
  const canAccessReturns = canAccessReturnsWorkspace(effectiveUser);

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: () => base44.entities.ReturnRequest.list('-created_date'),
    staleTime: 60000,
    enabled: canAccessReturns,
  });

  const scopedReturns = filterReturnsForUser(effectiveUser, returns);
  let filteredReturns = scopedReturns;

  if (activeTab === 'pending') {
    filteredReturns = filteredReturns.filter(r => ['requested', 'eligible'].includes(r.status));
  } else if (activeTab === 'pickup') {
    filteredReturns = filteredReturns.filter(r => r.pickup_status === 'scheduled' || r.status === 'pickup_scheduled');
  } else if (activeTab === 'inspection') {
    filteredReturns = filteredReturns.filter(r => r.status === 'received' || r.status === 'inspected');
  } else if (activeTab === 'refund') {
    filteredReturns = filteredReturns.filter(r => r.status === 'refund_approved');
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredReturns = filteredReturns.filter(r =>
      r.return_number?.toLowerCase().includes(searchLower) ||
      r.customer_name?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.reason && filters.reason !== 'all') {
    filteredReturns = filteredReturns.filter(r => r.reason === filters.reason);
  }
  if (filters.status && filters.status !== 'all') {
    filteredReturns = filteredReturns.filter(r => r.status === filters.status);
  }

  const pendingCount = scopedReturns.filter(r => ['requested', 'eligible'].includes(r.status)).length;
  const pickupCount = scopedReturns.filter(r => r.pickup_status === 'scheduled' || r.status === 'pickup_scheduled').length;
  const inspectionCount = scopedReturns.filter(r => r.status === 'received' || r.status === 'inspected').length;
  const refundCount = scopedReturns.filter(r => r.status === 'refund_approved').length;

  const columns = [
    {
      header: 'מס\' החזרה',
      render: (row) => (
        <span className="font-medium text-primary">#{row.return_number}</span>
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
      header: 'סיבה',
      render: (row) => (
        <div>
          <p className="font-medium">{reasonLabels[row.reason]}</p>
          {row.reason_details && (
            <p className="text-xs text-muted-foreground truncate max-w-[150px]">{row.reason_details}</p>
          )}
        </div>
      )
    },
    {
      header: 'סטטוס',
      render: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'סכום זיכוי',
      render: (row) => (
        row.refund_amount ? (
          <span className="font-semibold">₪{row.refund_amount.toLocaleString()}</span>
        ) : '-'
      )
    },
    {
      header: 'תאריך',
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {format(new Date(row.created_date), 'dd/MM/yyyy')}
        </span>
      )
    },
  ];

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessReturns) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת למסך החזרות</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">החזרות</h1>
          <p className="text-muted-foreground">ניהול בקשות החזרה וזיכויים</p>
        </div>
        <Link to={createPageUrl('NewReturn')} className="w-full sm:w-auto">
          <Button className="bg-primary hover:bg-primary/90 w-full sm:w-auto">
            <Plus className="h-4 w-4 me-2" />
            בקשת החזרה
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="ממתינות לבדיקה"
          value={pendingCount}
          icon={Clock}
          color="amber"
          onClick={() => setActiveTab('pending')}
        />
        <KPICard
          title="לאיסוף"
          value={pickupCount}
          icon={Truck}
          color="indigo"
          onClick={() => setActiveTab('pickup')}
        />
        <KPICard
          title="בבדיקה"
          value={inspectionCount}
          icon={RotateCcw}
          color="purple"
          onClick={() => setActiveTab('inspection')}
        />
        <KPICard
          title="לזיכוי"
          value={refundCount}
          icon={CheckCircle}
          color="emerald"
          onClick={() => setActiveTab('refund')}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border w-full h-auto flex flex-col sm:flex-row">
          <TabsTrigger value="all" className="w-full sm:w-auto">הכל ({scopedReturns.length})</TabsTrigger>
          <TabsTrigger value="pending" className="w-full sm:w-auto">ממתינות ({pendingCount})</TabsTrigger>
          <TabsTrigger value="pickup" className="w-full sm:w-auto">לאיסוף ({pickupCount})</TabsTrigger>
          <TabsTrigger value="inspection" className="w-full sm:w-auto">בבדיקה ({inspectionCount})</TabsTrigger>
          <TabsTrigger value="refund" className="w-full sm:w-auto">לזיכוי ({refundCount})</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', reason: 'all', status: 'all' })}
        searchPlaceholder="חפש לפי מספר החזרה או שם לקוח..."
      />

      <DataTable
        columns={columns}
        data={filteredReturns}
        isLoading={isLoading}
        emptyMessage="לא נמצאו בקשות החזרה"
        onRowClick={(row) => navigate(createPageUrl('ReturnDetails') + `?id=${row.id}`)}
      />
    </div>
  );
}
