import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  CreditCard,
  CheckCircle2,
  Factory,
  Package,
  Truck,
} from 'lucide-react';

const fmtCurrency = (v) => `₪${Number(v || 0).toLocaleString()}`;
const fmtNumber = (v) => Number(v || 0).toLocaleString();

// Icon-chip tones as fully static classes (no string interpolation) so
// Tailwind keeps them through the production purge.
const TONE = {
  emerald: 'bg-emerald-100 text-emerald-600',
  blue: 'bg-blue-100 text-blue-600',
  indigo: 'bg-indigo-100 text-indigo-600',
  amber: 'bg-amber-100 text-amber-600',
  violet: 'bg-violet-100 text-violet-600',
  cyan: 'bg-cyan-100 text-cyan-600',
  slate: 'bg-slate-100 text-slate-600',
};

// Orders period snapshot, rendered with the platform's standard stat-card
// look. Each card is clickable and IS the status filter for the list below
// (replacing the old status tabs). `filterKey` is the activeTab value the
// click selects; the three aggregate cards pass null = "show everything in
// range" and never highlight. The active status card shows a primary ring.
export default function OrdersSnapshotCards({ snapshot = {}, onSelect, activeKey = null }) {
  const cards = [
    { label: 'סכום מכירות', value: fmtCurrency(snapshot.revenue), icon: DollarSign, tone: 'emerald', filterKey: null },
    { label: 'מס׳ הזמנות', value: fmtNumber(snapshot.ordersCount), icon: ShoppingCart, tone: 'blue', filterKey: null },
    { label: 'ממוצע הזמנה', value: fmtCurrency(snapshot.avgOrder), icon: TrendingUp, tone: 'indigo', filterKey: null },
    { label: 'ממתינות לתשלום', value: fmtNumber(snapshot.unpaidOrders), icon: CreditCard, tone: 'amber', filterKey: 'pending_payment' },
    { label: 'שולמו', value: fmtNumber(snapshot.paidOrders), icon: CheckCircle2, tone: 'emerald', filterKey: 'paid' },
    { label: 'בייצור', value: fmtNumber(snapshot.inProduction), icon: Factory, tone: 'violet', filterKey: 'in_production' },
    { label: 'מוכן למשלוח', value: fmtNumber(snapshot.readyForDelivery), icon: Package, tone: 'cyan', filterKey: 'ready_delivery' },
    { label: 'נמסרו', value: fmtNumber(snapshot.deliveredOrders), icon: Truck, tone: 'slate', filterKey: 'delivered' },
  ];

  const clickable = typeof onSelect === 'function';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        // Only status cubes highlight; the aggregate cubes (null) never do.
        const active = clickable && c.filterKey != null && c.filterKey === activeKey;
        const isStatusCube = clickable && c.filterKey != null;
        return (
          <Card
            key={c.label}
            onClick={clickable ? () => onSelect(c.filterKey) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={isStatusCube ? (active ? 'בטל סינון' : `הצג ${c.label}`) : undefined}
            onKeyDown={clickable ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(c.filterKey);
              }
            } : undefined}
            className={`shadow-card border-border transition-all ${
              clickable
                ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                : ''
            } ${active ? 'ring-2 ring-primary border-primary' : ''}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground truncate" title={c.label}>{c.label}</p>
                  <p className="text-2xl font-bold text-foreground mt-1 truncate" title={String(c.value)}>
                    {c.value}
                  </p>
                </div>
                <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${TONE[c.tone] || TONE.slate}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
