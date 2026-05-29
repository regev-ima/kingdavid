import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import KPICard from '@/components/shared/KPICard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Headphones, AlertTriangle, CheckCircle, MessageSquare, FileSpreadsheet, Image as ImageIcon, UserPlus } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessServiceWorkspace, canManageService, isAdmin, isFactoryUser, matchesUserIdentifier } from '@/lib/rbac';
import { getRepDisplayName } from '@/lib/repDisplay';
import {
  REQUEST_TYPE_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_STATUS_CHIP,
  SOURCE_LABELS,
  SOURCE_CHIP,
  PRIORITY_LABELS,
  OPEN_SERVICE_STATUSES,
} from '@/constants/serviceOptions';
import OpenServiceTicketDialog from '@/components/service/OpenServiceTicketDialog';
import SendServiceSmsDialog from '@/components/service/SendServiceSmsDialog';
import ImportServiceData from '@/components/service/ImportServiceData';

const PRIORITY_CHIP = {
  urgent: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  high: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

const isOpen = (t) => OPEN_SERVICE_STATUSES.includes(t.status) || (!['resolved', 'closed'].includes(t.status));
const isOverdue = (t) => t.sla_due_date && new Date(t.sla_due_date) < new Date() && !['resolved', 'closed'].includes(t.status);

export default function ServiceCenter() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const canAccess = canAccessServiceWorkspace(effectiveUser);
  const canManage = canManageService(effectiveUser);

  const [activeTab, setActiveTab] = useState('open');
  const [filters, setFilters] = useState({ search: '', request_type: 'all', status: 'all', source: 'all' });
  const [showOpenDialog, setShowOpenDialog] = useState(false);
  const [showSmsDialog, setShowSmsDialog] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['service-tickets'],
    queryFn: () => base44.entities.SupportTicket.list('-created_date'),
    staleTime: 60000,
    enabled: canAccess,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: canAccess,
  });

  // Scope: managers/admin/factory see everything; a plain rep sees tickets
  // assigned to them or that they opened.
  const scoped = useMemo(() => {
    if (canManage || isAdmin(effectiveUser) || isFactoryUser(effectiveUser)) return tickets;
    return tickets.filter((t) => matchesUserIdentifier(effectiveUser, t.assigned_to, t.created_by_rep));
  }, [tickets, effectiveUser, canManage]);

  const counts = useMemo(() => ({
    open: scoped.filter(isOpen).length,
    overdue: scoped.filter(isOverdue).length,
    customer: scoped.filter((t) => t.opened_by_customer || t.source === 'customer_self').length,
    pending: scoped.filter((t) => t.public_status === 'pending').length,
    resolvedToday: scoped.filter((t) => ['resolved', 'closed'].includes(t.status) && t.updated_date && new Date(t.updated_date).toDateString() === new Date().toDateString()).length,
  }), [scoped]);

  const filtered = useMemo(() => {
    let list = scoped;
    if (activeTab === 'open') list = list.filter(isOpen);
    else if (activeTab === 'customer') list = list.filter((t) => t.opened_by_customer || t.source === 'customer_self');
    else if (activeTab === 'overdue') list = list.filter(isOverdue);
    else if (activeTab === 'imported') list = list.filter((t) => t.source === 'imported');

    const s = filters.search.trim().toLowerCase();
    if (s) {
      list = list.filter((t) =>
        t.ticket_number?.toLowerCase().includes(s) ||
        t.customer_name?.toLowerCase().includes(s) ||
        t.customer_phone?.includes(filters.search) ||
        t.subject?.toLowerCase().includes(s),
      );
    }
    if (filters.request_type !== 'all') list = list.filter((t) => t.request_type === filters.request_type);
    if (filters.status !== 'all') list = list.filter((t) => t.status === filters.status);
    if (filters.source !== 'all') list = list.filter((t) => (t.source || 'agent_manual') === filters.source);
    return list;
  }, [scoped, activeTab, filters]);

  const filterOptions = [
    { key: 'request_type', label: 'סוג פנייה', options: Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
    { key: 'status', label: 'סטטוס', options: Object.entries(SERVICE_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
    { key: 'source', label: 'מקור', options: Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })) },
  ];

  const columns = [
    {
      header: 'מס׳ פנייה',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-primary">#{row.ticket_number}</span>
          {row.photo_urls?.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${row.photo_urls.length} תמונות`}>
              <ImageIcon className="h-3 w-3" />{row.photo_urls.length}
            </span>
          )}
        </div>
      ),
    },
    {
      header: 'לקוח',
      render: (row) => (
        <div>
          <p className="font-medium">{row.customer_name || '—'}</p>
          <p className="text-sm text-muted-foreground" dir="ltr">{row.customer_phone}</p>
        </div>
      ),
    },
    {
      header: 'נושא',
      render: (row) => (
        <div className="max-w-xs">
          <p className="font-medium truncate">{row.subject}</p>
          {row.request_type && <span className="text-xs text-muted-foreground">{REQUEST_TYPE_LABELS[row.request_type] || ''}</span>}
        </div>
      ),
    },
    {
      header: 'מקור',
      render: (row) => {
        const src = row.source || 'agent_manual';
        return <span className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_CHIP[src] || ''}`}>{SOURCE_LABELS[src] || src}</span>;
      },
    },
    {
      header: 'עדיפות',
      render: (row) => <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_CHIP[row.priority] || ''}`}>{PRIORITY_LABELS[row.priority] || row.priority}</span>,
    },
    {
      header: 'סטטוס',
      render: (row) => {
        if (row.public_status === 'pending') {
          return <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 ring-1 ring-violet-200">ממתין למילוי הלקוח</span>;
        }
        return <span className={`text-xs px-2 py-0.5 rounded-full ${SERVICE_STATUS_CHIP[row.status] || ''}`}>{SERVICE_STATUS_LABELS[row.status] || row.status}</span>;
      },
    },
    {
      header: 'SLA',
      render: (row) => {
        if (!row.sla_due_date) return '—';
        const due = new Date(row.sla_due_date);
        const overdue = isOverdue(row);
        return <span className={`text-sm ${overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>{format(due, 'dd/MM HH:mm')}</span>;
      },
    },
    {
      header: 'נציג',
      render: (row) => <span className="text-sm text-muted-foreground">{row.assigned_to ? getRepDisplayName(row.assigned_to, users) : '—'}</span>,
    },
    {
      header: 'תאריך',
      render: (row) => <span className="text-sm text-muted-foreground">{row.created_date ? format(new Date(row.created_date), 'dd/MM/yyyy') : ''}</span>,
    },
  ];

  if (isLoadingUser) return <div className="text-center py-12">טוען...</div>;
  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת למרכז השירות</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-12 rounded-full bg-gradient-to-b from-rose-500 to-rose-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">מרכז שירות</h1>
            <p className="text-muted-foreground">ניהול פניות שירות לקוחות</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowImport(true)}>
              <FileSpreadsheet className="h-4 w-4" /> ייבוא
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSmsDialog(true)}>
            <MessageSquare className="h-4 w-4" /> שלח SMS ללקוח
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowOpenDialog(true)}>
            <Plus className="h-4 w-4" /> פנייה חדשה
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard title="פניות פתוחות" value={counts.open} icon={Headphones} color="blue" />
        <KPICard title="חריגת SLA" value={counts.overdue} icon={AlertTriangle} color="red" />
        <KPICard title="נפתחו ע״י לקוח" value={counts.customer} icon={UserPlus} color="violet" />
        <KPICard title="ממתין למילוי לקוח" value={counts.pending} icon={MessageSquare} color="amber" />
        <KPICard title="נפתרו היום" value={counts.resolvedToday} icon={CheckCircle} color="emerald" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border">
          <TabsTrigger value="open">פתוחות ({counts.open})</TabsTrigger>
          <TabsTrigger value="all">הכל ({scoped.length})</TabsTrigger>
          <TabsTrigger value="customer">נפתחו ע״י לקוח ({counts.customer})</TabsTrigger>
          <TabsTrigger value="overdue" className="text-red-600">חריגת SLA ({counts.overdue})</TabsTrigger>
          <TabsTrigger value="imported">מיובאות</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', request_type: 'all', status: 'all', source: 'all' })}
        searchPlaceholder="חפש לפי מספר פנייה, שם, טלפון או נושא..."
      />

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyMessage="לא נמצאו פניות שירות"
        onRowClick={(row) => navigate(createPageUrl('ServiceRequestDetails') + `?id=${row.id}`)}
      />

      <OpenServiceTicketDialog open={showOpenDialog} onOpenChange={setShowOpenDialog} currentUser={effectiveUser} />
      <SendServiceSmsDialog open={showSmsDialog} onOpenChange={setShowSmsDialog} currentUser={effectiveUser} />
      {canManage && <ImportServiceData open={showImport} onOpenChange={setShowImport} />}
    </div>
  );
}
