import React, { useMemo, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  Clock,
  Download,
  FileText,
  Globe,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  LineChart,
  Line,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { endOfDay, startOfDay, subDays, startOfWeek, startOfMonth, startOfYear } from '@/lib/safe-date-fns';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly, isFactoryUser } from '@/lib/rbac';
import { format } from '@/lib/safe-date-fns';
import AddSalesTaskDialog from '@/components/task/AddSalesTaskDialog';

const METRIC_COLOR = {
  positive: 'emerald',
  warning: 'amber',
  danger: 'red',
  info: 'blue',
  primary: 'indigo',
};

const KPI_TONE_CLASS = {
  emerald: 'border-emerald-100 bg-emerald-50/40',
  amber: 'border-amber-100 bg-amber-50/40',
  red: 'border-red-100 bg-red-50/40',
  blue: 'border-blue-100 bg-blue-50/40',
  indigo: 'border-indigo-100 bg-indigo-50/40',
};

const SEVERITY_BADGE = {
  critical: { label: 'קריטי', variant: 'destructive' },
  high: { label: 'גבוה', variant: 'warning' },
  medium: { label: 'בינוני', variant: 'info' },
  low: { label: 'נמוך', variant: 'secondary' },
};

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

function resolveDrilldownUrl(link, replacements = {}) {
  if (!link?.page) return null;
  const params = new URLSearchParams();

  Object.entries(link.query || {}).forEach(([key, rawValue]) => {
    let value = String(rawValue ?? '');
    Object.entries(replacements).forEach(([placeholder, replacement]) => {
      value = value.replace(`{${placeholder}}`, replacement ?? '');
    });
    if (!value || value.includes('{')) return;
    params.set(key, value);
  });

  const pageUrl = createPageUrl(link.page);
  const query = params.toString();
  return query ? `${pageUrl}?${query}` : pageUrl;
}

function KpiTile({ title, value, subtitle, onClick, tone = 'primary' }) {
  const color = METRIC_COLOR[tone] || METRIC_COLOR.primary;
  const toneClass = KPI_TONE_CLASS[color] || KPI_TONE_CLASS.indigo;
  const interactive = typeof onClick === 'function';

  // Place the click handler on the whole Card (was on an inner <button> that
  // didn't cover the card's padding, so clicks near the edges did nothing).
  const handleKeyDown = (event) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(event);
    }
  };

  return (
    <Card
      className={`${toneClass} group relative ${interactive ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary' : ''}`}
      onClick={interactive ? onClick : undefined}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? title : undefined}
    >
      <CardContent className="p-4 text-right">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground mb-1">{title}</p>
          {interactive ? (
            <ChevronLeft
              className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary group-hover:-translate-x-0.5 transition-all"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        {subtitle ? <p className="text-xs text-muted-foreground mt-2">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

function LoadingCockpit() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();

  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);

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

  const { data: stats, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dashboardStats', dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const from = dateRange?.from || startOfDay(new Date());
      const to = dateRange?.to ? endOfDay(dateRange.to) : endOfDay(from);
      const response = await base44.functions.invoke('getDashboardStats', {
        startDate: from.toISOString(),
        endDate: to.toISOString(),
      });
      return response;
    },
    enabled: !!user && !isCheckingAuth,
    staleTime: 45 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const exportCsvMutation = useMutation({
    mutationFn: async (exportType) => {
      const from = dateRange?.from || startOfDay(new Date());
      const to = dateRange?.to ? endOfDay(dateRange.to) : endOfDay(from);

      const response = await base44.functions.invoke('exportDashboardCsv', {
        exportType,
        startDate: from.toISOString(),
        endDate: to.toISOString(),
      });

      return response;
    },
    onSuccess: (data) => {
      if (!data?.csv) return;

      const blob = new Blob([`\uFEFF${data.csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = data.file_name || `dashboard-export-${Date.now()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    },
  });

  const handleRefresh = async () => {
    await refetch();
    setLastUpdated(new Date());
  };

  const handlePresetClick = (preset) => {
    const today = new Date();
    switch (preset) {
      case 'today':
        setDateRange({ from: startOfDay(today), to: endOfDay(today) });
        break;
      case 'week':
        setDateRange({ from: startOfWeek(today, { weekStartsOn: 0 }), to: endOfDay(today) });
        break;
      case 'month':
        setDateRange({ from: startOfMonth(today), to: endOfDay(today) });
        break;
      case 'year':
        setDateRange({ from: startOfYear(today), to: endOfDay(today) });
        break;
      case 'max':
        setDateRange({ from: new Date(2020, 0, 1), to: endOfDay(today) });
        break;
      default:
        setDateRange({ from: startOfDay(subDays(today, preset)), to: endOfDay(today) });
    }
  };

  // Frontend-side defaults for drilldown URLs. The deployed getDashboardStats
  // Edge Function doesn't include `drilldowns_meta` in its payload, so without
  // these defaults `goTo(undefined)` did nothing and the KPI cards looked
  // clickable but had nowhere to navigate to. If the backend ever starts
  // returning drilldowns_meta, those win (server-supplied wins over default).
  const startIso = dateRange?.from ? new Date(dateRange.from).toISOString() : undefined;
  const endIso = dateRange?.to ? new Date(dateRange.to).toISOString() : undefined;
  const defaultDrilldowns = useMemo(() => ({
    summary_kpis: {
      revenue: { page: 'Orders', query: { tab: 'all' } },
      conversion: { page: 'Leads', query: { tab: 'open' } },
      sla: { page: 'Leads', query: { tab: 'open' } },
      open_workload: { page: 'SalesTasks', query: { tab: 'not_completed' } },
    },
    live_pipeline: {
      tasks_overdue: { page: 'SalesTasks', query: { tab: 'overdue' } },
      tasks_today: { page: 'SalesTasks', query: { tab: 'today' } },
      sla_red_open: { page: 'Leads', query: { tab: 'open' } },
      pending_quotes: { page: 'Quotes', query: { tab: 'pending' } },
    },
    sales_performance: {
      rep_row: {
        page: 'Leads',
        query: {
          tab: 'all',
          rep1: '{rep_email}',
          repScope: 'primary',
          ...(startIso ? { startDate: startIso } : {}),
          ...(endIso ? { endDate: endIso } : {}),
        },
      },
    },
    marketing_performance: {
      source_row: { page: 'Leads', query: { tab: 'all', source: '{source}' } },
      campaign_row: { page: 'Marketing', query: { utm_campaign: '{campaign}' } },
    },
    smart_alerts: {
      sla_red: { page: 'Leads', query: { tab: 'open' } },
      tasks_overdue: { page: 'SalesTasks', query: { tab: 'overdue' } },
      failing_campaign: { page: 'Marketing', query: {} },
      expiring_quotes: { page: 'Quotes', query: { tab: 'expiring' } },
    },
  }), [startIso, endIso]);

  const drilldowns = stats?.drilldowns_meta || defaultDrilldowns;
  const summary = stats?.summary_kpis || {};
  const live = stats?.live_pipeline || {};
  const repRows = stats?.sales_performance?.reps || [];
  const sourceRows = stats?.marketing_performance?.sources || [];
  const campaignRows = stats?.marketing_performance?.campaigns || [];
  const landingPageRows = stats?.marketing_performance?.landing_pages || [];
  const alerts = stats?.smart_alerts || [];
  const trendRows = useMemo(() => {
    const leadsMap = new Map((stats?.trends?.leads_daily || []).map((row) => [row.date, row.value]));
    const revMap = new Map((stats?.trends?.revenue_daily || []).map((row) => [row.date, row.value]));
    const allDates = Array.from(new Set([...leadsMap.keys(), ...revMap.keys()])).sort((a, b) => a.localeCompare(b));

    return allDates.map((date) => ({
      date,
      leads: leadsMap.get(date) || 0,
      revenue: revMap.get(date) || 0,
    }));
  }, [stats]);

  const goTo = (link, replacements = {}) => {
    const url = resolveDrilldownUrl(link, replacements);
    if (url) navigate(url);
  };

  if (isCheckingAuth || !user) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (isLoading && !stats) {
    return <LoadingCockpit />;
  }

  return (
    <div className="space-y-6" dir="rtl">
      {isFetching && !isLoading ? (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-primary/20">
          <div className="h-full bg-primary animate-pulse" style={{ width: '55%' }} />
        </div>
      ) : null}

      <Card className="border-border shadow-card">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Executive Cockpit</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                עדכון אחרון: {format(lastUpdated, 'HH:mm:ss')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-8 text-xs font-normal" dir="rtl">
                    <CalendarIcon className="me-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange?.to ? (
                        <>
                          {format(dateRange.from, 'dd.MM.yy')}
                          {' - '}
                          {format(dateRange.to, 'dd.MM.yy')}
                        </>
                      ) : (
                        format(dateRange.from, 'dd.MM.yy')
                      )
                    ) : (
                      <span>בחר תאריך</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end" dir="rtl">
                  <div className="flex flex-col sm:flex-row">
                    <div className="flex flex-col gap-1 p-3 border-s border-border/50 bg-muted/50 min-w-[140px]">
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick('today')} className="justify-start font-normal h-7 text-xs">היום</Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick('week')} className="justify-start font-normal h-7 text-xs">השבוע</Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick('month')} className="justify-start font-normal h-7 text-xs">החודש</Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick(30)} className="justify-start font-normal h-7 text-xs">30 יום</Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick(90)} className="justify-start font-normal h-7 text-xs">90 יום</Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick('year')} className="justify-start font-normal h-7 text-xs">שנה</Button>
                      <Button variant="ghost" size="sm" onClick={() => handlePresetClick('max')} className="justify-start font-normal h-7 text-xs">מקסימום</Button>
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

              <Link to={createPageUrl('NewLead')}>
                <Button size="sm" className="h-8 text-xs">ליד חדש</Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setIsAddTaskOpen(true)}
              >
                משימה חדשה
              </Button>
              <Link to={createPageUrl('NewQuote')}>
                <Button size="sm" variant="outline" className="h-8 text-xs">הצעה חדשה</Button>
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="destructive">באיחור: {live?.tasks_overdue?.count || 0}</Badge>
            <Badge variant="info">חדשים ללא מענה: {live?.sla_red_open?.count || 0}</Badge>
            <Badge variant="warning">פג תוקף בקרוב: {(alerts || []).filter((alert) => alert.type === 'expiring_quotes').reduce((sum, alert) => sum + (alert.impact || 0), 0)}</Badge>
            <Badge variant="secondary">מחכה לפולואפ: {live?.pending_quotes?.count || 0}</Badge>
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          title="הכנסות בטווח"
          value={formatCurrency(summary?.revenue?.value || 0)}
          subtitle="בטווח תאריכים נבחר"
          tone="positive"
          onClick={() => goTo(drilldowns?.summary_kpis?.revenue)}
        />
        <KpiTile
          title="שיעור המרה"
          value={`${summary?.conversion?.value || 0}%`}
          subtitle={`${summary?.conversion?.won_leads || 0} נסגרו מתוך ${summary?.conversion?.total_leads || 0}`}
          tone="info"
          onClick={() => goTo(drilldowns?.summary_kpis?.conversion)}
        />
        <KpiTile
          title="SLA תקין"
          value={`${summary?.sla?.value || 0}%`}
          subtitle={`${summary?.sla?.red_count || 0} אדומים`}
          tone={(summary?.sla?.red_count || 0) > 0 ? 'warning' : 'positive'}
          onClick={() => goTo(drilldowns?.summary_kpis?.sla)}
        />
        <KpiTile
          title="עומס פתוח"
          value={summary?.open_workload?.value || 0}
          subtitle="באיחור + להיום"
          tone={(summary?.open_workload?.value || 0) > 0 ? 'danger' : 'primary'}
          onClick={() => goTo(drilldowns?.summary_kpis?.open_workload)}
        />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          title="משימות באיחור"
          value={live?.tasks_overdue?.count || 0}
          subtitle="Real-time pipeline"
          tone="danger"
          onClick={() => goTo(drilldowns?.live_pipeline?.tasks_overdue)}
        />
        <KpiTile
          title="משימות להיום"
          value={live?.tasks_today?.count || 0}
          subtitle="לטיפול מיידי"
          tone="warning"
          onClick={() => goTo(drilldowns?.live_pipeline?.tasks_today)}
        />
        <KpiTile
          title="SLA אדום פתוח"
          value={live?.sla_red_open?.count || 0}
          subtitle="ללא מענה מעל 15 דק׳"
          tone="danger"
          onClick={() => goTo(drilldowns?.live_pipeline?.sla_red_open)}
        />
        <KpiTile
          title="הצעות ממתינות"
          value={live?.pending_quotes?.count || 0}
          subtitle="נשלח/ממתין לטיפול"
          tone="info"
          onClick={() => goTo(drilldowns?.live_pipeline?.pending_quotes)}
        />
      </section>

      <Card className="border-border shadow-card">
        <CardHeader className="pb-2 border-b border-border/50">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            דורש טיפול עכשיו
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">אין חריגות פעילות כרגע.</div>
          ) : (
            <div className="divide-y divide-border/50">
              {alerts.map((alert) => {
                const severity = SEVERITY_BADGE[alert.severity] || SEVERITY_BADGE.low;
                // The deployed getDashboardStats Edge Function omits
                // action_link on each smart alert. Fall back to the frontend
                // default drilldown keyed by alert.type / alert.id so the
                // rows still navigate.
                const fallbackByType = drilldowns?.smart_alerts?.[alert.type]
                  || drilldowns?.smart_alerts?.[alert.id?.replace(/s$/, '')]
                  || drilldowns?.smart_alerts?.[alert.id];
                const link = alert.action_link || fallbackByType;
                const interactive = !!link;
                const handleOpen = () => goTo(link);
                return (
                  <div
                    key={alert.id}
                    className={`p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${interactive ? 'cursor-pointer hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:bg-muted/60' : ''}`}
                    onClick={interactive ? handleOpen : undefined}
                    onKeyDown={(event) => {
                      if (!interactive) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleOpen();
                      }
                    }}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={interactive ? alert.reason : undefined}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={severity.variant}>{severity.label}</Badge>
                        <Badge variant="outline">{alert.owner}</Badge>
                      </div>
                      <p className="text-sm font-medium text-foreground">{alert.reason}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">השפעה: {alert.impact || 0}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpen();
                        }}
                      >
                        פתח
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-card overflow-hidden">
        <CardHeader className="pb-2 border-b border-border/50 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-600" />
            ביצועי נציגים
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportCsvMutation.mutate('reps')}
            disabled={exportCsvMutation.isPending}
          >
            <Download className="h-3.5 w-3.5 me-1" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-14">#</TableHead>
                  <TableHead className="text-right">נציג</TableHead>
                  <TableHead className="text-right">לידים</TableHead>
                  <TableHead className="text-right">המרה</TableHead>
                  <TableHead className="text-right">הכנסות</TableHead>
                  <TableHead className="text-right">עומס פתוח</TableHead>
                  <TableHead className="text-right">באיחור</TableHead>
                  <TableHead className="text-right">SLA אדום</TableHead>
                  <TableHead className="text-right">פעולה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">אין נתוני נציגים בטווח.</TableCell>
                  </TableRow>
                ) : (
                  repRows.map((rep, idx) => (
                    <TableRow key={rep.rep_email}>
                      <TableCell className="text-center text-muted-foreground font-semibold">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{rep.rep_name}</TableCell>
                      <TableCell>{rep.leads_range}</TableCell>
                      <TableCell>{rep.conversion_rate}%</TableCell>
                      <TableCell>{formatCurrency(rep.revenue)}</TableCell>
                      <TableCell>{rep.workload_open_tasks}</TableCell>
                      <TableCell className="text-red-600">{rep.workload_overdue_tasks}</TableCell>
                      <TableCell className="text-amber-700">{rep.sla_red_open}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => goTo(drilldowns?.sales_performance?.rep_row, { rep_email: rep.rep_email })}
                        >
                          Drill-down
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="border-border shadow-card overflow-hidden">
          <CardHeader className="pb-2 border-b border-border/50 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              יעילות לפי מקור
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportCsvMutation.mutate('sources')}
              disabled={exportCsvMutation.isPending}
            >
              <Download className="h-3.5 w-3.5 me-1" />
              CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center w-14">#</TableHead>
                    <TableHead className="text-right">מקור</TableHead>
                    <TableHead className="text-right">לידים</TableHead>
                    <TableHead className="text-right">% הצעה</TableHead>
                    <TableHead className="text-right">% המרה</TableHead>
                    <TableHead className="text-right">הכנסות</TableHead>
                    <TableHead className="text-right">הוצאות</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sourceRows.slice(0, 12).map((row, idx) => (
                    <TableRow key={row.source} className="cursor-pointer" onClick={() => goTo(drilldowns?.marketing_performance?.source_row, { source: row.source })}>
                      <TableCell className="text-center text-muted-foreground font-semibold">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{row.source}</TableCell>
                      <TableCell>{row.leads}</TableCell>
                      <TableCell>{row.quote_rate}%</TableCell>
                      <TableCell>{row.conversion_rate}%</TableCell>
                      <TableCell>{formatCurrency(row.attributed_revenue)}</TableCell>
                      <TableCell>{formatCurrency(row.spend)}</TableCell>
                      <TableCell>{row.roas == null ? '-' : row.roas}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-card overflow-hidden">
          <CardHeader className="pb-2 border-b border-border/50 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-purple-600" />
              יעילות לפי קמפיין
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportCsvMutation.mutate('campaigns')}
              disabled={exportCsvMutation.isPending}
            >
              <Download className="h-3.5 w-3.5 me-1" />
              CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center w-14">#</TableHead>
                    <TableHead className="text-right">קמפיין</TableHead>
                    <TableHead className="text-right">מקור</TableHead>
                    <TableHead className="text-right">לידים</TableHead>
                    <TableHead className="text-right">% המרה</TableHead>
                    <TableHead className="text-right">הכנסות</TableHead>
                    <TableHead className="text-right">הוצאות</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignRows.slice(0, 12).map((row, idx) => (
                    <TableRow key={row.campaign} className="cursor-pointer" onClick={() => goTo(drilldowns?.marketing_performance?.campaign_row, { campaign: row.campaign })}>
                      <TableCell className="text-center text-muted-foreground font-semibold">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{row.campaign}</TableCell>
                      <TableCell>{row.source}</TableCell>
                      <TableCell>{row.leads}</TableCell>
                      <TableCell>{row.conversion_rate}%</TableCell>
                      <TableCell>{formatCurrency(row.attributed_revenue)}</TableCell>
                      <TableCell>{formatCurrency(row.spend)}</TableCell>
                      <TableCell>{row.roas == null ? '-' : row.roas}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border shadow-card overflow-hidden">
        <CardHeader className="pb-2 border-b border-border/50 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-teal-600" />
            יעילות לפי דף נחיתה
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportCsvMutation.mutate('landing_pages')}
            disabled={exportCsvMutation.isPending}
          >
            <Download className="h-3.5 w-3.5 me-1" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center w-14">#</TableHead>
                  <TableHead className="text-right">דף נחיתה</TableHead>
                  <TableHead className="text-right">מקור</TableHead>
                  <TableHead className="text-right">לידים</TableHead>
                  <TableHead className="text-right">% הצעה</TableHead>
                  <TableHead className="text-right">% המרה</TableHead>
                  <TableHead className="text-right">הכנסות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {landingPageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">אין נתוני דפי נחיתה בטווח.</TableCell>
                  </TableRow>
                ) : (
                  landingPageRows.slice(0, 15).map((row, idx) => (
                    <TableRow key={row.landing_page}>
                      <TableCell className="text-center text-muted-foreground font-semibold">{idx + 1}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={row.landing_page}>{row.landing_page}</TableCell>
                      <TableCell>{row.source}</TableCell>
                      <TableCell>{row.leads}</TableCell>
                      <TableCell>{row.quote_rate}%</TableCell>
                      <TableCell>{row.conversion_rate}%</TableCell>
                      <TableCell>{formatCurrency(row.attributed_revenue)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-card">
        <CardHeader className="pb-2 border-b border-border/50 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            מגמה בטווח הנבחר
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportCsvMutation.mutate('alerts')}
            disabled={exportCsvMutation.isPending}
          >
            <Download className="h-3.5 w-3.5 me-1" />
            ייצוא התראות
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          {trendRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין נתוני מגמה בטווח שנבחר.</p>
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendRows} margin={{ top: 8, right: 20, left: 10, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" allowDecimals={false} />
                  <Tooltip
                    formatter={(value, name) => [
                      name === 'revenue' ? formatCurrency(value) : value,
                      name === 'revenue' ? 'הכנסות' : 'לידים',
                    ]}
                  />
                  <Line yAxisId="left" type="monotone" dataKey="leads" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <AddSalesTaskDialog
        isOpen={isAddTaskOpen}
        onClose={() => setIsAddTaskOpen(false)}
        effectiveUser={user}
      />
    </div>
  );
}
