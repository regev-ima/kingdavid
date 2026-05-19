import React from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import KPICard from '@/components/shared/KPICard';
import {
  Users,
  ShoppingCart,
  DollarSign,
  Headphones,
  Factory,
  AlertTriangle,
} from 'lucide-react';

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

// Period-over-period delta as a fraction (e.g. 0.25 means +25%).
// Returns null when the previous value is missing/zero so KPICard renders "—".
function calcDelta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!Number.isFinite(p) || p === 0) return null;
  return (c - p) / p;
}

export default function HeroStrip({ current = {}, previous = {}, dateRange }) {
  const navigate = useNavigate();
  const startIso = dateRange?.from ? new Date(dateRange.from).toISOString() : undefined;
  const endIso = dateRange?.to ? new Date(dateRange.to).toISOString() : undefined;

  const dateQuery = {};
  if (startIso) dateQuery.startDate = startIso;
  if (endIso) dateQuery.endDate = endIso;

  const goTo = (page, extraQuery = {}) => {
    const params = new URLSearchParams({ ...dateQuery, ...extraQuery });
    const query = params.toString();
    navigate(query ? `${createPageUrl(page)}?${query}` : createPageUrl(page));
  };

  const cards = [
    {
      title: 'לידים בטווח',
      value: current.newLeadsCount ?? 0,
      delta: calcDelta(current.newLeadsCount, previous.newLeadsCount),
      icon: Users,
      color: 'blue',
      onClick: () => goTo('Leads', { tab: 'all' }),
    },
    {
      title: 'הזמנות בטווח',
      value: current.ordersCount ?? 0,
      delta: calcDelta(current.ordersCount, previous.ordersCount),
      icon: ShoppingCart,
      color: 'emerald',
      onClick: () => goTo('Orders', { tab: 'all' }),
    },
    {
      title: 'הכנסות בטווח',
      value: formatCurrency(current.revenue),
      delta: calcDelta(current.revenue, previous.revenue),
      icon: DollarSign,
      color: 'emerald',
      onClick: () => goTo('Orders', { tab: 'all' }),
    },
    {
      title: 'כרטיסי שירות פתוחים',
      value: current.openTickets ?? 0,
      delta: calcDelta(current.openTickets, previous.openTickets),
      deltaPolarity: 'negative',
      icon: Headphones,
      color: 'amber',
      onClick: () => goTo('Support', { status: 'open' }),
    },
    {
      title: 'מזרונים בייצור',
      value: current.inProduction ?? 0,
      delta: calcDelta(current.inProduction, previous.inProduction),
      icon: Factory,
      color: 'violet',
      onClick: () => goTo('Factory'),
    },
    {
      title: 'משימות באיחור',
      value: current.tasksOverdue ?? 0,
      delta: calcDelta(current.tasksOverdue, previous.tasksOverdue),
      deltaPolarity: 'negative',
      icon: AlertTriangle,
      color: (current.tasksOverdue ?? 0) > 0 ? 'red' : 'emerald',
      onClick: () => goTo('SalesTasks', { tab: 'overdue' }),
    },
  ];

  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <KPICard key={c.title} {...c} />
      ))}
    </section>
  );
}
