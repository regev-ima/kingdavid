import React from 'react';
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
import StatCube from '@/components/shared/StatCube';

const fmtCurrency = (v) => `₪${Number(v || 0).toLocaleString()}`;
const fmtNumber = (v) => Number(v || 0).toLocaleString();

// Orders period snapshot, rendered with the shared StatCube (same look the
// Sales-Tasks header uses). Each card is clickable and IS the status filter
// for the list below. `filterKey` is the activeTab value the click selects;
// the three aggregate cards pass null = "show everything in range" and never
// highlight. The active status card shows a primary ring.
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
        const isStatusCube = clickable && c.filterKey != null;
        const active = isStatusCube && c.filterKey === activeKey;
        return (
          <StatCube
            key={c.label}
            label={c.label}
            value={c.value}
            icon={c.icon}
            tone={c.tone}
            active={active}
            onClick={clickable ? () => onSelect(c.filterKey) : undefined}
            title={isStatusCube ? (active ? 'בטל סינון' : `הצג ${c.label}`) : undefined}
          />
        );
      })}
    </div>
  );
}
