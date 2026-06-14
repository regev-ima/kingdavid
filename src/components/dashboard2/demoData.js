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
    case '7days':
      return 7;
    case 'month':
    case '30days':
      return 30;
    case '60days':
      return 60;
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

function toLocalIsoDate(d) {
  // Avoid the UTC shift you get from toISOString() — for an Israeli user
  // viewing midnight-local data, toISOString rolls back to the previous
  // day, which made the tooltip read "01.01" for points that were
  // actually "13.01" / "27.01" etc.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toLocalIsoHour(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:00`;
}

function trendSeries(days, dailyBase, rng, endDate = new Date()) {
  // Single-day windows (today / yesterday) get hourly granularity so the
  // chart actually shows movement instead of a lone dot.
  if (days <= 1) {
    const perHour = dailyBase / 12; // business hours
    const out = [];
    for (let h = 8; h <= 21; h++) {
      const date = new Date(endDate);
      date.setHours(h, 0, 0, 0);
      const noise = (rng() - 0.5) * 0.5 * perHour;
      out.push({
        date: toLocalIsoHour(date),
        value: Math.max(0, Math.round(perHour + noise)),
      });
    }
    return out;
  }

  // Cap series length so a year doesn't render 365 dots — aggregate to
  // longer buckets when the window is long.
  const buckets = days <= 31 ? days : days <= 90 ? Math.ceil(days / 3) : Math.ceil(days / 14);
  const step = Math.max(1, Math.round(days / buckets));
  const perBucket = (dailyBase * days) / buckets;
  const out = [];
  for (let i = buckets - 1; i >= 0; i--) {
    const date = new Date(endDate);
    date.setHours(12, 0, 0, 0); // noon to dodge timezone day-shift
    date.setDate(date.getDate() - i * step);
    const noise = (rng() - 0.5) * 0.4 * perBucket;
    out.push({
      date: toLocalIsoDate(date),
      value: Math.max(0, Math.round(perBucket + noise)),
    });
  }
  return out;
}

function buildSnapshot({ rangeKey, customRange, dateRange, label, factor }) {
  const days = periodDaysFor(rangeKey, customRange);
  const endDate = dateRange?.end ? new Date(dateRange.end) : new Date();
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

  // Per-source breakdown so the Marketing section can render a
  // leaderboard with the same shape as the rep leaderboard: leads count,
  // closing / handling / lost percentages, cost, ROI.
  const sourceBase = [
    { name: 'דיגיטל',  base_leads: 18, base_cost: 5200, conv_target: 38.9 },
    { name: 'חנות',    base_leads: 12, base_cost: 800,  conv_target: 33.3 },
    { name: 'מוקד',    base_leads: 9,  base_cost: 2100, conv_target: 26.0 },
    { name: 'WhatsApp', base_leads: 6, base_cost: 1400, conv_target: 21.5 },
    { name: 'הפניה',   base_leads: 4,  base_cost: 0,    conv_target: 45.0 },
  ];
  const marketingScale = Math.max(0.4, (days * factor) / 1);
  const marketingBreakdown = sourceBase.map((s) => {
    const conv = Math.max(0, Math.min(75, s.conv_target + (rng() - 0.5) * 8));
    const inHandling = Math.max(0, Math.min(75, 28 + (rng() - 0.5) * 10));
    const lost = Math.max(0, 100 - conv - inHandling);
    const leads = Math.max(1, Math.round(s.base_leads * marketingScale * (0.85 + rng() * 0.3)));
    const won = Math.round((conv / 100) * leads);
    const cost = Math.round(s.base_cost * marketingScale * (0.9 + rng() * 0.2));
    // Revenue scales with closing volume and average deal size from this source.
    const avgDeal = 7000 + Math.round(rng() * 4000);
    const sourceRevenue = won * avgDeal;
    const roi = cost > 0 ? +(sourceRevenue / cost).toFixed(1) : null;
    return {
      name: s.name,
      leads_count: leads,
      won_count: won,
      conversion: +conv.toFixed(1),
      in_handling_rate: +inHandling.toFixed(1),
      lost_rate: +lost.toFixed(1),
      cost,
      revenue: sourceRevenue,
      roi,
    };
  });
  const topSource = [...marketingBreakdown].sort((a, b) => (b.leads_count || 0) - (a.leads_count || 0))[0]?.name || 'דיגיטל';
  const marketingCost = marketingBreakdown.reduce((s, r) => s + (r.cost || 0), 0);
  const marketingLeads = marketingBreakdown.reduce((s, r) => s + (r.leads_count || 0), 0);

  // Campaigns + landing pages: synthesised from the same volume scale
  // as sources so all marketing numbers tell a consistent story (sum of
  // campaign-attributed leads ≈ marketingLeads, etc).
  const campaignBase = [
    { name: 'BlackFriday-2025',   source: 'דיגיטל',  base_leads: 9,  base_cost: 1900, conv: 35 },
    { name: 'Spring-Sale-30',     source: 'דיגיטל',  base_leads: 7,  base_cost: 1500, conv: 28 },
    { name: 'Brand-Awareness-Q1', source: 'דיגיטל',  base_leads: 5,  base_cost: 1100, conv: 12 },
    { name: 'WhatsApp-Promo',     source: 'WhatsApp', base_leads: 4, base_cost: 700,  conv: 24 },
    { name: 'Retargeting-Cart',   source: 'דיגיטל',  base_leads: 3,  base_cost: 600,  conv: 41 },
    { name: 'Referral-Bonus',     source: 'הפניה',   base_leads: 3,  base_cost: 0,    conv: 48 },
  ];
  const campaigns = campaignBase.map((c) => {
    const leads = Math.max(1, Math.round(c.base_leads * marketingScale * (0.85 + rng() * 0.3)));
    const conv = Math.max(0, Math.min(80, c.conv + (rng() - 0.5) * 8));
    const won = Math.round((conv / 100) * leads);
    const cost = Math.round(c.base_cost * marketingScale * (0.9 + rng() * 0.2));
    const avgDeal = 6500 + Math.round(rng() * 4500);
    const revenue = won * avgDeal;
    return {
      name: c.name,
      source: c.source,
      leads_count: leads,
      won_count: won,
      conversion: +conv.toFixed(1),
      cost,
      revenue,
      cpl: leads > 0 ? Math.round(cost / leads) : 0,
      cac: won > 0 ? Math.round(cost / won) : null,
      roi: cost > 0 ? +(revenue / cost).toFixed(1) : null,
    };
  });

  const landingPageBase = [
    { name: '/mattress-deals',  base_leads: 14, conv: 32 },
    { name: '/comfort-test',    base_leads: 11, conv: 38 },
    { name: '/promo-30-off',    base_leads: 9,  conv: 22 },
    { name: '/store-locator',   base_leads: 7,  conv: 41 },
    { name: '/sleep-quiz',      base_leads: 5,  conv: 28 },
    { name: '/lp-back-pain',    base_leads: 4,  conv: 19 },
  ];
  const landingPages = landingPageBase.map((p) => {
    const leads = Math.max(1, Math.round(p.base_leads * marketingScale * (0.85 + rng() * 0.3)));
    const conv = Math.max(0, Math.min(80, p.conv + (rng() - 0.5) * 6));
    const won = Math.round((conv / 100) * leads);
    const avgDeal = 6800 + Math.round(rng() * 3500);
    const revenue = won * avgDeal;
    return {
      name: p.name,
      leads_count: leads,
      won_count: won,
      conversion: +conv.toFixed(1),
      revenue,
    };
  });

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
    marketingRoi: marketingCost > 0 ? +(marketingBreakdown.reduce((s, r) => s + (r.revenue || 0), 0) / marketingCost).toFixed(1) : null,
    marketingBreakdown,
    campaigns,
    landingPages,
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
    // Trends — anchored at the period's end date so the tooltip dates
    // shift when you flip between today / week / month / year.
    leadsTrend: trendSeries(days, DAILY_BASE.newLeads, mulberry32(hashSeed(rangeKey, `${label}-leads`)), endDate),
    revenueTrend: trendSeries(days, DAILY_BASE.revenue, mulberry32(hashSeed(rangeKey, `${label}-rev`)), endDate),
    sourceBreakdown: marketingBreakdown.map((s) => ({ name: s.name, value: s.leads_count })),
    reps,
    rawStats: { _demo: true, _days: days },
  };
}

export function getDemoData(rangeKey = 'today', customRange = null, dateRange = null) {
  return buildSnapshot({ rangeKey, customRange, dateRange, label: 'current', factor: 1 });
}

export function getDemoPrevious(rangeKey = 'today', customRange = null, dateRange = null) {
  // Previous period reads a little lower so deltas are visible. Different
  // metrics shift by different amounts to keep it from looking flat.
  return buildSnapshot({ rangeKey, customRange, dateRange, label: 'previous', factor: 0.82 });
}
