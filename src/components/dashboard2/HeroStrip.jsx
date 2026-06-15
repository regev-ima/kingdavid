import React from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import HeroTile from './HeroTile';
import {
  Users,
  ShoppingCart,
  DollarSign,
  Headphones,
  Factory,
  AlertTriangle,
} from 'lucide-react';

function formatCurrencyCompact(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `₪${Math.round(n / 1_000)}K`;
  return `₪${n.toLocaleString()}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

// Period-over-period delta as a fraction (e.g. 0.25 means +25%).
// Returns null when the previous value is missing/zero so the tile renders "—".
function calcDelta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!Number.isFinite(p) || p === 0) return null;
  return (c - p) / p;
}

// Echo the date range chosen in the header into the flow-metric titles, so
// "לידים בטווח" reads as "לידים החודש" / "לידים השבוע" etc. and there's no
// guessing which window the numbers cover. Keys mirror Dashboard2DateRange's
// PRESETS; unknown keys fall back to the generic "בטווח". The snapshot tiles
// below (open tickets / in production / overdue) are point-in-time, so they
// keep their own fixed titles.
const RANGE_SUFFIX = {
  today: 'היום',
  yesterday: 'אתמול',
  week: 'השבוע',
  month: 'החודש',
  '90days': 'ב-90 יום',
  year: 'השנה',
  custom: 'בטווח הנבחר',
};

export default function HeroStrip({ current = {}, previous = {}, dateRange, rangeKey }) {
  const navigate = useNavigate();
  const rangeSuffix = RANGE_SUFFIX[rangeKey] || 'בטווח';
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
      title: `לידים ${rangeSuffix}`,
      value: formatNumber(current.newLeadsCount ?? 0),
      delta: calcDelta(current.newLeadsCount, previous.newLeadsCount),
      icon: Users,
      color: 'blue',
      onClick: () => goTo('Leads', { tab: 'all' }),
    },
    {
      title: `הזמנות ${rangeSuffix}`,
      value: formatNumber(current.ordersCount ?? 0),
      delta: calcDelta(current.ordersCount, previous.ordersCount),
      icon: ShoppingCart,
      color: 'emerald',
      onClick: () => goTo('Orders', { tab: 'all' }),
    },
    {
      title: `הכנסות ${rangeSuffix}`,
      value: formatCurrencyCompact(current.revenue),
      delta: calcDelta(current.revenue, previous.revenue),
      icon: DollarSign,
      color: 'emerald',
      onClick: () => goTo('Orders', { tab: 'all' }),
    },
    {
      title: 'כרטיסי שירות פתוחים',
      value: formatNumber(current.openTickets ?? 0),
      delta: calcDelta(current.openTickets, previous.openTickets),
      deltaPolarity: 'negative',
      icon: Headphones,
      color: 'amber',
      onClick: () => goTo('ServiceCenter'),
    },
    {
      title: 'מזרונים בייצור',
      value: formatNumber(current.inProduction ?? 0),
      delta: calcDelta(current.inProduction, previous.inProduction),
      icon: Factory,
      color: 'violet',
      onClick: () => goTo('Factory'),
    },
    {
      title: 'משימות באיחור',
      value: formatNumber(current.tasksOverdue ?? 0),
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
        <HeroTile key={c.title} {...c} />
      ))}
    </section>
  );
}
