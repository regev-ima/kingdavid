import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  DollarSign,
  Headphones,
  Factory as FactoryIcon,
  AlertTriangle,
  RefreshCw,
  Calendar as CalendarIcon,
  Clock,
  CheckSquare,
  Megaphone,
  Package,
  ChevronLeft,
  TrendingUp,
} from 'lucide-react';
import {
  endOfDay,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  subDays,
  format,
  differenceInDays,
} from '@/lib/safe-date-fns';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly, isBookkeeperUser, isFactoryUser } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

const OPEN_LEAD_STATUSES = [
  'new_lead', 'hot_lead', 'followup_before_quote', 'followup_after_quote',
  'coming_to_branch', 'no_answer_1', 'no_answer_2', 'no_answer_3',
  'no_answer_4', 'no_answer_5', 'no_answer_whatsapp_sent', 'no_answer_calls',
  'changed_direction',
];

const NO_ANSWER_STATUSES = [
  'no_answer_1', 'no_answer_2', 'no_answer_3', 'no_answer_4', 'no_answer_5',
  'no_answer_whatsapp_sent', 'no_answer_calls',
];

const IN_PRODUCTION_STATUSES = ['not_started', 'materials_check', 'in_production', 'qc'];
const PENDING_DELIVERY_STATUSES = ['need_scheduling', 'scheduled', 'dispatched', 'in_transit'];
const OPEN_TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer'];

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

function KpiCard({ title, value, subtitle, icon: Icon, tone = 'indigo', onClick }) {
  const toneClass = {
    indigo: 'border-indigo-100 bg-indigo-50/40 text-indigo-600',
    blue:   'border-blue-100 bg-blue-50/40 text-blue-600',
    emerald:'border-emerald-100 bg-emerald-50/40 text-emerald-600',
    amber:  'border-amber-100 bg-amber-50/40 text-amber-700',
    red:    'border-red-100 bg-red-50/40 text-red-600',
    purple: 'border-purple-100 bg-purple-50/40 text-purple-600',
    orange: 'border-orange-100 bg-orange-50/40 text-orange-600',
  }[tone];

  const interactive = typeof onClick === 'function';
  return (
    <Card
      className={`${toneClass} group relative ${interactive ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all' : ''}`}
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <CardContent className="p-4 text-right">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground mb-1">{title}</p>
          {Icon ? <Icon className="h-4 w-4 opacity-60" aria-hidden="true" /> : null}
        </div>
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        {subtitle ? <p className="text-xs text-muted-foreground mt-2">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, icon: Icon, iconColor, linkTo, children }) {
  const navigate = useNavigate();
  return (
    <Card className="border-border shadow-card overflow-hidden">
      <CardHeader className="pb-2 border-b border-border/50 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          {Icon ? <Icon className={`h-4 w-4 ${iconColor || ''}`} /> : null}
          {title}
        </CardTitle>
        {linkTo ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7"
            onClick={() => navigate(createPageUrl(linkTo))}
          >
            כניסה לדשבורד <ChevronLeft className="h-3 w-3 ms-1" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function MiniStat({ label, value, tone = 'default' }) {
  const toneClass = {
    default: 'bg-muted/40',
    blue: 'bg-blue-50',
    emerald: 'bg-emerald-50',
    amber: 'bg-amber-50',
    red: 'bg-red-50',
    purple: 'bg-purple-50',
  }[tone];
  return (
    <div className={`${toneClass} rounded-md p-3 text-right`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

async function loadKpis({ from, to }) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const nowIso = new Date().toISOString();
  const slaThresholdIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const todayStartIso = startOfDay(new Date()).toISOString();
  const todayEndIso = endOfDay(new Date()).toISOString();
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const [
    leadsInRange,
    leadsOpen,
    leadsWonInRange,
    leadsNoAnswerOpen,
    leadsSlaRed,
    ordersInRange,
    ordersInProduction,
    ordersReady,
    ordersNotStarted,
    ordersUnpaid,
    tasksOpen,
    tasksOverdue,
    tasksToday,
    quotesPending,
    ticketsOpen,
    ticketsUrgentOpen,
    ticketsCreatedToday,
    ticketsSlaExpired,
    deliveriesShippedInRange,
    deliveriesPending,
  ] = await Promise.all([
    base44.entities.Lead.filter({ effective_sort_date: { $gte: fromIso, $lte: toIso } }, '-effective_sort_date', 2000),
    base44.entities.Lead.count({ status: { $in: OPEN_LEAD_STATUSES } }),
    base44.entities.Lead.count({ status: 'deal_closed', effective_sort_date: { $gte: fromIso, $lte: toIso } }),
    base44.entities.Lead.count({ status: { $in: NO_ANSWER_STATUSES } }),
    base44.entities.Lead.count({ status: { $in: OPEN_LEAD_STATUSES }, effective_sort_date: { $lte: slaThresholdIso } }),
    base44.entities.Order.filter({ created_date: { $gte: fromIso, $lte: toIso } }, '-created_date', 2000),
    base44.entities.Order.count({ production_status: { $in: IN_PRODUCTION_STATUSES } }),
    base44.entities.Order.count({ production_status: 'ready' }),
    base44.entities.Order.count({ production_status: 'not_started' }),
    base44.entities.Order.count({ payment_status: { $in: ['unpaid', 'deposit_paid'] } }),
    base44.entities.SalesTask.count({ task_status: 'not_completed' }),
    base44.entities.SalesTask.count({ task_status: 'not_completed', due_date: { $lt: nowIso } }),
    base44.entities.SalesTask.count({ task_status: 'not_completed', due_date: { $gte: todayStartIso, $lte: todayEndIso } }),
    base44.entities.Quote.count({ status: 'sent' }),
    base44.entities.SupportTicket.count({ status: { $in: OPEN_TICKET_STATUSES } }),
    base44.entities.SupportTicket.count({ status: { $in: OPEN_TICKET_STATUSES }, priority: 'urgent' }),
    base44.entities.SupportTicket.count({ created_date: { $gte: todayStartIso, $lte: todayEndIso } }),
    base44.entities.SupportTicket.count({ status: { $in: OPEN_TICKET_STATUSES }, sla_due_date: { $lt: nowIso } }),
    base44.entities.DeliveryShipment.count({ status: { $in: ['delivered'] }, scheduled_date: { $gte: format(from, 'yyyy-MM-dd'), $lte: format(to, 'yyyy-MM-dd') } }),
    base44.entities.DeliveryShipment.count({ status: { $in: PENDING_DELIVERY_STATUSES } }),
  ]);

  const revenueInRange = ordersInRange.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const orderCountInRange = ordersInRange.length;
  const avgOrderValue = orderCountInRange > 0 ? revenueInRange / orderCountInRange : 0;
  const conversionRate = leadsInRange.length > 0
    ? Math.round((leadsWonInRange / leadsInRange.length) * 1000) / 10
    : 0;

  const lateOrders = ordersInProduction
    ? ordersInRange.filter(o => {
        if (!o.created_date) return false;
        if (o.production_status === 'ready') return false;
        return differenceInDays(new Date(), new Date(o.created_date)) > 7;
      }).length
    : 0;

  const deliveriesToday = await base44.entities.DeliveryShipment.count({
    scheduled_date: todayStr,
    status: { $in: PENDING_DELIVERY_STATUSES },
  });

  return {
    leads: {
      newInRange: leadsInRange.length,
      openTotal: leadsOpen,
      noAnswer: leadsNoAnswerOpen,
      slaRed: leadsSlaRed,
      conversionRate,
    },
    orders: {
      revenue: revenueInRange,
      count: orderCountInRange,
      avg: avgOrderValue,
      unpaid: ordersUnpaid,
    },
    factory: {
      inProduction: ordersInProduction,
      ready: ordersReady,
      notStarted: ordersNotStarted,
      late: lateOrders,
    },
    tasks: {
      open: tasksOpen,
      today: tasksToday,
      overdue: tasksOverdue,
      pendingQuotes: quotesPending,
    },
    tickets: {
      open: ticketsOpen,
      urgent: ticketsUrgentOpen,
      today: ticketsCreatedToday,
      slaExpired: ticketsSlaExpired,
    },
    deliveries: {
      today: deliveriesToday,
      shippedInRange: deliveriesShippedInRange,
      pending: deliveriesPending,
    },
    leadsInRange,
  };
}

async function loadMarketingAndInventory({ from, to }) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const fromDateStr = format(from, 'yyyy-MM-dd');
  const toDateStr = format(to, 'yyyy-MM-dd');

  const [marketingCosts, inventoryLow] = await Promise.all([
    base44.entities.MarketingCost.filter(
      { date: { $gte: fromDateStr, $lte: toDateStr } },
      '-date',
      2000,
    ).catch(() => []),
    fetchAllList(base44.entities.InventoryItem).catch(() => []),
  ]);

  const totalSpend = marketingCosts.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const lowStockCount = inventoryLow.filter(item => {
    if (!item.min_threshold) return false;
    return (item.qty_on_hand || 0) <= item.min_threshold;
  }).length;

  // Campaign-attributed leads: leads with a utm_campaign/utm_source set in the range
  const campaignLeads = await base44.entities.Lead.count({
    source: { $in: ['digital', 'website', 'whatsapp'] },
    effective_sort_date: { $gte: fromIso, $lte: toIso },
  }).catch(() => 0);

  return { totalSpend, lowStockCount, campaignLeads };
}

const DATE_PRESETS = [
  { id: 'today', label: 'היום' },
  { id: 'week',  label: 'השבוע' },
  { id: 'month', label: 'החודש' },
  { id: '30',    label: '30 יום' },
  { id: '90',    label: '90 יום' },
  { id: 'year',  label: 'שנה' },
  { id: 'max',   label: 'מקסימום' },
];

export default function ControlCenter() {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();

  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [activeTab, setActiveTab] = useState('overview');
  const [dateRange, setDateRange] = useState({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        const effectiveUser = getEffectiveUser(userData);
        if (!canAccessAdminOnly(effectiveUser)) {
          if (isFactoryUser(effectiveUser)) {
            navigate(createPageUrl('FactoryDashboard'));
            return;
          }
          if (isBookkeeperUser(effectiveUser)) {
            navigate(createPageUrl('Bookkeeping'));
            return;
          }
          navigate(createPageUrl('SalesDashboard'));
          return;
        }
        setUser(userData);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    fetchUser();
  }, [getEffectiveUser, navigate]);

  const queryKey = useMemo(() => [
    'controlCenter',
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
  ], [dateRange]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const from = dateRange?.from || startOfDay(new Date());
      const to = dateRange?.to ? endOfDay(dateRange.to) : endOfDay(from);
      const [kpis, extra] = await Promise.all([
        loadKpis({ from, to }),
        loadMarketingAndInventory({ from, to }),
      ]);
      return { ...kpis, marketing: extra };
    },
    enabled: !!user && !isCheckingAuth,
    staleTime: 45 * 1000,
    placeholderData: (prev) => prev,
  });

  const handleRefresh = async () => {
    await refetch();
    setLastUpdated(new Date());
  };

  const handlePresetClick = (preset) => {
    const today = new Date();
    switch (preset) {
      case 'today': setDateRange({ from: startOfDay(today), to: endOfDay(today) }); break;
      case 'week':  setDateRange({ from: startOfWeek(today, { weekStartsOn: 0 }), to: endOfDay(today) }); break;
      case 'month': setDateRange({ from: startOfMonth(today), to: endOfDay(today) }); break;
      case 'year':  setDateRange({ from: startOfYear(today), to: endOfDay(today) }); break;
      case 'max':   setDateRange({ from: new Date(2020, 0, 1), to: endOfDay(today) }); break;
      default:      setDateRange({ from: startOfDay(subDays(today, Number(preset))), to: endOfDay(today) });
    }
  };

  if (isCheckingAuth || !user) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4" dir="rtl">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const leads      = data?.leads      || {};
  const orders     = data?.orders     || {};
  const factory    = data?.factory    || {};
  const tasks      = data?.tasks      || {};
  const tickets    = data?.tickets    || {};
  const deliveries = data?.deliveries || {};
  const marketing  = data?.marketing  || {};

  const isOverview = activeTab === 'overview';
  const show = (tab) => isOverview || activeTab === tab;

  return (
    <div className="space-y-6" dir="rtl">
      {isFetching && !isLoading ? (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-primary/20">
          <div className="h-full bg-primary animate-pulse" style={{ width: '55%' }} />
        </div>
      ) : null}

      {/* Header */}
      <Card className="border-border shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <LayoutDashboard className="h-6 w-6 text-primary" />
                מרכז שליטה
              </h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                עדכון אחרון: {format(lastUpdated, 'HH:mm:ss')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal" dir="rtl">
                    <CalendarIcon className="me-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange?.to ? (
                        <>
                          {format(dateRange.from, 'dd.MM.yy')} - {format(dateRange.to, 'dd.MM.yy')}
                        </>
                      ) : format(dateRange.from, 'dd.MM.yy')
                    ) : 'בחר תאריך'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end" dir="rtl">
                  <div className="flex flex-col sm:flex-row">
                    <div className="flex flex-col gap-1 p-3 border-s border-border/50 bg-muted/50 min-w-[140px]">
                      {DATE_PRESETS.map(p => (
                        <Button key={p.id} variant="ghost" size="sm" onClick={() => handlePresetClick(p.id)} className="justify-start font-normal h-7 text-xs">
                          {p.label}
                        </Button>
                      ))}
                    </div>
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={1}
                    />
                  </div>
                </PopoverContent>
              </Popover>

              <Button variant="outline" size="sm" onClick={handleRefresh} className="h-8 text-xs" disabled={isFetching}>
                <RefreshCw className={`h-3.5 w-3.5 me-1.5 ${isFetching ? 'animate-spin' : ''}`} />
                רענן
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          title="לידים בטווח"
          value={Number(leads.newInRange || 0).toLocaleString()}
          subtitle="לפי effective_sort_date"
          icon={Users}
          tone="blue"
          onClick={() => navigate(createPageUrl('Leads') + `?startDate=${dateRange.from.toISOString()}&endDate=${dateRange.to.toISOString()}`)}
        />
        <KpiCard
          title="הזמנות בטווח"
          value={Number(orders.count || 0).toLocaleString()}
          icon={ShoppingCart}
          tone="orange"
          onClick={() => navigate(createPageUrl('Orders'))}
        />
        <KpiCard
          title="הכנסות בטווח"
          value={formatCurrency(orders.revenue)}
          icon={DollarSign}
          tone="emerald"
          onClick={() => navigate(createPageUrl('Orders'))}
        />
        <KpiCard
          title="כרטיסי שירות פתוחים"
          value={Number(tickets.open || 0).toLocaleString()}
          icon={Headphones}
          tone="amber"
          onClick={() => navigate(createPageUrl('Support'))}
        />
        <KpiCard
          title="מזרונים בייצור"
          value={Number(factory.inProduction || 0).toLocaleString()}
          icon={FactoryIcon}
          tone="purple"
          onClick={() => navigate(createPageUrl('Factory'))}
        />
        <KpiCard
          title="משימות באיחור"
          value={Number(tasks.overdue || 0).toLocaleString()}
          icon={AlertTriangle}
          tone="red"
          onClick={() => navigate(createPageUrl('SalesTasks') + '?tab=overdue')}
        />
      </section>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList className="flex flex-wrap gap-1 justify-start">
          <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
          <TabsTrigger value="leads">לידים</TabsTrigger>
          <TabsTrigger value="orders">הזמנות</TabsTrigger>
          <TabsTrigger value="service">שירות</TabsTrigger>
          <TabsTrigger value="team">צוות</TabsTrigger>
          <TabsTrigger value="factory">מפעל</TabsTrigger>
          <TabsTrigger value="inventory">מלאי</TabsTrigger>
          <TabsTrigger value="marketing">שיווק</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {show('leads') ? (
              <SectionCard title="לידים" icon={Users} iconColor="text-blue-600" linkTo="Leads">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="חדשים בטווח" value={leads.newInRange || 0} tone="blue" />
                  <MiniStat label="פתוחים סה״כ" value={leads.openTotal || 0} />
                  <MiniStat label="ללא מענה" value={leads.noAnswer || 0} tone="amber" />
                  <MiniStat label="המרה" value={`${leads.conversionRate || 0}%`} tone="emerald" />
                </div>
                {(leads.newInRange || 0) === 0 ? (
                  <p className="text-xs text-muted-foreground text-center mt-3">אין נתונים בטווח</p>
                ) : null}
              </SectionCard>
            ) : null}

            {show('orders') ? (
              <SectionCard title="הזמנות והכנסות" icon={ShoppingCart} iconColor="text-orange-600" linkTo="Orders">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="סכום מכירות" value={formatCurrency(orders.revenue)} tone="emerald" />
                  <MiniStat label="מס׳ הזמנות" value={orders.count || 0} />
                  <MiniStat label="ממתינות לתשלום" value={orders.unpaid || 0} tone="amber" />
                  <MiniStat label="ממוצע הזמנה" value={formatCurrency(orders.avg)} />
                </div>
                {(orders.count || 0) === 0 ? (
                  <p className="text-xs text-muted-foreground text-center mt-3">אין נתונים בטווח</p>
                ) : null}
              </SectionCard>
            ) : null}

            {show('service') ? (
              <SectionCard title="שירות לקוחות" icon={Headphones} iconColor="text-amber-600" linkTo="Support">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="דחופים" value={tickets.urgent || 0} tone="red" />
                  <MiniStat label="פתוחים" value={tickets.open || 0} />
                  <MiniStat label="נפתחו היום" value={tickets.today || 0} tone="blue" />
                  <MiniStat label="SLA פג" value={tickets.slaExpired || 0} tone="amber" />
                </div>
              </SectionCard>
            ) : null}

            {show('factory') ? (
              <SectionCard title="מפעל / ייצור" icon={FactoryIcon} iconColor="text-purple-600" linkTo="FactoryDashboard">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="מוכן למשלוח" value={factory.ready || 0} tone="emerald" />
                  <MiniStat label="בייצור" value={factory.inProduction || 0} tone="purple" />
                  <MiniStat label="לא התחיל" value={factory.notStarted || 0} />
                  <MiniStat label="מאחרים" value={factory.late || 0} tone="red" />
                </div>
              </SectionCard>
            ) : null}

            {show('team') ? (
              <SectionCard title="ביצועי צוות מכירות" icon={TrendingUp} iconColor="text-indigo-600" linkTo="Representatives">
                <RepPerformanceList leadsInRange={data?.leadsInRange} />
              </SectionCard>
            ) : null}

            {show('team') ? (
              <SectionCard title="משימות" icon={CheckSquare} iconColor="text-emerald-600" linkTo="SalesTasks">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="פתוחות" value={tasks.open || 0} />
                  <MiniStat label="להיום" value={tasks.today || 0} tone="blue" />
                  <MiniStat label="הצעות ממתינות" value={tasks.pendingQuotes || 0} tone="amber" />
                  <MiniStat label="באיחור" value={tasks.overdue || 0} tone="red" />
                </div>
              </SectionCard>
            ) : null}

            {show('marketing') ? (
              <SectionCard title="שיווק לפי מקור" icon={Megaphone} iconColor="text-pink-600" linkTo="Marketing">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat
                    label="ROI כולל"
                    value={(marketing.totalSpend || 0) > 0
                      ? `${Math.round((orders.revenue / marketing.totalSpend) * 100)}%`
                      : '-'}
                    tone="emerald"
                  />
                  <MiniStat label="לידים מקמפיינים" value={marketing.campaignLeads || 0} tone="blue" />
                  <MiniStat label="עלויות שיווק" value={formatCurrency(marketing.totalSpend)} tone="amber" />
                  <MiniStat
                    label="הכנסות מיוחסות"
                    value={formatCurrency(orders.revenue)}
                  />
                </div>
                {(marketing.campaignLeads || 0) === 0 ? (
                  <p className="text-xs text-muted-foreground text-center mt-3">אין נתוני שיווק בטווח שנבחר</p>
                ) : null}
              </SectionCard>
            ) : null}

            {show('inventory') ? (
              <SectionCard title="מלאי ומשלוחים" icon={Package} iconColor="text-teal-600" linkTo="Inventory">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="משלוחים להיום" value={deliveries.today || 0} tone="blue" />
                  <MiniStat label="פריטים מתחת לסף" value={marketing.lowStockCount || 0} tone="red" />
                  <MiniStat label="נשלחו בטווח" value={deliveries.shippedInRange || 0} tone="emerald" />
                  <MiniStat label="ממתינים לזמן" value={deliveries.pending || 0} tone="amber" />
                </div>
              </SectionCard>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RepPerformanceList({ leadsInRange }) {
  const rows = useMemo(() => {
    if (!Array.isArray(leadsInRange) || leadsInRange.length === 0) return [];
    const byRep = new Map();
    for (const lead of leadsInRange) {
      const rep = (lead.rep1 || 'לא משויך').trim();
      if (!byRep.has(rep)) byRep.set(rep, { rep, leads: 0, won: 0 });
      const row = byRep.get(rep);
      row.leads += 1;
      if (lead.status === 'deal_closed') row.won += 1;
    }
    return Array.from(byRep.values())
      .map(r => ({ ...r, conversion: r.leads > 0 ? Math.round((r.won / r.leads) * 1000) / 10 : 0 }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 6);
  }, [leadsInRange]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">אין נתוני נציגים בטווח שנבחר</p>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.rep} className="flex items-center justify-between text-sm bg-muted/30 rounded px-3 py-2">
          <span className="font-medium truncate" title={r.rep}>{r.rep}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {r.leads} לידים · {r.won} סגירות · {r.conversion}%
          </span>
        </div>
      ))}
    </div>
  );
}

