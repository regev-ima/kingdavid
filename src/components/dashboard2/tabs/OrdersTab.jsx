import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ChevronLeft, ShoppingCart } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import MiniKPI from '../MiniKPI';

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

export default function OrdersTab({ current = {} }) {
  const trend = current.revenueTrend || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="מס׳ הזמנות" value={current.ordersCount} color="emerald" />
        <MiniKPI label="סכום מכירות" value={formatCurrency(current.revenue)} color="emerald" />
        <MiniKPI label="ממוצע הזמנה" value={formatCurrency(current.avgOrder)} color="indigo" />
        <MiniKPI label="ממתינות לתשלום" value={current.unpaidOrders} color="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniKPI label="שולמו" value={current.paidOrders} color="emerald" />
        <MiniKPI label="בייצור" value={current.inProduction} color="violet" />
        <MiniKPI label="נמסרו" value={current.deliveredOrders} color="cyan" />
      </div>

      <Card className="border-border shadow-card">
        <CardHeader className="pb-2 border-b border-border/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-emerald-600" />
              מגמת הכנסות יומית
            </CardTitle>
            <Link to={createPageUrl('Orders')}>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                לרשימת ההזמנות
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {trend.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              אין נתונים בטווח
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₪${(v / 1000).toFixed(0)}K`} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => [formatCurrency(value), 'הכנסה']}
                  />
                  <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
