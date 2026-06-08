import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CLOSED_STATUSES } from '@/constants/leadOptions';
import { fetchAllList } from '@/lib/base44Pagination';

// Lead statuses that mean "open / not yet decided". Used for the
// פתוחים סה״כ KPI and the no-answer carve-out. NOTE: the previous
// version used `$nin: ['won','lost','closed']`, which doesn't match
// any value in the real status enum (`new_lead`, `deal_closed`,
// `not_relevant_*`, …) — so the filter became a no-op and the tile
// counted every lead ever, not just open ones.
const NO_ANSWER_STATUSES = [
  'no_answer_1', 'no_answer_2', 'no_answer_3', 'no_answer_4', 'no_answer_5',
  'no_answer_whatsapp_sent', 'no_answer_calls',
];

// "מזרונים בייצור" = anything actively on the floor: materials_check,
// in_production, qc. (`not_started` has its own tile, `ready` has its
// own tile — both excluded here so totals don't double-count.)
const IN_PRODUCTION_STATUSES = ['materials_check', 'in_production', 'qc'];

// One query, one round-trip per period. Fans out to:
//   - getDashboardStats Edge Function (KPIs, sales reps, trends)
//   - direct entity counts for things the Edge Function doesn't expose
//     (support tickets by status/priority, orders by production/payment,
//      deliveries, low-stock inventory).
// Returned shape feeds HeroStrip + all OverviewTab sections via a single
// `current` object (and an equivalent `previous` from a second invocation
// for period-over-period deltas).
async function fetchDashboard2Snapshot({ start, end }) {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const nowIso = new Date().toISOString();
  // "לידים שטרם טופלו" — entry-status leads (new_lead) that arrived over 24h
  // ago and still haven't been triaged. A live "right now" backlog metric,
  // deliberately NOT bounded by the dashboard's selected date range (mirrors
  // openLeadsTotal / noAnswerLeads, which are also current-state counts).
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const ticketOpenStatuses = ['open', 'in_progress', 'waiting_customer'];
  const ticketClosedStatuses = ['resolved', 'closed'];

  const [
    stats,
    newLeadsCount,
    openLeadsTotal,
    noAnswerLeads,
    untouchedLeads,
    ordersCount,
    unpaidOrders,
    paidOrders,
    inProduction,
    readyForDelivery,
    notStartedProduction,
    deliveredOrders,
    openTickets,
    urgentTickets,
    slaBreachedTickets,
    ticketsOpenedToday,
    deliveriesToday,
    deliveriesNeedScheduling,
    deliveriesShipped,
    inventory,
  ] = await Promise.all([
    base44.functions.invoke('getDashboardStats', { startDate: startIso, endDate: endIso }),
    base44.entities.Lead.count({ effective_sort_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.Lead.count({ status: { $nin: CLOSED_STATUSES } }),
    base44.entities.Lead.count({ status: { $in: NO_ANSWER_STATUSES } }),
    base44.entities.Lead.count({ status: 'new_lead', created_date: { $lt: dayAgoIso } }),
    base44.entities.Order.count({ created_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.Order.count({ payment_status: { $in: ['unpaid', 'deposit_paid'] } }),
    base44.entities.Order.count({ payment_status: 'paid', created_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.Order.count({ production_status: { $in: IN_PRODUCTION_STATUSES } }),
    base44.entities.Order.count({ production_status: 'ready' }),
    base44.entities.Order.count({ production_status: 'not_started' }),
    base44.entities.Order.count({ delivery_status: 'delivered', created_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.SupportTicket.count({ status: { $in: ticketOpenStatuses } }),
    base44.entities.SupportTicket.count({ priority: 'urgent', status: { $nin: ticketClosedStatuses } }),
    base44.entities.SupportTicket.count({ sla_due_date: { $lt: nowIso }, status: { $nin: ticketClosedStatuses } }),
    base44.entities.SupportTicket.count({ created_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.DeliveryShipment.count({ scheduled_date: { $gte: startIso, $lte: endIso } }).catch(() => 0),
    base44.entities.DeliveryShipment.count({ status: 'need_scheduling' }).catch(() => 0),
    base44.entities.DeliveryShipment.count({ status: 'delivered', scheduled_date: { $gte: startIso, $lte: endIso } }).catch(() => 0),
    fetchAllList(base44.entities.InventoryItem).catch(() => []),
  ]);

  // qty_on_hand ≤ min_threshold = "פריטים מתחת לסף" (matches the
  // FactoryDashboard / Inventory page rule). Items without a configured
  // threshold are skipped — otherwise everything would flag.
  const lowStockItems = (inventory || []).filter((item) => {
    if (!item || !item.min_threshold) return false;
    return Number(item.qty_on_hand || 0) <= Number(item.min_threshold);
  }).length;

  const summary = stats?.summary_kpis || {};
  const live = stats?.live_pipeline || {};
  const trends = stats?.trends || {};
  const marketing = stats?.marketing_performance || {};
  // The Edge Function returns per-rep leads/won/conversion/revenue but not
  // the "in handling" vs "lost" breakdown the customer asked for. Derive it
  // here from what we have so the leaderboard always shows the three rates
  // even before the backend learns to expose them.
  // getDashboardStats returns reps keyed by `rep_email` / `rep_name` and
  // exposes `leads_range` for the in-range lead count + `conversion_rate`.
  // RepLeaderboard.jsx reads `email` / `full_name` / `leads_count` /
  // `conversion`, so without these aliases every row collapsed to
  // "לא ידוע" with 0% across the board.
  const reps = (stats?.sales_performance?.reps || []).map((r) => {
    const total = Number(r.leads_count ?? r.leads_range ?? 0);
    const won = Number(r.won_count ?? r.won ?? 0);
    const inHandling = Number(r.in_handling_count ?? r.open_count ?? r.workload_open_tasks ?? 0);
    const lost = Number(r.lost_count ?? Math.max(0, total - won - inHandling));
    const pct = (n) => (total > 0 ? +((n / total) * 100).toFixed(1) : 0);
    return {
      ...r,
      email: r.email ?? r.rep_email,
      full_name: r.full_name ?? r.rep_name,
      leads_count: total,
      won_count: won,
      conversion: r.conversion != null ? Number(r.conversion) : Number(r.conversion_rate ?? pct(won)),
      in_handling_rate: r.in_handling_rate != null ? r.in_handling_rate : pct(inHandling),
      lost_rate: r.lost_rate != null ? r.lost_rate : pct(lost),
    };
  });

  const revenue = Number(summary?.revenue?.value || 0);
  const avgOrder = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;

  const factoryOverdueAlert = (stats?.smart_alerts || []).find((a) => a.type === 'factory_overdue');

  const sources = marketing?.sources || [];
  // Normalize each source into the same shape the Marketing leaderboard
  // expects (leads_count + closing/handling/lost % + cost + ROI). Falls
  // back to derived values when the Edge Function only sent partial data.
  const marketingBreakdown = sources.map((s) => {
    const leads = Number(s.leads_count || s.value || 0);
    const won = Number(s.won_count || 0);
    const inHandling = Number(s.in_handling_count || s.open_count || 0);
    const lost = Number(s.lost_count ?? Math.max(0, leads - won - inHandling));
    const pct = (n) => (leads > 0 ? +((n / leads) * 100).toFixed(1) : 0);
    const cost = Number(s.cost || 0);
    const sourceRevenue = Number(s.revenue || 0);
    return {
      name: s.source || s.name || 'אחר',
      leads_count: leads,
      won_count: won,
      conversion: s.conversion != null ? Number(s.conversion) : pct(won),
      in_handling_rate: s.in_handling_rate != null ? Number(s.in_handling_rate) : pct(inHandling),
      lost_rate: s.lost_rate != null ? Number(s.lost_rate) : pct(lost),
      cost,
      revenue: sourceRevenue,
      roi: cost > 0 ? +((sourceRevenue / cost).toFixed(1)) : null,
    };
  });
  const topSource = marketingBreakdown.length > 0
    ? [...marketingBreakdown].sort((a, b) => (b.leads_count || 0) - (a.leads_count || 0))[0]?.name
    : null;
  const marketingLeads = marketingBreakdown.reduce((sum, s) => sum + (s.leads_count || 0), 0);
  const marketingCost = marketingBreakdown.reduce((sum, s) => sum + (s.cost || 0), 0);
  const marketingRoi = marketingCost > 0 ? +((revenue / marketingCost).toFixed(1)) : null;

  return {
    // KPIs for HeroStrip + Sections
    newLeadsCount,
    openLeadsTotal,
    noAnswerLeads,
    untouchedLeads,
    conversion: Number(summary?.conversion?.value || 0),
    revenue,
    ordersCount,
    avgOrder,
    unpaidOrders,
    paidOrders,
    inProduction,
    readyForDelivery,
    notStartedProduction,
    deliveredOrders,
    factoryOverdue: factoryOverdueAlert?.impact || 0,
    openTickets,
    urgentTickets,
    slaBreachedTickets,
    ticketsOpenedToday,
    tasksOpen: live?.tasks_today?.count != null && live?.tasks_overdue?.count != null
      ? (live.tasks_today.count + live.tasks_overdue.count)
      : (summary?.open_workload?.value || 0),
    tasksToday: live?.tasks_today?.count || 0,
    tasksOverdue: live?.tasks_overdue?.count || 0,
    pendingQuotes: live?.pending_quotes?.count || 0,
    marketingCost,
    marketingLeads,
    topSource,
    marketingRoi,
    lowStockItems,
    deliveriesToday,
    deliveriesNeedScheduling,
    deliveriesShipped,
    // Charts + tables
    leadsTrend: (trends?.leads_daily || []).map((r) => ({ date: r.date, value: r.value })),
    revenueTrend: (trends?.revenue_daily || []).map((r) => ({ date: r.date, value: r.value })),
    sourceBreakdown: marketingBreakdown.map((s) => ({ name: s.name, value: s.leads_count })),
    marketingBreakdown,
    // Pass through campaigns + landing pages straight from the Edge
    // Function (already aggregated server-side). Each row already has
    // leads / won / conversion / cost / revenue / roi where available;
    // MarketingTab fills in CPL / CAC client-side from the totals so
    // the table never shows stale or missing per-row math.
    campaigns: (stats?.marketing_performance?.campaigns || []).map((c) => ({
      name: c.campaign || c.name || 'אחר',
      source: c.source || null,
      leads_count: Number(c.leads_count ?? c.leads ?? 0),
      won_count: Number(c.won_count ?? c.won ?? 0),
      conversion: c.conversion_rate != null ? Number(c.conversion_rate) : Number(c.conversion || 0),
      cost: Number(c.cost ?? c.spend ?? 0),
      revenue: Number(c.revenue ?? c.attributed_revenue ?? 0),
      cpl: Number(c.leads_count ?? c.leads ?? 0) > 0
        ? Math.round(Number(c.cost ?? c.spend ?? 0) / Number(c.leads_count ?? c.leads ?? 1))
        : 0,
      cac: Number(c.won_count ?? c.won ?? 0) > 0
        ? Math.round(Number(c.cost ?? c.spend ?? 0) / Number(c.won_count ?? c.won ?? 1))
        : null,
      roi: c.roas != null ? Number(c.roas) : (Number(c.cost ?? c.spend ?? 0) > 0
        ? +(Number(c.revenue ?? c.attributed_revenue ?? 0) / Number(c.cost ?? c.spend ?? 1)).toFixed(1)
        : null),
    })),
    landingPages: (stats?.marketing_performance?.landing_pages || []).map((p) => ({
      name: p.landing_page || p.name || 'אחר',
      leads_count: Number(p.leads ?? p.leads_count ?? 0),
      won_count: Number(p.won_count ?? p.won ?? 0),
      conversion: p.conversion_rate != null ? Number(p.conversion_rate) : Number(p.conversion || 0),
      revenue: Number(p.attributed_revenue ?? p.revenue ?? 0),
    })),
    reps,
    rawStats: stats,
  };
}

export default function useDashboard2Data({ start, end, enabled = true, label = 'current' }) {
  return useQuery({
    queryKey: ['dashboard2', label, start?.toISOString(), end?.toISOString()],
    queryFn: () => fetchDashboard2Snapshot({ start, end }),
    enabled: enabled && !!start && !!end,
    staleTime: 45 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
