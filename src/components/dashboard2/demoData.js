// Plausible demo numbers for previewing Dashboard 2 when there is no live
// data. The numbers scale with the selected period (today / week / month /
// 90 days / year / custom) so toggling the date range visibly changes
// volume — that's the whole point of the demo, otherwise the customer
// can't tell the picker actually does anything.

const DAILY_BASE = {
  newLeads: 47,
  orders: 38,
  revenue: 287_400,
  marketingCost: 12_500,
  marketingLeads: 34,
  ticketsOpenedToday: 6,
  deliveriesToday: 11,
  deliveriesShipped: 28,
  paidOrders: 24,
  deliveredOrders: 19,
};

// Steady-state metrics that describe "right now", not "what happened in
// this window" — these don't scale with the window length.
const SNAPSHOT_BASE = {
  openLeadsTotal: 312,
  noAnswerLeads: 28,
  unpaidOrders: 14,
  inProduction: 22,
  readyForDelivery: 9,
  notStartedProduction: 7,
  factoryOverdue: 3,
  openTickets: 17,
  urgentTickets: 4,
  slaBreachedTickets: 2,
  tasksOpen: 41,
  tasksToday: 19,
  tasksOverdue: 8,
  pendingQuotes: 23,
  lowStockItems: 5,
  deliveriesNeedScheduling: 6,
};

function periodDaysFor(rangeKey, customRange) {
  switch (rangeKey) {
    case 'today':
    case 'yesterday':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case '90days':
      return 90;
    case 'year':
      return 365;
    case 'custom': {
      if (customRange?.from && customRange?.to) {
        const ms = new Date(customRange.to).getTime() - new Date(customRange.from).getTime();
        return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
      }
      return 30;
    }
    default:
      return 1;
  }
}

function hashSeed(rangeKey, label) {
  // Stable noise per period+label so the numbers don't dance on every
  // re-render but still differ between current vs previous.
  let h = 0;
  for (const ch of `${rangeKey}|${label}`) {
    h = (h * 31 + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(h);
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trendSeries(days, dailyBase, rng) {
  // Cap series length so a year doesn't render 365 dots — aggregate to
  // weekly buckets when the window is long.
  const buckets = days <= 31 ? days : days <= 90 ? Math.ceil(days / 3) : Math.ceil(days / 14);
  const perBucket = (dailyBase * days) / buckets;
  const out = [];
  const today = new Date();
  for (let i = buckets - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i * Math.round(days / buckets));
    const noise = (rng() - 0.5) * 0.4 * perBucket;
    out.push({
      date: date.toISOString().slice(0, 10),
      value: Math.max(0, Math.round(perBucket + noise)),
    });
  }
  return out;
}

function buildSnapshot({ rangeKey, customRange, label, factor }) {
  const days = periodDaysFor(rangeKey, customRange);
  const rng = mulberry32(hashSeed(rangeKey, label));

  const scaled = (base) => Math.max(0, Math.round(base * days * factor * (0.85 + rng() * 0.3)));
  const snap = (base) => Math.max(0, Math.round(base * factor * (0.9 + rng() * 0.2)));

  const newLeadsCount = scaled(DAILY_BASE.newLeads);
  const ordersCount = scaled(DAILY_BASE.orders);
  const revenue = scaled(DAILY_BASE.revenue);
  const avgOrder = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;

  // Per-rep counts scale with the window. Closing-rate / handling / lost
  // jitter a bit by seed so each period feels distinct.
  const repBase = [
    { full_name: 'דנה כהן',   email: 'dana@kingdavid.co.il',  base_leads: 87, base_revenue: 184_500, conversion: 35.6, in_handling_rate: 28, lost_rate: 36.4 },
    { full_name: 'יוסי לוי',  email: 'yossi@kingdavid.co.il', base_leads: 72, base_revenue: 142_300, conversion: 29.2, in_handling_rate: 33, lost_rate: 37.8 },
    { full_name: 'שירה רוזן', email: 'shira@kingdavid.co.il', base_leads: 65, base_revenue: 118_900, conversion: 26.1, in_handling_rate: 31, lost_rate: 42.9 },
    { full_name: 'אבי מזרחי', email: 'avi@kingdavid.co.il',   base_leads: 91, base_revenue: 96_400,  conversion: 19.8, in_handling_rate: 38, lost_rate: 42.2 },
    { full_name: 'נועה ברק',  email: 'noa@kingdavid.co.il',   base_leads: 54, base_revenue: 38_200,  conversion: 11.1, in_handling_rate: 30, lost_rate: 58.9 },
  ];
  const repScale = Math.max(0.4, days * factor / 7); // calibrated so "week" looks like the original numbers
  const reps = repBase.map((r) => {
    const wonShift = (rng() - 0.5) * 6;
    const conversion = Math.max(0, Math.min(75, r.conversion + wonShift));
    const inHandling = Math.max(0, Math.min(75, r.in_handling_rate + (rng() - 0.5) * 8));
    const lost = Math.max(0, 100 - conversion - inHandling);
    const leads = Math.max(1, Math.round(r.base_leads * repScale * (0.85 + rng() * 0.3)));
    const wonCount = Math.round((conversion / 100) * leads);
    return {
      full_name: r.full_name,
      email: r.email,
      leads_count: leads,
      won_count: wonCount,
      conversion: +conversion.toFixed(1),
      in_handling_rate: +inHandling.toFixed(1),
      lost_rate: +lost.toFixed(1),
      revenue: Math.round(r.base_revenue * repScale * (0.85 + rng() * 0.3)),
    };
  });

  const topSource = ['דיגיטל', 'חנות', 'מוקד', 'WhatsApp'][Math.floor(rng() * 4)];
  const marketingCost = scaled(DAILY_BASE.marketingCost);
  const marketingLeads = scaled(DAILY_BASE.marketingLeads);

  return {
    // Window-scaled counts
    newLeadsCount,
    conversion: +(reps.reduce((s, r) => s + r.conversion, 0) / reps.length).toFixed(1),
    revenue,
    ordersCount,
    avgOrder,
    paidOrders: scaled(DAILY_BASE.paidOrders),
    deliveredOrders: scaled(DAILY_BASE.deliveredOrders),
    ticketsOpenedToday: scaled(DAILY_BASE.ticketsOpenedToday),
    deliveriesToday: scaled(DAILY_BASE.deliveriesToday),
    deliveriesShipped: scaled(DAILY_BASE.deliveriesShipped),
    marketingCost,
    marketingLeads,
    topSource,
    marketingRoi: marketingCost > 0 ? +(revenue / marketingCost).toFixed(1) : null,
    // Real-time snapshots (don't scale with window)
    openLeadsTotal: snap(SNAPSHOT_BASE.openLeadsTotal),
    noAnswerLeads: snap(SNAPSHOT_BASE.noAnswerLeads),
    unpaidOrders: snap(SNAPSHOT_BASE.unpaidOrders),
    inProduction: snap(SNAPSHOT_BASE.inProduction),
    readyForDelivery: snap(SNAPSHOT_BASE.readyForDelivery),
    notStartedProduction: snap(SNAPSHOT_BASE.notStartedProduction),
    factoryOverdue: snap(SNAPSHOT_BASE.factoryOverdue),
    openTickets: snap(SNAPSHOT_BASE.openTickets),
    urgentTickets: snap(SNAPSHOT_BASE.urgentTickets),
    slaBreachedTickets: snap(SNAPSHOT_BASE.slaBreachedTickets),
    tasksOpen: snap(SNAPSHOT_BASE.tasksOpen),
    tasksToday: snap(SNAPSHOT_BASE.tasksToday),
    tasksOverdue: snap(SNAPSHOT_BASE.tasksOverdue),
    pendingQuotes: snap(SNAPSHOT_BASE.pendingQuotes),
    lowStockItems: snap(SNAPSHOT_BASE.lowStockItems),
    deliveriesNeedScheduling: snap(SNAPSHOT_BASE.deliveriesNeedScheduling),
    // Trends
    leadsTrend: trendSeries(days, DAILY_BASE.newLeads, mulberry32(hashSeed(rangeKey, `${label}-leads`))),
    revenueTrend: trendSeries(days, DAILY_BASE.revenue, mulberry32(hashSeed(rangeKey, `${label}-rev`))),
    sourceBreakdown: [
      { name: 'דיגיטל', value: Math.round(newLeadsCount * 0.38) },
      { name: 'חנות', value: Math.round(newLeadsCount * 0.26) },
      { name: 'מוקד', value: Math.round(newLeadsCount * 0.19) },
      { name: 'WhatsApp', value: Math.round(newLeadsCount * 0.13) },
      { name: 'הפניה', value: Math.round(newLeadsCount * 0.04) },
    ],
    reps,
    rawStats: { _demo: true, _days: days },
  };
}

export function getDemoData(rangeKey = 'today', customRange = null) {
  return buildSnapshot({ rangeKey, customRange, label: 'current', factor: 1 });
}

export function getDemoPrevious(rangeKey = 'today', customRange = null) {
  // Previous period reads a little lower so deltas are visible. Different
  // metrics shift by different amounts to keep it from looking flat.
  return buildSnapshot({ rangeKey, customRange, label: 'previous', factor: 0.82 });
}
