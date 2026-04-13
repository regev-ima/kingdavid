import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import KPICard from '@/components/shared/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, CreditCard, RotateCcw, Users, Check } from "lucide-react";
import { format, startOfMonth, endOfMonth, isWithinInterval, startOfDay, endOfDay, startOfWeek, endOfWeek } from '@/lib/safe-date-fns';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { toast } from 'sonner';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';

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

  // Calculate KPIs
  const now = new Date();
  
  // Calculate date range based on selection
  let rangeStart, rangeEnd;
  switch (dateRange) {
    case 'today':
      rangeStart = startOfDay(now);
      rangeEnd = endOfDay(now);
      break;
    case 'week':
      rangeStart = startOfWeek(now, { weekStartsOn: 0 });
      rangeEnd = endOfWeek(now, { weekStartsOn: 0 });
      break;
    case 'month':
      rangeStart = startOfMonth(now);
      rangeEnd = endOfMonth(now);
      break;
    case 'custom':
      rangeStart = customStartDate ? new Date(customStartDate) : startOfMonth(now);
      rangeEnd = customEndDate ? new Date(customEndDate) : endOfMonth(now);
      break;
    default:
      rangeStart = startOfMonth(now);
      rangeEnd = endOfMonth(now);
  }
  
  const monthStart = rangeStart;
  const monthEnd = rangeEnd;

  const monthOrders = orders.filter(o => {
    const orderDate = new Date(o.created_date);
    return isWithinInterval(orderDate, { start: monthStart, end: monthEnd });
  });

  const totalRevenue = monthOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const paidRevenue = monthOrders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + (o.total || 0), 0);
  const unpaidAmount = monthOrders.filter(o => o.payment_status === 'unpaid').reduce((sum, o) => sum + (o.total || 0), 0);
  const depositAmount = monthOrders.filter(o => o.payment_status === 'deposit_paid').reduce((sum, o) => sum + (o.total || 0), 0);
  
  const refundedAmount = returns
    .filter(r => r.refund_status === 'paid')
    .reduce((sum, r) => sum + (r.refund_amount || 0), 0);

  const pendingCommissions = commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + (c.total_commission || 0), 0);

  // Chart data - revenue by source
  const revenueBySource = [
    { name: 'חנות', value: monthOrders.filter(o => o.source === 'store').reduce((s, o) => s + (o.total || 0), 0) },
    { name: 'מוקד', value: monthOrders.filter(o => o.source === 'callcenter').reduce((s, o) => s + (o.total || 0), 0) },
    { name: 'דיגיטל', value: monthOrders.filter(o => o.source === 'digital').reduce((s, o) => s + (o.total || 0), 0) },
    { name: 'WhatsApp', value: monthOrders.filter(o => o.source === 'whatsapp').reduce((s, o) => s + (o.total || 0), 0) },
  ].filter(item => item.value > 0);

  // Filter orders
  let filteredOrders = orders;
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredOrders = filteredOrders.filter(o =>
      o.order_number?.toLowerCase().includes(searchLower) ||
      o.customer_name?.toLowerCase().includes(searchLower)
    );
  }
  if (filters.payment_status && filters.payment_status !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.payment_status === filters.payment_status);
  }
  if (filters.source && filters.source !== 'all') {
    filteredOrders = filteredOrders.filter(o => o.source === filters.source);
  }

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
      render: (row) => <span className="font-semibold">₪{row.total?.toLocaleString()}</span>
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

  const getRepName = (email) => {
    const user = users.find(u => u.email === email);
    return user?.full_name || email?.split('@')[0] || '-';
  };

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
          <p className="text-sm text-muted-foreground">{row.rep1_percent}% = ₪{row.rep1_amount?.toLocaleString()}</p>
        </div>
      )
    },
    {
      header: 'נציג משני',
      render: (row) => row.rep2 ? (
        <div>
          <p className="font-medium">{getRepName(row.rep2)}</p>
          <p className="text-sm text-muted-foreground">{row.rep2_percent}% = ₪{row.rep2_amount?.toLocaleString()}</p>
        </div>
      ) : '-'
    },
    {
      header: 'סה"כ עמלה',
      render: (row) => <span className="font-semibold">₪{row.total_commission?.toLocaleString()}</span>
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
                  email: users[0]?.email 
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">כספים</h1>
        <p className="text-sm text-muted-foreground">סקירת הכנסות, תשלומים ועמלות</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="הכנסות החודש"
          value={`₪${totalRevenue.toLocaleString()}`}
          icon={TrendingUp}
          color="emerald"
        />
        <KPICard
          title="שולם"
          value={`₪${paidRevenue.toLocaleString()}`}
          icon={DollarSign}
          color="blue"
        />
        <KPICard
          title="לא שולם"
          value={`₪${unpaidAmount.toLocaleString()}`}
          icon={CreditCard}
          color="amber"
        />
        <KPICard
          title="זיכויים"
          value={`₪${refundedAmount.toLocaleString()}`}
          icon={RotateCcw}
          color="red"
        />
        <KPICard
          title="עמלות ממתינות"
          value={`₪${pendingCommissions.toLocaleString()}`}
          icon={Users}
          color="purple"
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
                      label={({ name, value }) => `${name}: ₪${value.toLocaleString()}`}
                    >
                      {revenueBySource.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `₪${value.toLocaleString()}`} />
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
                <span className="text-xl font-bold text-emerald-700">₪{paidRevenue.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-amber-50 rounded-lg">
                <span className="font-medium text-amber-700">מקדמות</span>
                <span className="text-xl font-bold text-amber-700">₪{depositAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-red-50 rounded-lg">
                <span className="font-medium text-red-700">ממתין לתשלום</span>
                <span className="text-xl font-bold text-red-700">₪{unpaidAmount.toLocaleString()}</span>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">סה"כ נטו</span>
                  <span className="text-2xl font-bold text-foreground">
                    ₪{(paidRevenue - refundedAmount).toLocaleString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'orders' && (
        <>
          <FilterBar
            filters={filterOptions}
            values={filters}
            onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
            onClear={() => setFilters({ search: '', payment_status: 'all', source: 'all' })}
            searchPlaceholder="חפש לפי מספר הזמנה או שם..."
          />
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <CardTitle>עמלות לפי נציג</CardTitle>
                <div className="flex items-center gap-3">
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
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {(() => {
                  const repCommissions = {};
                  commissions
                    .filter(c => {
                      const date = new Date(c.created_date);
                      return isWithinInterval(date, { start: monthStart, end: monthEnd });
                    })
                    .forEach(c => {
                      // Rep1
                      if (c.rep1) {
                        if (!repCommissions[c.rep1]) {
                          repCommissions[c.rep1] = { pending: 0, approved: 0, paid: 0, total: 0 };
                        }
                        repCommissions[c.rep1].total += c.rep1_amount || 0;
                        if (c.status === 'pending') repCommissions[c.rep1].pending += c.rep1_amount || 0;
                        if (c.status === 'approved') repCommissions[c.rep1].approved += c.rep1_amount || 0;
                        if (c.status === 'paid') repCommissions[c.rep1].paid += c.rep1_amount || 0;
                      }
                      // Rep2
                      if (c.rep2) {
                        if (!repCommissions[c.rep2]) {
                          repCommissions[c.rep2] = { pending: 0, approved: 0, paid: 0, total: 0 };
                        }
                        repCommissions[c.rep2].total += c.rep2_amount || 0;
                        if (c.status === 'pending') repCommissions[c.rep2].pending += c.rep2_amount || 0;
                        if (c.status === 'approved') repCommissions[c.rep2].approved += c.rep2_amount || 0;
                        if (c.status === 'paid') repCommissions[c.rep2].paid += c.rep2_amount || 0;
                      }
                    });

                  return Object.entries(repCommissions)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([email, stats]) => (
                      <div key={email} className="p-4 border rounded-lg bg-white">
                        <h4 className="font-semibold text-foreground mb-3">{getRepName(email)}</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">סה"כ</span>
                            <span className="font-bold text-primary">₪{stats.total.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-amber-600">ממתין</span>
                            <span className="font-medium">₪{stats.pending.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-primary">מאושר</span>
                            <span className="font-medium">₪{stats.approved.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-green-600">שולם</span>
                            <span className="font-medium">₪{stats.paid.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ));
                })()}
              </div>
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
              <CardTitle>דוח עמלות מפורט</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">תקופה:</label>
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
                  if (reportRep === 'all') {
                    return <span className="font-semibold">₪{row.total_commission?.toLocaleString()}</span>;
                  } else if (row.rep1 === reportRep) {
                    return <span className="font-semibold">₪{row.rep1_amount?.toLocaleString()}</span>;
                  } else if (row.rep2 === reportRep) {
                    return <span className="font-semibold">₪{row.rep2_amount?.toLocaleString()}</span>;
                  }
                  return '-';
                }
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
            data={(() => {
              // Calculate date range
              let start, end;
              const now = new Date();
              
              switch (reportDateRange) {
                case 'today':
                  start = startOfDay(now);
                  end = endOfDay(now);
                  break;
                case 'week':
                  start = startOfWeek(now, { weekStartsOn: 0 });
                  end = endOfWeek(now, { weekStartsOn: 0 });
                  break;
                case 'month':
                  start = startOfMonth(now);
                  end = endOfMonth(now);
                  break;
                case 'custom':
                  start = reportStartDate ? new Date(reportStartDate) : startOfMonth(now);
                  end = reportEndDate ? new Date(reportEndDate) : endOfMonth(now);
                  break;
                default:
                  start = startOfMonth(now);
                  end = endOfMonth(now);
              }

              // Filter commissions
              return commissions
                .filter(c => {
                  const date = new Date(c.created_date);
                  const dateMatch = isWithinInterval(date, { start, end });
                  const repMatch = reportRep === 'all' || c.rep1 === reportRep || c.rep2 === reportRep;
                  return dateMatch && repMatch;
                })
                .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
            })()}
            emptyMessage="לא נמצאו עמלות בטווח המבוקש"
          />

          {/* Summary */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>סיכום</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-4 gap-4">
                {(() => {
                  let start, end;
                  const now = new Date();
                  
                  switch (reportDateRange) {
                    case 'today':
                      start = startOfDay(now);
                      end = endOfDay(now);
                      break;
                    case 'week':
                      start = startOfWeek(now, { weekStartsOn: 0 });
                      end = endOfWeek(now, { weekStartsOn: 0 });
                      break;
                    case 'month':
                      start = startOfMonth(now);
                      end = endOfMonth(now);
                      break;
                    case 'custom':
                      start = reportStartDate ? new Date(reportStartDate) : startOfMonth(now);
                      end = reportEndDate ? new Date(reportEndDate) : endOfMonth(now);
                      break;
                    default:
                      start = startOfMonth(now);
                      end = endOfMonth(now);
                  }

                  const filtered = commissions.filter(c => {
                    const date = new Date(c.created_date);
                    const dateMatch = isWithinInterval(date, { start, end });
                    const repMatch = reportRep === 'all' || c.rep1 === reportRep || c.rep2 === reportRep;
                    return dateMatch && repMatch;
                  });

                  const calculateAmount = (c) => {
                    if (reportRep === 'all') return c.total_commission || 0;
                    if (c.rep1 === reportRep) return c.rep1_amount || 0;
                    if (c.rep2 === reportRep) return c.rep2_amount || 0;
                    return 0;
                  };

                  const totalAmount = filtered.reduce((sum, c) => sum + calculateAmount(c), 0);
                  const pendingAmount = filtered.filter(c => c.status === 'pending').reduce((sum, c) => sum + calculateAmount(c), 0);
                  const approvedAmount = filtered.filter(c => c.status === 'approved').reduce((sum, c) => sum + calculateAmount(c), 0);
                  const paidAmount = filtered.filter(c => c.status === 'paid').reduce((sum, c) => sum + calculateAmount(c), 0);

                  return (
                    <>
                      <div className="p-4 bg-primary/5 rounded-lg">
                        <p className="text-sm text-primary mb-1">סה"כ עמלות</p>
                        <p className="text-2xl font-bold text-foreground">₪{totalAmount.toLocaleString()}</p>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-lg">
                        <p className="text-sm text-amber-700 mb-1">ממתינות</p>
                        <p className="text-2xl font-bold text-amber-900">₪{pendingAmount.toLocaleString()}</p>
                      </div>
                      <div className="p-4 bg-primary/5 rounded-lg">
                        <p className="text-sm text-primary mb-1">מאושרות</p>
                        <p className="text-2xl font-bold text-foreground">₪{approvedAmount.toLocaleString()}</p>
                      </div>
                      <div className="p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-green-700 mb-1">שולמו</p>
                        <p className="text-2xl font-bold text-green-900">₪{paidAmount.toLocaleString()}</p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
