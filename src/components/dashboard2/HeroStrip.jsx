import React from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import HeroTile from './HeroTile';
import {
  Users,
  ShoppingCart,
  DollarSign,
  Headphones,
  FileText,
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
// Every tile in this strip is a FLOW metric — things that happened inside the
// window — so all five carry the suffix and all five move together when the
// range changes. Point-in-time counts (in production, overdue tasks, open
// tickets) live in the section cards below, where "now" is what they mean.
const RANGE_SUFFIX = {
  today: 'היום',
  yesterday: 'אתמול',
  week: 'השבוע',
  month: 'החודש',
  '7days': 'ב-7 ימים',
  '30days': 'ב-30 יום',
  '60days': 'ב-60 יום',
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
      // Tickets OPENED in the window. More of them is worse, hence the
      // inverted polarity — a rise here is a growing support load.
      title: `כרטיסי שירות ${rangeSuffix}`,
      value: formatNumber(current.ticketsOpenedToday ?? 0),
      delta: calcDelta(current.ticketsOpenedToday, previous.ticketsOpenedToday),
      deltaPolarity: 'negative',
      icon: Headphones,
      color: 'amber',
      onClick: () => goTo('ServiceCenter'),
    },
    {
      title: `הצעות מחיר ${rangeSuffix}`,
      value: formatNumber(current.quotesCount ?? 0),
      delta: calcDelta(current.quotesCount, previous.quotesCount),
      icon: FileText,
      color: 'violet',
      onClick: () => goTo('Quotes', { tab: 'all' }),
    },
  ];

  return (
    // One tile per row on a phone: at two columns the value shares ~118px with
    // the title and long numbers ("₪4,369.87") were being ellipsised away.
    <section className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
      {cards.map((c) => (
        <HeroTile key={c.title} {...c} />
      ))}
    </section>
  );
}
