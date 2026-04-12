import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import KPICard from '@/components/shared/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StatusBadge from '@/components/shared/StatusBadge';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessFactoryWorkspace } from '@/lib/rbac';
import {
  Factory,
  ShoppingCart,
  Package,
  Truck,
  AlertTriangle,
  Clock,
  CheckCircle,
  RefreshCw,
  ArrowRight,
  Headphones,
  RotateCcw,
} from "lucide-react";
import { format, differenceInDays } from 'date-fns';
import { fetchAllList } from '@/lib/base44Pagination';

export default function FactoryDashboard() {
  const { getEffectiveUser } = useImpersonation();
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        const effectiveUser = getEffectiveUser(userData);
        
        // Redirect BEFORE setting state
        if (!canAccessFactoryWorkspace(effectiveUser)) {
          navigate(createPageUrl('Dashboard'));
          return;
        }
        
        setUser(userData);
        setIsCheckingAuth(false);
      } catch (err) {
        setIsCheckingAuth(false);
      }
    };
    fetchUser();
  }, [getEffectiveUser, navigate]);

  const { data: orders = [], refetch: refetchOrders } = useQuery({
    queryKey: ['orders'],
    queryFn: () => fetchAllList(base44.entities.Order, '-created_date'),
  });

  const { data: inventory = [], refetch: refetchInventory } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => fetchAllList(base44.entities.InventoryItem),
  });

  const { data: deliveries = [] } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => fetchAllList(base44.entities.DeliveryShipment, '-created_date'),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => fetchAllList(base44.entities.SupportTicket, '-created_date'),
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['returns'],
    queryFn: () => fetchAllList(base44.entities.ReturnRequest, '-created_date'),
  });

  // KPI Calculations
  const ordersInProduction = orders.filter(o => 
    ['not_started', 'materials_check', 'in_production', 'qc'].includes(o.production_status)
  );

  const ordersReady = orders.filter(o => o.production_status === 'ready');

  const urgentOrders = orders.filter(o => {
    if (!o.created_date) return false;
    const daysOld = differenceInDays(new Date(), new Date(o.created_date));
    return daysOld > 7 && o.production_status !== 'ready';
  });

  const lowStockItems = inventory.filter(item => {
    if (!item.min_threshold) return false;
    return (item.qty_on_hand || 0) <= item.min_threshold;
  });

  const pendingDeliveries = deliveries.filter(d => 
    ['need_scheduling', 'scheduled', 'dispatched', 'in_transit'].includes(d.status)
  );

  const openTickets = tickets.filter(t => 
    ['open', 'in_progress'].includes(t.status)
  );

  const activeReturns = returns.filter(r => 
    !['closed', 'rejected'].includes(r.status)
  );

  const handleRefresh = () => {
    refetchOrders();
    refetchInventory();
    setLastUpdated(new Date());
  };

  if (isCheckingAuth || !user) {
    return <div className="text-center py-12">טוען...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">דשבורד מפעל</h1>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <Clock className="h-4 w-4" />
            עדכון אחרון: {format(lastUpdated, 'HH:mm:ss')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 me-2" />
          רענן
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="בייצור"
          value={ordersInProduction.length}
          subtitle="הזמנות פעילות"
          icon={Factory}
          color="blue"
          onClick={() => navigate(createPageUrl('Factory'))}
        />
        <KPICard
          title="מוכנות לאיסוף"
          value={ordersReady.length}
          icon={CheckCircle}
          color="emerald"
          onClick={() => navigate(createPageUrl('Factory'))}
        />
        <KPICard
          title="דחופות"
          value={urgentOrders.length}
          subtitle="מעל 7 ימים"
          icon={AlertTriangle}
          color="red"
        />
        <KPICard
          title="מלאי נמוך"
          value={lowStockItems.length}
          subtitle="פריטים"
          icon={Package}
          color="amber"
          onClick={() => navigate(createPageUrl('Inventory'))}
        />
      </div>

      {/* Quick Access Modules */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link to={createPageUrl('Factory')}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-medium">ייצור</CardTitle>
              <Factory className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{ordersInProduction.length}</div>
              <p className="text-xs text-muted-foreground mt-1">הזמנות פעילות</p>
            </CardContent>
          </Card>
        </Link>

        <Link to={createPageUrl('Inventory')}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-purple-500">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-medium">מלאי</CardTitle>
              <Package className="h-5 w-5 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inventory.length}</div>
              <p className="text-xs text-muted-foreground mt-1">פריטים במלאי</p>
            </CardContent>
          </Card>
        </Link>

        <Link to={createPageUrl('Deliveries')}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-green-500">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-medium">משלוחים</CardTitle>
              <Truck className="h-5 w-5 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingDeliveries.length}</div>
              <p className="text-xs text-muted-foreground mt-1">ממתינים</p>
            </CardContent>
          </Card>
        </Link>

        <Link to={createPageUrl('Orders')}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-medium">הזמנות</CardTitle>
              <ShoppingCart className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{orders.length}</div>
              <p className="text-xs text-muted-foreground mt-1">סה״כ הזמנות</p>
            </CardContent>
          </Card>
        </Link>

        <Link to={createPageUrl('Support')}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-orange-500">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-medium">שירות לקוחות</CardTitle>
              <Headphones className="h-5 w-5 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{openTickets.length}</div>
              <p className="text-xs text-muted-foreground mt-1">פניות פתוחות</p>
            </CardContent>
          </Card>
        </Link>

        <Link to={createPageUrl('Returns')}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-rose-500">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-medium">החזרות</CardTitle>
              <RotateCcw className="h-5 w-5 text-rose-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeReturns.length}</div>
              <p className="text-xs text-muted-foreground mt-1">החזרות פעילות</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Urgent Orders Alert */}
      {urgentOrders.length > 0 && (
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              הזמנות דחופות - מעל 7 ימים
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {urgentOrders.slice(0, 6).map(order => {
                const daysOld = differenceInDays(new Date(), new Date(order.created_date));
                return (
                  <div key={order.id} className="p-3 bg-white rounded-lg border border-red-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">#{order.order_number}</span>
                      <Badge className="bg-red-100 text-red-800">
                        {daysOld} ימים
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground/80">{order.customer_name}</p>
                    <div className="mt-2">
                      <StatusBadge status={order.production_status} />
                    </div>
                    <Link to={createPageUrl('OrderDetails') + `?id=${order.id}`}>
                      <Button size="sm" className="w-full mt-2">
                        פרטים
                        <ArrowRight className="h-3 w-3 mr-1" />
                      </Button>
                    </Link>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-600" />
              מלאי נמוך - נדרש מילוי
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {lowStockItems.slice(0, 8).map(item => (
                <div key={item.id} className="p-3 bg-white rounded-lg border border-amber-200">
                  <p className="font-medium text-sm">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.sku}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-lg font-bold text-amber-600">
                      {item.qty_on_hand || 0}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      מינ: {item.min_threshold}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
