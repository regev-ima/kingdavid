import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Factory,
  Truck,
  Headphones,
  TrendingUp,
  TrendingDown,
  Calendar,
  BarChart3,
  Download,
} from "lucide-react";
import { format, differenceInHours, differenceInDays, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { fetchAllList } from '@/lib/base44Pagination';

export default function OperationalReports() {
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(now), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(now), 'yyyy-MM-dd'));

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => fetchAllList(base44.entities.Order, '-created_date'),
  });

  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => fetchAllList(base44.entities.DeliveryShipment, '-created_date'),
  });

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => fetchAllList(base44.entities.SupportTicket, '-created_date'),
  });

  const filteredData = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59);

    return {
      orders: orders.filter(o => {
        const date = new Date(o.created_date);
        return date >= from && date <= to;
      }),
      deliveries: deliveries.filter(d => {
        const date = new Date(d.created_date);
        return date >= from && date <= to;
      }),
      tickets: tickets.filter(t => {
        const date = new Date(t.created_date);
        return date >= from && date <= to;
      }),
    };
  }, [orders, deliveries, tickets, dateFrom, dateTo]);

  // Production Time Analysis
  const productionMetrics = useMemo(() => {
    const completedOrders = filteredData.orders.filter(o => 
      o.production_status === 'ready' && o.created_date && o.updated_date
    );

    if (completedOrders.length === 0) {
      return { avgDays: 0, totalOrders: 0, onTimeCount: 0, delayedCount: 0 };
    }

    const productionTimes = completedOrders.map(o => {
      const start = new Date(o.created_date);
      const end = new Date(o.updated_date);
      return differenceInDays(end, start);
    });

    const avgDays = Math.round(productionTimes.reduce((a, b) => a + b, 0) / productionTimes.length);
    const onTimeCount = productionTimes.filter(d => d <= 7).length;
    const delayedCount = productionTimes.filter(d => d > 7).length;

    return {
      avgDays,
      totalOrders: completedOrders.length,
      onTimeCount,
      delayedCount,
      onTimePercent: Math.round((onTimeCount / completedOrders.length) * 100),
    };
  }, [filteredData.orders]);

  // Delivery Time Analysis
  const deliveryMetrics = useMemo(() => {
    const completedDeliveries = filteredData.deliveries.filter(d => 
      d.status === 'delivered' && d.scheduled_date && d.delivered_date
    );

    if (completedDeliveries.length === 0) {
      return { avgDays: 0, totalDeliveries: 0, onTimeCount: 0, failedCount: 0 };
    }

    const deliveryTimes = completedDeliveries.map(d => {
      const scheduled = new Date(d.scheduled_date);
      const delivered = new Date(d.delivered_date);
      return differenceInDays(delivered, scheduled);
    });

    const avgDays = Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length * 10) / 10;
    const onTimeCount = deliveryTimes.filter(d => d <= 1).length;
    const failedCount = filteredData.deliveries.filter(d => d.status === 'failed').length;

    return {
      avgDays,
      totalDeliveries: completedDeliveries.length,
      onTimeCount,
      failedCount,
      onTimePercent: Math.round((onTimeCount / completedDeliveries.length) * 100),
    };
  }, [filteredData.deliveries]);

  // Support Ticket Time Analysis
  const supportMetrics = useMemo(() => {
    const resolvedTickets = filteredData.tickets.filter(t => 
      t.status === 'resolved' || t.status === 'closed'
    );

    if (resolvedTickets.length === 0) {
      return { avgHours: 0, totalTickets: 0, under24hCount: 0, over48hCount: 0 };
    }

    const resolutionTimes = resolvedTickets.map(t => {
      const created = new Date(t.created_date);
      const resolved = new Date(t.updated_date);
      return differenceInHours(resolved, created);
    });

    const avgHours = Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length);
    const under24hCount = resolutionTimes.filter(h => h <= 24).length;
    const over48hCount = resolutionTimes.filter(h => h > 48).length;

    return {
      avgHours,
      totalTickets: resolvedTickets.length,
      under24hCount,
      over48hCount,
      under24hPercent: Math.round((under24hCount / resolvedTickets.length) * 100),
    };
  }, [filteredData.tickets]);

  // Chart Data
  const productionStatusData = useMemo(() => {
    const statusCounts = {};
    filteredData.orders.forEach(o => {
      const status = o.production_status || 'not_started';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const labels = {
      not_started: 'לא התחיל',
      materials_check: 'בדיקת חומרים',
      in_production: 'בייצור',
      qc: 'בקרת איכות',
      ready: 'מוכן',
    };

    return Object.entries(statusCounts).map(([status, count]) => ({
      status: labels[status] || status,
      count,
    }));
  }, [filteredData.orders]);

  const deliveryStatusData = useMemo(() => {
    const statusCounts = {};
    filteredData.deliveries.forEach(d => {
      const status = d.status || 'need_scheduling';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const labels = {
      need_scheduling: 'ממתין לתזמון',
      scheduled: 'מתוזמן',
      dispatched: 'יצא למשלוח',
      in_transit: 'בדרך',
      delivered: 'נמסר',
      failed: 'נכשל',
      returned: 'הוחזר',
    };

    return Object.entries(statusCounts).map(([status, count]) => ({
      status: labels[status] || status,
      count,
    }));
  }, [filteredData.deliveries]);

  const supportPriorityData = useMemo(() => {
    const priorityCounts = {};
    filteredData.tickets.forEach(t => {
      const priority = t.priority || 'medium';
      priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
    });

    const labels = {
      low: 'נמוך',
      medium: 'בינוני',
      high: 'גבוה',
      urgent: 'דחוף',
    };

    return Object.entries(priorityCounts).map(([priority, count]) => ({
      priority: labels[priority] || priority,
      count,
    }));
  }, [filteredData.tickets]);

  const isLoading = ordersLoading || deliveriesLoading || ticketsLoading;

  if (isLoading) {
    return <div className="text-center py-12">טוען נתונים...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">דוחות תפעוליים</h1>
          <p className="text-muted-foreground">ניתוח זמני ייצור, משלוח ושירות</p>
        </div>
        <Button variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          ייצא לאקסל
        </Button>
      </div>

      {/* Date Filter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            בחר תקופה
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
            <div className="flex-1 w-full">
              <Label>מתאריך</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="flex-1 w-full">
              <Label>עד תאריך</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <Button
              onClick={() => {
                setDateFrom(format(startOfMonth(now), 'yyyy-MM-dd'));
                setDateTo(format(endOfMonth(now), 'yyyy-MM-dd'));
              }}
              variant="outline"
              className="w-full sm:w-auto"
            >
              החודש הנוכחי
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Production Metrics */}
        <Card className="border-l-4 border-l-primary">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Factory className="h-5 w-5 text-primary" />
              זמני ייצור
            </CardTitle>
            <CardDescription>ניתוח זמן ממוצע להשלמת ייצור</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">{productionMetrics.avgDays}</span>
                <span className="text-muted-foreground">ימים בממוצע</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                מתוך {productionMetrics.totalOrders} הזמנות שהושלמו
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">בזמן (עד 7 ימים)</span>
                <Badge className="bg-green-100 text-green-800">
                  {productionMetrics.onTimePercent}%
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">בזמן: {productionMetrics.onTimeCount}</span>
                <span className="text-muted-foreground">באיחור: {productionMetrics.delayedCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delivery Metrics */}
        <Card className="border-l-4 border-l-primary">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              זמני משלוח
            </CardTitle>
            <CardDescription>ניתוח זמן ממוצע מתזמון למסירה</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary">{deliveryMetrics.avgDays}</span>
                <span className="text-muted-foreground">ימים בממוצע</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                מתוך {deliveryMetrics.totalDeliveries} משלוחים
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">בזמן (עד יום)</span>
                <Badge className="bg-green-100 text-green-800">
                  {deliveryMetrics.onTimePercent}%
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">הצליחו: {deliveryMetrics.onTimeCount}</span>
                <span className="text-red-600">נכשלו: {deliveryMetrics.failedCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Support Metrics */}
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Headphones className="h-5 w-5 text-purple-600" />
              זמני שירות
            </CardTitle>
            <CardDescription>ניתוח זמן ממוצע לפתרון טיקט</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-purple-600">{supportMetrics.avgHours}</span>
                <span className="text-muted-foreground">שעות בממוצע</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                מתוך {supportMetrics.totalTickets} טיקטים שנפתרו
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">תוך 24 שעות</span>
                <Badge className="bg-green-100 text-green-800">
                  {supportMetrics.under24hPercent}%
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">עד 24 שעות: {supportMetrics.under24hCount}</span>
                <span className="text-muted-foreground">מעל 48 שעות: {supportMetrics.over48hCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Production Status Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">התפלגות סטטוס ייצור</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={productionStatusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Delivery Status Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">התפלגות סטטוס משלוחים</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={deliveryStatusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Support Priority Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">התפלגות קריאות שירות לפי עדיפות</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={supportPriorityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="priority" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}