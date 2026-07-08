import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import KPICard from '@/components/shared/KPICard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Headphones, AlertTriangle, CheckCircle, MessageSquare, FileSpreadsheet, Image as ImageIcon, UserPlus, Sparkles, Loader2 } from 'lucide-react';
import { format, addHours } from '@/lib/safe-date-fns';
import { toast } from 'sonner';
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
  SLA_HOURS,
  nextTicketNumber,
} from '@/constants/serviceOptions';
import OpenServiceTicketDialog from '@/components/service/OpenServiceTicketDialog';
import SendServiceSmsDialog from '@/components/service/SendServiceSmsDialog';
import ImportServiceData from '@/components/service/ImportServiceData';
import ServiceRequestModal from '@/components/service/ServiceRequestModal';

const PRIORITY_CHIP = {
  urgent: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  high: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

const isOpen = (t) => OPEN_SERVICE_STATUSES.includes(t.status) || (!['resolved', 'closed'].includes(t.status));
const isOverdue = (t) => t.sla_due_date && new Date(t.sla_due_date) < new Date() && !['resolved', 'closed'].includes(t.status);

export default function ServiceCenter() {
  const queryClient = useQueryClient();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const canAccess = canAccessServiceWorkspace(effectiveUser);
  const canManage = canManageService(effectiveUser);

  const [activeTab, setActiveTab] = useState('open');
  const [filters, setFilters] = useState({ search: '', request_type: 'all', status: 'all', source: 'all' });
  const [showOpenDialog, setShowOpenDialog] = useState(false);
  const [showSmsDialog, setShowSmsDialog] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState(null);

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

  // Seed a handful of demo tickets so the area can be exercised end-to-end.
  // Demo rows are prefixed "דמו —" so they're easy to spot and delete later.
  const seedMutation = useMutation({
    mutationFn: async () => {
      const recent = await base44.entities.SupportTicket.list('-created_date', 1);
      let next = recent[0]?.ticket_number;
      const num = () => (next = nextTicketNumber(next));
      const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
      const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

      // 1. A demo imported order to link the showcase ticket to.
      let demoOrderId = null;
      try {
        const ord = await base44.entities.Order.create({
          order_number: `DEMO-${Math.floor(Math.random() * 9000) + 1000}`,
          customer_name: 'דמו — משפחת ישראלי',
          customer_phone: '0507778899',
          total: 4990, subtotal: 4990, items: [],
          is_imported: true, import_source: 'demo', tags: ['הזמנה מיובאת'],
        });
        demoOrderId = ord?.id || null;
      } catch { /* order is optional for the demo */ }

      // 2. The rich showcase ticket — photos, full diagnostics, warranty, and a
      //    populated handling timeline so every tab feels real.
      const rich = await base44.entities.SupportTicket.create({
        ticket_number: num(),
        order_id: demoOrderId,
        customer_name: 'דמו — משפחת ישראלי',
        customer_phone: '0507778899',
        customer_email: 'demo.israeli@example.com',
        subject: 'דמו: שקיעה בצד ימין של המזרן',
        description: 'המזרן שקע בצד אחד אחרי כשנתיים שימוש. ישנים עליו כל לילה. מצורפות תמונות של הבעיה.',
        category: 'warranty',
        request_type: 'warranty',
        priority: 'high',
        status: 'waiting_parts',
        source: 'customer_self',
        opened_by_customer: true,
        product_name: 'מזרן קפיצים מבודדים 160/200',
        warranty_years: 10,
        complaint_age_months: 26,
        order_date: ago(24 * 760).slice(0, 10),
        issue_answers: {
          product: 'מזרן קפיצים מבודדים 160/200',
          problem_summary: 'שקיעה מורגשת בצד ימין',
          problem_area: 'צד ימין',
          when_started: 'לפני מספר חודשים',
          usage: 'שימוש יומיומי',
          notes: 'השקיעה מורגשת בעיקר באזור האגן.',
        },
        photo_urls: [
          'https://picsum.photos/seed/kd-mattress-1/600/450',
          'https://picsum.photos/seed/kd-mattress-2/600/450',
          'https://picsum.photos/seed/kd-mattress-3/600/450',
        ],
        public_token: uuid(),
        public_status: 'submitted',
        public_sent_at: ago(118),
        public_submitted_at: ago(112),
        created_date: ago(120),
        assigned_to: effectiveUser?.email || null,
        sla_due_date: addHours(new Date(), 24).toISOString(),
        service_notes: [
          { at: ago(110), by: 'דנה (שירות)', text: 'הסטטוס שונה ל“בטיפול”', type: 'status' },
          { at: ago(96), by: 'דנה (שירות)', text: 'נוצר קשר טלפוני עם הלקוח — נתבקשו תמונות נוספות.', type: 'note' },
          { at: ago(72), by: 'נתנאל (מנהל שירות)', text: 'שויכה משימת שירות לנציג מתן', type: 'assignment' },
          { at: ago(36), by: 'מתן', text: 'הלקוח שלח תמונות — נראה פגם ייצור בתפר הצדדי.', type: 'note' },
          { at: ago(10), by: 'דנה (שירות)', text: 'הסטטוס שונה ל“ממתין לחלקים/מפעל”', type: 'status' },
        ],
      });

      // 3. A few simpler tickets for list / KPI variety.
      const samples = [
        { customer_name: 'דמו — יוסי לוי', customer_phone: '0502223344', subject: 'דמו: בעיה בתוך 30 יום', request_type: 'trial_30d', priority: 'high', status: 'in_progress', source: 'customer_self', opened_by_customer: true, product_name: 'מזרן ויסקו' },
        { customer_name: 'דמו — שיר אבני', customer_phone: '0503334455', subject: 'דמו: פנייה כללית', request_type: 'general', priority: 'medium', status: 'waiting_customer', source: 'agent_manual' },
        { customer_name: 'דמו — אבי מזרחי', customer_phone: '0504445566', subject: 'דמו: ממתין למילוי הלקוח', priority: 'medium', status: 'open', source: 'customer_self', public_status: 'pending' },
        { customer_name: 'דמו — רונית בר', customer_phone: '0505556677', subject: 'דמו: טופל ונסגר', request_type: 'warranty', priority: 'low', status: 'resolved', source: 'imported' },
      ];
      for (const s of samples) {
        const priority = s.priority || 'medium';
        await base44.entities.SupportTicket.create({
          ticket_number: num(),
          customer_name: s.customer_name,
          customer_phone: s.customer_phone,
          subject: s.subject,
          description: 'רשומת דמו לבדיקת מרכז השירות.',
          category: s.request_type === 'trial_30d' ? 'trial' : s.request_type === 'warranty' ? 'warranty' : 'other',
          request_type: s.request_type || null,
          priority,
          status: s.status,
          source: s.source,
          opened_by_customer: !!s.opened_by_customer,
          public_status: s.public_status || null,
          public_token: s.public_status === 'pending' ? uuid() : null,
          product_name: s.product_name || '',
          assigned_to: effectiveUser?.email || null,
          created_by_rep: effectiveUser?.email || null,
          created_by_name: effectiveUser?.full_name || null,
          sla_due_date: addHours(new Date(), SLA_HOURS[priority] || 48).toISOString(),
        });
      }

      return { richId: rich?.id || null };
    },
    onSuccess: ({ richId }) => {
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] });
      toast.success('נוצרו נתוני דמה — פותח פנייה לדוגמה');
      if (richId) setSelectedTicketId(richId);
    },
    onError: (err) => {
      console.error('[ServiceCenter] seed demo failed', { message: err?.message, details: err?.details, hint: err?.hint, code: err?.code });
      const missingColumn = err?.code === 'PGRST204' || /column .* does not exist|could not find .* column/i.test(`${err?.message || ''} ${err?.details || ''}`);
      if (missingColumn) {
        toast.error('נראה שמיגרציית מסד הנתונים טרם הורצה — חסרים שדות חדשים בטבלת הפניות. יש להריץ את המיגרציה 20260529000001_service_center.sql', { duration: 14000 });
      } else {
        toast.error(`יצירת נתוני הדמה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`, { duration: 9000 });
      }
    },
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
    else if (activeTab === 'pending') list = list.filter((t) => t.public_status === 'pending');
    else if (activeTab === 'resolved_today') list = list.filter((t) => ['resolved', 'closed'].includes(t.status) && t.updated_date && new Date(t.updated_date).toDateString() === new Date().toDateString());

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
  // The Service Center screen is the management view (see all tickets, assign to
  // any rep, run imports) — gate it on the "ניהול מרכז שירות" permission, not the
  // broad support-access check. Reps without it still open tickets from an order.
  if (!canManage) {
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
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              {seedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} נתוני דמה
            </Button>
          )}
          {canManage && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowImport(true)}>
              <FileSpreadsheet className="h-4 w-4" /> ייבוא פניות
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

      {/* KPI tiles double as quick filters — click to filter the list below. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { tab: 'open', title: 'פניות פתוחות', value: counts.open, icon: Headphones, color: 'blue' },
          { tab: 'overdue', title: 'חריגת SLA', value: counts.overdue, icon: AlertTriangle, color: 'red' },
          { tab: 'customer', title: 'נפתחו ע״י לקוח', value: counts.customer, icon: UserPlus, color: 'violet' },
          { tab: 'pending', title: 'ממתין למילוי לקוח', value: counts.pending, icon: MessageSquare, color: 'amber' },
          { tab: 'resolved_today', title: 'נפתרו היום', value: counts.resolvedToday, icon: CheckCircle, color: 'emerald' },
        ].map((tile) => (
          <div key={tile.tab} className={`rounded-xl transition ${activeTab === tile.tab ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
            <KPICard title={tile.title} value={tile.value} icon={tile.icon} color={tile.color} onClick={() => setActiveTab(tile.tab)} />
          </div>
        ))}
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
        onRowClick={(row) => setSelectedTicketId(row.id)}
      />

      <OpenServiceTicketDialog open={showOpenDialog} onOpenChange={setShowOpenDialog} currentUser={effectiveUser} />
      <SendServiceSmsDialog open={showSmsDialog} onOpenChange={setShowSmsDialog} currentUser={effectiveUser} />
      {canManage && <ImportServiceData open={showImport} onOpenChange={setShowImport} />}
      <ServiceRequestModal
        ticketId={selectedTicketId}
        open={!!selectedTicketId}
        onOpenChange={(v) => { if (!v) setSelectedTicketId(null); }}
      />
    </div>
  );
}
