import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import KPICard from '@/components/shared/KPICard';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, CreditCard, RotateCcw, Users, Check, Download } from "lucide-react";
import { format, isWithinInterval } from '@/lib/safe-date-fns';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { toast } from 'sonner';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';
import { getDateRange, getPreviousDateRange } from '@/utils/dateRange';
import { formatCurrency } from '@/utils/currency';
import { toCsv, downloadCsv } from '@/utils/csv';

const filterOptions = [
  {
    key: 'payment_status',
    label: 'סטטוס תשלום',
    options: [
      { value: 'unpaid', label: 'לא שולם' },
      { value: 'deposit_paid', label: 'מקדמה' },
      { value: 'paid', label: 'שולם' },
      { value: 'refunded_partial', label: 'זיכוי חלקי' },
      { value: 'refunded_full', label: 'זיכוי מלא' },
    ]
  },
  {
    key: 'source',
    label: 'מקור',
    options: [
      { value: 'store', label: 'חנות' },
      { value: 'callcenter', label: 'מוקד' },
      { value: 'digital', label: 'דיגיטל' },
    ]
  },
];

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Finance() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [activeTab, setActiveTab] = useState('overview');
  const [filters, setFilters] = useState({ search: '', payment_status: 'all', source: 'all' });
  const [dateRange, setDateRange] = useState('month'); // 'today', 'week', 'month', 'custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reportDateRange, setReportDateRange] = useState('month');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportRep, setReportRep] = useState('all');
  const queryClient = useQueryClient();
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list('-created_date'),
    enabled: isAdmin,
  });

  const { data: commissions = [] } = useQuery({
    queryKey: ['commissions'],
    queryFn: () => base44.entities.Commission.list('-created_date'),
    enabled: isAdmin,
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['returns'],
    queryFn: () => base44.entities.ReturnRequest.list('-created_date'),
    enabled: isAdmin,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
  });

  const approveCommissionMutation = useMutation({
    mutationFn: async ({ commissionId, email }) => {
      await base44.entities.Commission.update(commissionId, {
        status: 'approved',
        approved_by: email,
        approved_date: new Date().toISOString().split('T')[0],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['commissions']);
      toast.success('העמלה אושרה בהצלחה');
    },
  });

  const markCommissionPaidMutation = useMutation({
    mutationFn: async ({ commissionId, paidDate }) => {
      await base44.entities.Commission.update(commissionId, {
        status: 'paid',
        paid_date: paidDate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['commissions']);
      toast.success('העמלה סומנה כשולמה');
    },
  });

  // Page-level period — drives the KPI strip, the Overview tab, the Orders
  // tab, and the per-rep cards on the עמלות tab. The דוח עמלות tab keeps its
  // own selector (reportDateRange) intentionally — see comment near JSX.
  const { start: monthStart, end: monthEnd } = getDateRange(dateRange, customStartDate, customEndDate);
  const previousRange = getPreviousDateRange(dateRange, customStartDate, customEndDate);

  const monthOrders = useMemo(
    () => orders.filter(o => isWithinInterval(new Date(o.created_date), { start: monthStart, end: monthEnd })),
    [orders, monthStart, monthEnd],
  );
  const previousOrders = useMemo(
    () => orders.filter(o => isWithinInterval(new Date(o.created_date), { start: previousRange.start, end: previousRange.end })),
    [orders, previousRange.start, previousRange.end],
  );
  const previousReturns = useMemo(
    () => returns.filter(r => isWithinInterval(new Date(r.created_date || r.updated_date || r.refund_date || 0), { start: previousRange.start, end: previousRange.end })),
    [returns, previousRange.start, previousRange.end],
  );

  // KPI sums for the current and previous period. We compute previous-period
  // values for refunds/commissions over the matching window — pendingCommissions
  // tracks anything pending right now (not period-bound), so its delta uses the
  // commission's own created_date as the time anchor.
  const totalRevenue = useMemo(() => monthOrders.reduce((s, o) => s + (o.total || 0), 0), [monthOrders]);
  const paidRevenue = useMemo(() => monthOrders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.total || 0), 0), [monthOrders]);
  const unpaidAmount = useMemo(() => monthOrders.filter(o => o.payment_status === 'unpaid').reduce((s, o) => s + (o.total || 0), 0), [monthOrders]);
  // Tracked for completeness; not surfaced as a KPI card today.
  // eslint-disable-next-line no-unused-vars
  const depositAmount = useMemo(() => monthOrders.filter(o => o.payment_status === 'deposit_paid').reduce((s, o) => s + (o.total || 0), 0), [monthOrders]);
  const refundedAmount = useMemo(
    () => returns.filter(r => r.refund_status === 'paid').reduce((s, r) => s + (r.refund_amount || 0), 0),
    [returns],
  );
  const pendingCommissions = useMemo(
    () => commissions.filter(c => c.status === 'pending').reduce((s, c) => s + (c.total_commission || 0), 0),
    [commissions],
  );

  // Previous-period values for the period-scoped KPIs.
  const prevRevenue = useMemo(() => previousOrders.reduce((s, o) => s + (o.total || 0), 0), [previousOrders]);
  const prevPaidRevenue = useMemo(() => previousOrders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + (o.total || 0), 0), [previousOrders]);
  const prevUnpaidAmount = useMemo(() => previousOrders.filter(o => o.payment_status === 'unpaid').reduce((s, o) => s + (o.total || 0), 0), [previousOrders]);
  const prevRefundedAmount = useMemo(
    () => previousReturns.filter(r => r.refund_status === 'paid').reduce((s, r) => s + (r.refund_amount || 0), 0),
    [previousReturns],
  );
  // Pending commissions is a "live now" KPI, not period-scoped, so we don't
  // compute a prior period for it (the card just won't show a delta badge).
  const computeDelta = (current, prior) => {
    if (!prior || !Number.isFinite(prior)) return null;
    return (current - prior) / prior;
  };

  const revenueBySource = useMemo(() => ([
    { name: 'חנות', value: monthOrders.filter(o => o.source === 'store').reduce((s, o) => s + (o.total || 0), 0) },
    { name: 'מוקד', value: monthOrders.filter(o => o.source === 'callcenter').reduce((s, o) => s + (o.total || 0), 0) },
    { name: 'דיגיטל', value: monthOrders.filter(o => o.source === 'digital').reduce((s, o) => s + (o.total || 0), 0) },
    { name: 'WhatsApp', value: monthOrders.filter(o => o.source === 'whatsapp').reduce((s, o) => s + (o.total || 0), 0) },
  ].filter(item => item.value > 0)), [monthOrders]);

  // דוח עמלות tab — date range + filtered rows + per-rep aggregate, all
  // memoized together so a tab switch / range change runs the work once.
  const reportData = useMemo(() => {
    const { start, end } = getDateRange(reportDateRange, reportStartDate, reportEndDate);
    const rows = commissions
      .filter((c) => {
        const date = new Date(c.created_date);
        if (!isWithinInterval(date, { start, end })) return false;
        return reportRep === 'all' || c.rep1 === reportRep || c.rep2 === reportRep;
      })
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

    const calculateAmount = (c) => {
      if (reportRep === 'all') return c.total_commission || 0;
      if (c.rep1 === reportRep) return c.rep1_amount || 0;
      if (c.rep2 === reportRep) return c.rep2_amount || 0;
      return 0;
    };

    const totalAmount = rows.reduce((s, c) => s + calculateAmount(c), 0);
    const pendingAmount = rows.filter((c) => c.status === 'pending').reduce((s, c) => s + calculateAmount(c), 0);
    const approvedAmount = rows.filter((c) => c.status === 'approved').reduce((s, c) => s + calculateAmount(c), 0);
    const paidAmount = rows.filter((c) => c.status === 'paid').reduce((s, c) => s + calculateAmount(c), 0);

    // Per-rep rollup is only meaningful when "all reps" is selected. Each
    // commission contributes rep1_amount to rep1 and rep2_amount to rep2,
    // so a row split between two reps shows up under both names.
    const repAggregate = new Map();
    const bumpRep = (email, amount, status) => {
      if (!email || !amount) return;
      const existing = repAggregate.get(email) || {
        email,
        count: 0,
        total: 0,
        pending: 0,
        approved: 0,
        paid: 0,
      };
      existing.count += 1;
      existing.total += amount;
      if (status === 'pending') existing.pending += amount;
      else if (status === 'approved') existing.approved += amount;
      else if (status === 'paid') existing.paid += amount;
      repAggregate.set(email, existing);
    };
    if (reportRep === 'all') {
      rows.forEach((c) => {
        bumpRep(c.rep1, c.rep1_amount || 0, c.status);
        bumpRep(c.rep2, c.rep2_amount || 0, c.status);
      });
    }
    const repRows = Array.from(repAggregate.values()).sort((a, b) => b.total - a.total);

    return { start, end, rows, totalAmount, pendingAmount, approvedAmount, paidAmount, repRows, calculateAmount };
  }, [commissions, reportDateRange, reportStartDate, reportEndDate, reportRep]);

  // Per-rep commission cards on the עמלות tab. Same logic as before but
  // hoisted out of the JSX IIFE so it doesn't recompute on every keystroke.
  const repCommissionStats = useMemo(() => {
    const acc = {};
    const bump = (email, amount, status) => {
      if (!email) return;
      if (!acc[email]) acc[email] = { pending: 0, approved: 0, paid: 0, total: 0 };
      acc[email].total += amount || 0;
      if (status === 'pending') acc[email].pending += amount || 0;
      else if (status === 'approved') acc[email].approved += amount || 0;
      else if (status === 'paid') acc[email].paid += amount || 0;
    };
    commissions
      .filter((c) => isWithinInterval(new Date(c.created_date), { start: monthStart, end: monthEnd }))
      .forEach((c) => {
        bump(c.rep1, c.rep1_amount, c.status);
        bump(c.rep2, c.rep2_amount, c.status);
      });
    return Object.entries(acc).sort((a, b) => b[1].total - a[1].total);
  }, [commissions, monthStart, monthEnd]);

  // Orders table — scoped to the page-level period, then filtered by the
  // FilterBar (search, payment_status, source). monthOrders already covers
  // the date range so we don't duplicate it here.
  const filteredOrders = useMemo(() => {
    const searchLower = filters.search ? filters.search.toLowerCase() : '';
    return monthOrders.filter((o) => {
      if (searchLower) {
        const matches =
          o.order_number?.toLowerCase().includes(searchLower) ||
          o.customer_name?.toLowerCase().includes(searchLower);
        if (!matches) return false;
      }
      if (filters.payment_status && filters.payment_status !== 'all' && o.payment_status !== filters.payment_status) return false;
      if (filters.source && filters.source !== 'all' && o.source !== filters.source) return false;
      return true;
    });
  }, [monthOrders, filters.search, filters.payment_status, filters.source]);

  const orderColumns = [
    {
      header: 'הזמנה',
      render: (row) => <span className="font-medium">#{row.order_number}</span>
    },
    {
      header: 'לקוח',
      render: (row) => <p className="font-medium">{row.customer_name}</p>
    },
    {
      header: 'סכום',
      render: (row) => <span className="font-semibold">{formatCurrency(row.total || 0)}</span>
    },
    {
      header: 'סטטוס',
      render: (row) => <StatusBadge status={row.payment_status} />
    },
    {
      header: 'מקור',
      render: (row) => <span className="text-sm">{row.source}</span>
    },
    {
      header: 'תאריך',
      render: (row) => <span className="text-sm text-muted-foreground">{format(new Date(row.created_date), 'dd/MM/yyyy')}</span>
    },
  ];

  const getRepName = (email) => getRepDisplayName(email, users) || '-';

  const commissionColumns = [
    {
      header: 'הזמנה',
      render: (row) => <span className="font-medium">#{row.order_number}</span>
    },
    {
      header: 'נציג ראשי',
      render: (row) => (
        <div>
          <p className="font-medium">{getRepName(row.rep1)}</p>
          <p className="text-sm text-muted-foreground">{row.rep1_percent}% = {formatCurrency(row.rep1_amount || 0)}</p>
        </div>
      )
    },
    {
      header: 'נציג משני',
      render: (row) => row.rep2 ? (
        <div>
          <p className="font-medium">{getRepName(row.rep2)}</p>
          <p className="text-sm text-muted-foreground">{row.rep2_percent}% = {formatCurrency(row.rep2_amount || 0)}</p>
        </div>
      ) : '-'
    },
    {
      header: 'סה"כ עמלה',
      render: (row) => <span className="font-semibold">{formatCurrency(row.total_commission || 0)}</span>
    },
    {
      header: 'סטטוס',
      render: (row) => (
        <div className="space-y-1">
          <StatusBadge status={row.status} />
          {row.approved_date && (
            <p className="text-xs text-muted-foreground">אושר: {format(new Date(row.approved_date), 'dd/MM/yyyy')}</p>
          )}
          {row.paid_date && (
            <p className="text-xs text-muted-foreground">שולם: {format(new Date(row.paid_date), 'dd/MM/yyyy')}</p>
          )}
        </div>
      )
    },
    {
      header: 'פעולות',
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.status === 'pending' && (
            <Button
              size="sm"
              variant="outline"
              className="text-green-600 border-green-200 hover:bg-green-50"
              onClick={(e) => {
                e.stopPropagation();
                approveCommissionMutation.mutate({
                  commissionId: row.id,
                  email: effectiveUser?.email,
                });
              }}
            >
              <Check className="h-4 w-4" />
              אשר
            </Button>
          )}
          {row.status === 'approved' && (
            <Button
              size="sm"
              variant="outline"
              className="text-primary border-primary/20 hover:bg-primary/5"
              onClick={(e) => {
                e.stopPropagation();
                markCommissionPaidMutation.mutate({ 
                  commissionId: row.id,
                  paidDate: new Date().toISOString().split('T')[0]
                });
              }}
            >
              סמן כשולם
            </Button>
          )}
        </div>
      )
    },
  ];

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת למסך פיננסים</p>
      </div>
    );
  }

  // Drilling into a KPI takes the admin to the matching tab with the relevant
  // payment_status pre-applied. Keeps the period filter intact so the orders
  // they see match the KPI total they clicked.
  const drillTo = (tab, paymentStatus = 'all') => {
    setActiveTab(tab);
    if (tab === 'orders') {
      setFilters((prev) => ({ ...prev, payment_status: paymentStatus }));
    }
  };

  // Hebrew labels mirror the on-screen filter chips so an admin who opens
  // the CSV in Excel sees the same vocabulary they see in the UI.
  const PAYMENT_STATUS_LABELS = {
    unpaid: 'לא שולם',
    deposit_paid: 'מקדמה',
    paid: 'שולם',
    refunded_partial: 'זיכוי חלקי',
    refunded_full: 'זיכוי מלא',
  };
  const COMMISSION_STATUS_LABELS = {
    pending: 'ממתין',
    approved: 'מאושר',
    paid: 'שולם',
  };
  const SOURCE_LABELS = { store: 'חנות', callcenter: 'מוקד', digital: 'דיגיטל', whatsapp: 'WhatsApp' };
  const todayStamp = format(new Date(), 'yyyy-MM-dd');

  const exportOrdersCsv = () => {
    if (filteredOrders.length === 0) {
      toast.error('אין נתונים לייצוא');
      return;
    }
    const csv = toCsv(filteredOrders, [
      { header: 'מספר הזמנה', value: (o) => o.order_number || '' },
      { header: 'לקוח', value: (o) => o.customer_name || '' },
      { header: 'סכום', value: (o) => Math.round(o.total || 0) },
      { header: 'סטטוס תשלום', value: (o) => PAYMENT_STATUS_LABELS[o.payment_status] || o.payment_status || '' },
      { header: 'מקור', value: (o) => SOURCE_LABELS[o.source] || o.source || '' },
      { header: 'תאריך', value: (o) => o.created_date ? format(new Date(o.created_date), 'dd/MM/yyyy') : '' },
    ]);
    downloadCsv(`orders_${dateRange}_${todayStamp}.csv`, csv);
  };

  const exportCommissionReportCsv = () => {
    if (reportData.rows.length === 0) {
      toast.error('אין נתונים לייצוא');
      return;
    }
    const detailCsv = toCsv(reportData.rows, [
      { header: 'תאריך', value: (c) => c.created_date ? format(new Date(c.created_date), 'dd/MM/yyyy') : '' },
      { header: 'מספר הזמנה', value: (c) => c.order_number || '' },
      { header: 'נציג ראשי', value: (c) => getRepName(c.rep1) },
      { header: '% נציג ראשי', value: (c) => c.rep1_percent || '' },
      { header: 'סכום נציג ראשי', value: (c) => Math.round(c.rep1_amount || 0) },
      { header: 'נציג משני', value: (c) => c.rep2 ? getRepName(c.rep2) : '' },
      { header: '% נציג משני', value: (c) => c.rep2_percent || '' },
      { header: 'סכום נציג משני', value: (c) => Math.round(c.rep2_amount || 0) },
      { header: 'סה"כ עמלה', value: (c) => Math.round(c.total_commission || 0) },
      { header: 'סטטוס', value: (c) => COMMISSION_STATUS_LABELS[c.status] || c.status || '' },
      { header: 'אושר בתאריך', value: (c) => c.approved_date ? format(new Date(c.approved_date), 'dd/MM/yyyy') : '' },
      { header: 'שולם בתאריך', value: (c) => c.paid_date ? format(new Date(c.paid_date), 'dd/MM/yyyy') : '' },
    ]);

    // Append the per-rep summary as a second section in the same file so
    // payroll has both the raw rows and the rollup in one download.
    const repCsv = toCsv(reportData.repRows, [
      { header: 'נציג', value: (r) => getRepName(r.email) },
      { header: 'מספר עמלות', value: (r) => r.count },
      { header: 'ממתין', value: (r) => Math.round(r.pending) },
      { header: 'מאושר', value: (r) => Math.round(r.approved) },
      { header: 'שולם', value: (r) => Math.round(r.paid) },
      { header: 'סה"כ', value: (r) => Math.round(r.total) },
    ]);

    const csv = [
      'דוח עמלות מפורט',
      detailCsv,
      '',
      'פילוח לפי נציג',
      repCsv,
    ].join('\r\n');
    downloadCsv(`commissions_report_${reportDateRange}_${todayStamp}.csv`, csv);
  };

  // Hebrew label for the comparison hint under each KPI ("vs last month" etc.)
  const periodCompareLabel =
    dateRange === 'today'
      ? 'מול אתמול'
      : dateRange === 'week'
      ? 'מול שבוע שעבר'
      : dateRange === 'month'
      ? 'מול חודש שעבר'
      : 'מול תקופה קודמת';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">כספים</h1>
          <p className="text-sm text-muted-foreground">סקירת הכנסות, תשלומים ועמלות</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">היום</SelectItem>
              <SelectItem value="week">השבוע</SelectItem>
              <SelectItem value="month">החודש</SelectItem>
              <SelectItem value="custom">טווח מותאם</SelectItem>
            </SelectContent>
          </Select>
          {dateRange === 'custom' && (
            <>
              <Input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-40"
              />
              <Input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-40"
              />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="הכנסות"
          value={formatCurrency(totalRevenue)}
          icon={TrendingUp}
          color="emerald"
          delta={computeDelta(totalRevenue, prevRevenue)}
          deltaPolarity="positive"
          deltaLabel={periodCompareLabel}
          onClick={() => drillTo('orders', 'all')}
        />
        <KPICard
          title="שולם"
          value={formatCurrency(paidRevenue)}
          icon={DollarSign}
          color="blue"
          delta={computeDelta(paidRevenue, prevPaidRevenue)}
          deltaPolarity="positive"
          deltaLabel={periodCompareLabel}
          onClick={() => drillTo('orders', 'paid')}
        />
        <KPICard
          title="לא שולם"
          value={formatCurrency(unpaidAmount)}
          icon={CreditCard}
          color="amber"
          delta={computeDelta(unpaidAmount, prevUnpaidAmount)}
          deltaPolarity="negative"
          deltaLabel={periodCompareLabel}
          onClick={() => drillTo('orders', 'unpaid')}
        />
        <KPICard
          title="זיכויים"
          value={formatCurrency(refundedAmount)}
          icon={RotateCcw}
          color="red"
          delta={computeDelta(refundedAmount, prevRefundedAmount)}
          deltaPolarity="negative"
          deltaLabel={periodCompareLabel}
          onClick={() => drillTo('orders', 'refunded_partial')}
        />
        <KPICard
          title="עמלות ממתינות"
          value={formatCurrency(pendingCommissions)}
          icon={Users}
          color="purple"
          onClick={() => drillTo('commissions')}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border w-full h-auto flex flex-col sm:flex-row">
          <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
          <TabsTrigger value="orders">הזמנות ({orders.length})</TabsTrigger>
          <TabsTrigger value="commissions">עמלות ({commissions.length})</TabsTrigger>
          <TabsTrigger value="report">דוח עמלות</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>הכנסות לפי מקור</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={revenueBySource}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                    >
                      {revenueBySource.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>סיכום תשלומים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-emerald-50 rounded-lg">
                <span className="font-medium text-emerald-700">שולם במלואו</span>
                <span className="text-xl font-bold text-emerald-700">{formatCurrency(paidRevenue)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-amber-50 rounded-lg">
                <span className="font-medium text-amber-700">מקדמות</span>
                <span className="text-xl font-bold text-amber-700">{formatCurrency(depositAmount)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-red-50 rounded-lg">
                <span className="font-medium text-red-700">ממתין לתשלום</span>
                <span className="text-xl font-bold text-red-700">{formatCurrency(unpaidAmount)}</span>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">סה"כ נטו</span>
                  <span className="text-2xl font-bold text-foreground">
                    {formatCurrency(paidRevenue - refundedAmount)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'orders' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <FilterBar
              filters={filterOptions}
              values={filters}
              onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
              onClear={() => setFilters({ search: '', payment_status: 'all', source: 'all' })}
              searchPlaceholder="חפש לפי מספר הזמנה או שם..."
            />
            <Button variant="outline" onClick={exportOrdersCsv} className="self-end sm:self-auto">
              <Download className="h-4 w-4 me-2" />
              ייצא CSV
            </Button>
          </div>
          <DataTable
            columns={orderColumns}
            data={filteredOrders}
            emptyMessage="לא נמצאו הזמנות"
            onRowClick={(row) => navigate(createPageUrl('OrderDetails') + `?id=${row.id}`)}
          />
        </>
      )}

      {activeTab === 'commissions' && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>עמלות לפי נציג</CardTitle>
              <p className="text-xs text-muted-foreground">משתמש בבורר התקופה שבראש העמוד</p>
            </CardHeader>
            <CardContent>
              {repCommissionStats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">אין עמלות בטווח שנבחר</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {repCommissionStats.map(([email, stats]) => (
                    <div key={email} className="p-4 border rounded-lg bg-white">
                      <h4 className="font-semibold text-foreground mb-3">{getRepName(email)}</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">סה"כ</span>
                          <span className="font-bold text-primary">{formatCurrency(stats.total)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-amber-600">ממתין</span>
                          <span className="font-medium">{formatCurrency(stats.pending)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-primary">מאושר</span>
                          <span className="font-medium">{formatCurrency(stats.approved)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-600">שולם</span>
                          <span className="font-medium">{formatCurrency(stats.paid)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          
          <DataTable
            columns={commissionColumns}
            data={commissions}
            emptyMessage="לא נמצאו עמלות"
          />
        </>
      )}

      {activeTab === 'report' && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>דוח עמלות מפורט</CardTitle>
                  <p className="text-xs text-muted-foreground">לטאב זה יש בורר תקופה משלו, נפרד מהבורר שבראש העמוד</p>
                </div>
                <Button variant="outline" onClick={exportCommissionReportCsv}>
                  <Download className="h-4 w-4 me-2" />
                  ייצא CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">תקופה לדוח:</label>
                  <Select value={reportDateRange} onValueChange={setReportDateRange}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">היום</SelectItem>
                      <SelectItem value="week">השבוע</SelectItem>
                      <SelectItem value="month">החודש</SelectItem>
                      <SelectItem value="custom">טווח מותאם</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {reportDateRange === 'custom' && (
                  <>
                    <Input
                      type="date"
                      value={reportStartDate}
                      onChange={(e) => setReportStartDate(e.target.value)}
                      className="w-40"
                      placeholder="מתאריך"
                    />
                    <Input
                      type="date"
                      value={reportEndDate}
                      onChange={(e) => setReportEndDate(e.target.value)}
                      className="w-40"
                      placeholder="עד תאריך"
                    />
                  </>
                )}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">נציג:</label>
                  <Select value={reportRep} onValueChange={setReportRep}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל הנציגים</SelectItem>
                      {users.filter(u => u.role === 'user' || u.role === 'admin').map(user => (
                        <SelectItem key={user.id} value={user.email}>
                          {user.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <DataTable
            columns={[
              {
                header: 'תאריך',
                render: (row) => <span className="text-sm">{format(new Date(row.created_date), 'dd/MM/yyyy')}</span>
              },
              {
                header: 'הזמנה',
                render: (row) => <span className="font-medium">#{row.order_number}</span>
              },
              {
                header: 'נציג',
                render: (row) => {
                  const isRep1Match = reportRep === 'all' || row.rep1 === reportRep;
                  const isRep2Match = reportRep === 'all' || row.rep2 === reportRep;
                  
                  return (
                    <div className="space-y-1">
                      {(isRep1Match || reportRep === 'all') && row.rep1 && (
                        <div className={reportRep === row.rep1 ? 'font-semibold' : ''}>
                          <p className="text-sm">{getRepName(row.rep1)}</p>
                          <p className="text-xs text-muted-foreground">{row.rep1_percent}%</p>
                        </div>
                      )}
                      {(isRep2Match || reportRep === 'all') && row.rep2 && (
                        <div className={reportRep === row.rep2 ? 'font-semibold' : ''}>
                          <p className="text-sm">{getRepName(row.rep2)}</p>
                          <p className="text-xs text-muted-foreground">{row.rep2_percent}%</p>
                        </div>
                      )}
                    </div>
                  );
                }
              },
              {
                header: 'סכום עמלה',
                render: (row) => {
                  const amount =
                    reportRep === 'all'
                      ? row.total_commission || 0
                      : row.rep1 === reportRep
                      ? row.rep1_amount || 0
                      : row.rep2 === reportRep
                      ? row.rep2_amount || 0
                      : null;
                  return amount === null ? '-' : <span className="font-semibold">{formatCurrency(amount)}</span>;
                },
              },
              {
                header: 'סטטוס',
                render: (row) => <StatusBadge status={row.status} />
              },
              {
                header: 'אושר בתאריך',
                render: (row) => row.approved_date ? (
                  <span className="text-sm text-muted-foreground">{format(new Date(row.approved_date), 'dd/MM/yyyy')}</span>
                ) : '-'
              },
              {
                header: 'שולם בתאריך',
                render: (row) => row.paid_date ? (
                  <span className="text-sm text-muted-foreground">{format(new Date(row.paid_date), 'dd/MM/yyyy')}</span>
                ) : '-'
              },
            ]}
            data={reportData.rows}
            emptyMessage="לא נמצאו עמלות בטווח המבוקש"
          />

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>סיכום</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-4 gap-4">
                <div className="p-4 bg-primary/5 rounded-lg">
                  <p className="text-sm text-primary mb-1">סה"כ עמלות</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(reportData.totalAmount)}</p>
                </div>
                <div className="p-4 bg-amber-50 rounded-lg">
                  <p className="text-sm text-amber-700 mb-1">ממתינות</p>
                  <p className="text-2xl font-bold text-amber-900">{formatCurrency(reportData.pendingAmount)}</p>
                </div>
                <div className="p-4 bg-primary/5 rounded-lg">
                  <p className="text-sm text-primary mb-1">מאושרות</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(reportData.approvedAmount)}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-700 mb-1">שולמו</p>
                  <p className="text-2xl font-bold text-green-900">{formatCurrency(reportData.paidAmount)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {reportRep === 'all' && reportData.repRows.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>פילוח לפי נציג</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={[
                    { header: 'נציג', render: (rep) => <span className="font-medium text-foreground">{getRepName(rep.email)}</span> },
                    { header: 'עמלות', render: (rep) => <span className="text-muted-foreground">{rep.count}</span> },
                    { header: 'ממתינות', render: (rep) => <span className="text-amber-700">{formatCurrency(rep.pending)}</span> },
                    { header: 'מאושרות', render: (rep) => <span>{formatCurrency(rep.approved)}</span> },
                    { header: 'שולמו', render: (rep) => <span className="text-green-700">{formatCurrency(rep.paid)}</span> },
                    { header: 'סה"כ', render: (rep) => <span className="font-semibold text-primary">{formatCurrency(rep.total)}</span> },
                  ]}
                  data={reportData.repRows}
                  emptyMessage="אין נתונים"
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
