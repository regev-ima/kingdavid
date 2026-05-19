// Plausible demo numbers for previewing Dashboard 2 when there is no live
// data in the preview environment (or when the customer wants a
// screenshot-ready view to share with stakeholders). Numbers are picked to
// look like a real medium-sized mattress business so the layout is easy to
// evaluate.

const TODAY = new Date();

function trendData(days, base, variance) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - i);
    const noise = Math.round((Math.random() - 0.5) * variance);
    out.push({
      date: d.toISOString().slice(0, 10),
      value: Math.max(0, base + noise),
    });
  }
  return out;
}

export function getDemoData() {
  const reps = [
    { full_name: 'דנה כהן', email: 'dana@kingdavid.co.il', leads_count: 87, won_count: 31, conversion: 35.6, revenue: 184500 },
    { full_name: 'יוסי לוי', email: 'yossi@kingdavid.co.il', leads_count: 72, won_count: 21, conversion: 29.2, revenue: 142300 },
    { full_name: 'שירה רוזן', email: 'shira@kingdavid.co.il', leads_count: 65, won_count: 17, conversion: 26.1, revenue: 118900 },
    { full_name: 'אבי מזרחי', email: 'avi@kingdavid.co.il', leads_count: 91, won_count: 18, conversion: 19.8, revenue: 96400 },
    { full_name: 'נועה ברק', email: 'noa@kingdavid.co.il', leads_count: 54, won_count: 6, conversion: 11.1, revenue: 38200 },
  ];

  return {
    newLeadsCount: 47,
    openLeadsTotal: 312,
    noAnswerLeads: 28,
    conversion: 24.5,
    revenue: 287400,
    ordersCount: 38,
    avgOrder: 7563,
    unpaidOrders: 14,
    paidOrders: 24,
    inProduction: 22,
    readyForDelivery: 9,
    notStartedProduction: 7,
    deliveredOrders: 19,
    factoryOverdue: 3,
    openTickets: 17,
    urgentTickets: 4,
    slaBreachedTickets: 2,
    ticketsOpenedToday: 6,
    tasksOpen: 41,
    tasksToday: 19,
    tasksOverdue: 8,
    pendingQuotes: 23,
    marketingCost: 12500,
    marketingLeads: 34,
    topSource: 'דיגיטל',
    marketingRoi: 23,
    lowStockItems: 5,
    deliveriesToday: 11,
    deliveriesNeedScheduling: 6,
    deliveriesShipped: 28,
    leadsTrend: trendData(14, 42, 18),
    revenueTrend: trendData(14, 24000, 12000),
    sourceBreakdown: [
      { name: 'דיגיטל', value: 18 },
      { name: 'חנות', value: 12 },
      { name: 'מוקד', value: 9 },
      { name: 'WhatsApp', value: 6 },
      { name: 'הפניה', value: 2 },
    ],
    reps,
    rawStats: { _demo: true },
  };
}

export function getDemoPrevious() {
  return {
    newLeadsCount: 38,
    openLeadsTotal: 298,
    noAnswerLeads: 35,
    revenue: 234100,
    ordersCount: 31,
    openTickets: 22,
    inProduction: 19,
    tasksOverdue: 11,
  };
}
