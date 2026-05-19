import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

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

  const ticketOpenStatuses = ['open', 'in_progress', 'waiting_customer'];
  const ticketClosedStatuses = ['resolved', 'closed'];

  const [
    stats,
    newLeadsCount,
    openLeadsTotal,
    noAnswerLeads,
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
  ] = await Promise.all([
    base44.functions.invoke('getDashboardStats', { startDate: startIso, endDate: endIso }),
    base44.entities.Lead.count({ effective_sort_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.Lead.count({ status: { $nin: ['won', 'lost', 'closed'] } }),
    base44.entities.Lead.count({ status: { $nin: ['won', 'lost', 'closed'] }, first_action_at: null }),
    base44.entities.Order.count({ created_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.Order.count({ payment_status: { $in: ['unpaid', 'deposit_paid'] } }),
    base44.entities.Order.count({ payment_status: 'paid', created_date: { $gte: startIso, $lte: endIso } }),
    base44.entities.Order.count({ production_status: 'in_production' }),
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
  ]);

  const summary = stats?.summary_kpis || {};
  const live = stats?.live_pipeline || {};
  const trends = stats?.trends || {};
  const marketing = stats?.marketing_performance || {};
  // The Edge Function returns per-rep leads/won/conversion/revenue but not
  // the "in handling" vs "lost" breakdown the customer asked for. Derive it
  // here from what we have so the leaderboard always shows the three rates
  // even before the backend learns to expose them.
  const reps = (stats?.sales_performance?.reps || []).map((r) => {
    const total = Number(r.leads_count || 0);
    const won = Number(r.won_count || 0);
    const inHandling = Number(r.in_handling_count ?? r.open_count ?? 0);
    const lost = Number(r.lost_count ?? Math.max(0, total - won - inHandling));
    const pct = (n) => (total > 0 ? +((n / total) * 100).toFixed(1) : 0);
    return {
      ...r,
      in_handling_rate: r.in_handling_rate != null ? r.in_handling_rate : pct(inHandling),
      lost_rate: r.lost_rate != null ? r.lost_rate : pct(lost),
    };
  });

  const revenue = Number(summary?.revenue?.value || 0);
  const avgOrder = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;

  const factoryOverdueAlert = (stats?.smart_alerts || []).find((a) => a.type === 'factory_overdue');

  const sources = marketing?.sources || [];
  const topSource = sources.length > 0
    ? [...sources].sort((a, b) => (b.leads_count || b.value || 0) - (a.leads_count || a.value || 0))[0]?.source ||
      [...sources].sort((a, b) => (b.leads_count || b.value || 0) - (a.leads_count || a.value || 0))[0]?.name
    : null;
  const marketingLeads = sources.reduce((sum, s) => sum + (s.leads_count || s.value || 0), 0);
  const marketingCost = sources.reduce((sum, s) => sum + (s.cost || 0), 0);
  const marketingRoi = marketingCost > 0 ? +((revenue / marketingCost).toFixed(1)) : null;

  return {
    // KPIs for HeroStrip + Sections
    newLeadsCount,
    openLeadsTotal,
    noAnswerLeads,
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
    lowStockItems: 0, // requires server-side computation; placeholder for now
    deliveriesToday,
    deliveriesNeedScheduling,
    deliveriesShipped,
    // Charts + tables
    leadsTrend: (trends?.leads_daily || []).map((r) => ({ date: r.date, value: r.value })),
    revenueTrend: (trends?.revenue_daily || []).map((r) => ({ date: r.date, value: r.value })),
    sourceBreakdown: sources.map((s) => ({
      name: s.source || s.name || 'אחר',
      value: s.leads_count || s.value || 0,
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
