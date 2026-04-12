import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import KPICard from '@/components/shared/KPICard';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Headphones, AlertTriangle, Clock, CheckCircle } from "lucide-react";
import { format } from 'date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSupportWorkspace, filterTicketsForUser } from '@/lib/rbac';

const categoryLabels = {
  delivery: 'משלוח',
  quality: 'איכות',
  return: 'החזרה',
  trial: 'ניסיון 30 יום',
  billing: 'חיוב',
  warranty: 'אחריות',
  other: 'אחר'
};

const filterOptions = [
  {
    key: 'category',
    label: 'קטגוריה',
    options: Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))
  },
  {
    key: 'priority',
    label: 'עדיפות',
    options: [
      { value: 'low', label: 'נמוך' },
      { value: 'medium', label: 'בינוני' },
      { value: 'high', label: 'גבוה' },
      { value: 'urgent', label: 'דחוף' },
    ]
  },
  {
    key: 'status',
    label: 'סטטוס',
    options: [
      { value: 'open', label: 'פתוח' },
      { value: 'in_progress', label: 'בטיפול' },
      { value: 'waiting_customer', label: 'ממתין ללקוח' },
      { value: 'resolved', label: 'נפתר' },
      { value: 'closed', label: 'סגור' },
    ]
  },
];

export default function Support() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [activeTab, setActiveTab] = useState('open');
  const [filters, setFilters] = useState({ search: '', category: 'all', priority: 'all', status: 'all' });
  const canAccessSupport = canAccessSupportWorkspace(effectiveUser);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => base44.entities.SupportTicket.list('-created_date'),
    staleTime: 60000,
    enabled: canAccessSupport,
  });

  const scopedTickets = filterTicketsForUser(effectiveUser, tickets);
  let filteredTickets = scopedTickets;

  if (activeTab === 'open') {
    filteredTickets = filteredTickets.filter(t => !['resolved', 'closed'].includes(t.status));
  } else if (activeTab === 'overdue') {
    filteredTickets = filteredTickets.filter(t => {
      if (!t.sla_due_date) return false;
      return new Date(t.sla_due_date) < new Date() && !['resolved', 'closed'].includes(t.status);
    });
  } else if (activeTab === 'trial') {
    filteredTickets = filteredTickets.filter(t => t.category === 'trial');
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredTickets = filteredTickets.filter(t =>
      t.ticket_number?.toLowerCase().includes(searchLower) ||
      t.customer_name?.toLowerCase().includes(searchLower) ||
      t.customer_phone?.includes(filters.search) ||
      t.subject?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.category && filters.category !== 'all') {
    filteredTickets = filteredTickets.filter(t => t.category === filters.category);
  }
  if (filters.priority && filters.priority !== 'all') {
    filteredTickets = filteredTickets.filter(t => t.priority === filters.priority);
  }
  if (filters.status && filters.status !== 'all') {
    filteredTickets = filteredTickets.filter(t => t.status === filters.status);
  }

  const openTickets = scopedTickets.filter(t => !['resolved', 'closed'].includes(t.status));
  const overdueTickets = scopedTickets.filter(t => {
    if (!t.sla_due_date) return false;
    return new Date(t.sla_due_date) < new Date() && !['resolved', 'closed'].includes(t.status);
  });
  const urgentTickets = scopedTickets.filter(t => t.priority === 'urgent' && !['resolved', 'closed'].includes(t.status));
  const resolvedToday = scopedTickets.filter(t => {
    if (t.status !== 'resolved' && t.status !== 'closed') return false;
    const updated = new Date(t.updated_date);
    const today = new Date();
    return updated.toDateString() === today.toDateString();
  });

  const columns = [
    {
      header: 'מס\' קריאה',
      render: (row) => (
        <span className="font-medium text-primary">#{row.ticket_number}</span>
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
      header: 'נושא',
      render: (row) => (
        <div className="max-w-xs">
          <p className="font-medium truncate">{row.subject}</p>
          <span className="text-xs text-muted-foreground">{categoryLabels[row.category]}</span>
        </div>
      )
    },
    {
      header: 'עדיפות',
      render: (row) => <StatusBadge status={row.priority} />
    },
    {
      header: 'סטטוס',
      render: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'SLA',
      render: (row) => {
        if (!row.sla_due_date) return '-';
        const due = new Date(row.sla_due_date);
        const isOverdue = due < new Date() && !['resolved', 'closed'].includes(row.status);
        return (
          <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
            {format(due, 'dd/MM HH:mm')}
          </span>
        );
      }
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

  if (!canAccessSupport) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת לשירות לקוחות</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">שירות לקוחות</h1>
          <p className="text-muted-foreground">ניהול קריאות שירות ותמיכה</p>
        </div>
        <Link to={createPageUrl('NewTicket')}>
          <Button>
            <Plus className="h-4 w-4 me-2" />
            קריאה חדשה
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="קריאות פתוחות"
          value={openTickets.length}
          icon={Headphones}
          color="blue"
        />
        <KPICard
          title="חריגת SLA"
          value={overdueTickets.length}
          icon={AlertTriangle}
          color="red"
        />
        <KPICard
          title="דחופים"
          value={urgentTickets.length}
          icon={Clock}
          color="amber"
        />
        <KPICard
          title="נפתרו היום"
          value={resolvedToday.length}
          icon={CheckCircle}
          color="emerald"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border">
          <TabsTrigger value="all">הכל ({scopedTickets.length})</TabsTrigger>
          <TabsTrigger value="open">פתוחות ({openTickets.length})</TabsTrigger>
          <TabsTrigger value="overdue" className="text-red-600">
            חריגת SLA ({overdueTickets.length})
          </TabsTrigger>
          <TabsTrigger value="trial">ניסיון 30 יום</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', category: 'all', priority: 'all', status: 'all' })}
        searchPlaceholder="חפש לפי מספר קריאה, שם או נושא..."
      />

      <DataTable
        columns={columns}
        data={filteredTickets}
        isLoading={isLoading}
        emptyMessage="לא נמצאו קריאות שירות"
        onRowClick={(row) => navigate(createPageUrl('TicketDetails') + `?id=${row.id}`)}
      />
    </div>
  );
}
