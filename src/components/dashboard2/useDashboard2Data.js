import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CLOSED_STATUSES } from '@/constants/leadOptions';

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

// Low-stock count needs to compare two columns (qty_on_hand ≤ min_threshold),
// which PostgREST can't filter server-side — so we fetch the rows. But we only
// need those two columns, not `SELECT *`, and we page in 1000-row chunks with
// no artificial delay (the old fetchAllList added 150ms between 500-row pages,
// which dominated dashboard load on large inventories).
async function fetchInventoryThresholds() {
  const pageSize = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await base44.supabase
      .from('inventory_items')
      .select('qty_on_hand,min_threshold')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Sum of order revenue for a date range — used only as a fallback when the
// stats Edge Function is down. Fetches just the `total` column (paged) so it
// stays light even on wide ranges.
async function fetchOrderTotalsInRange(startIso, endIso) {
  const pageSize = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await base44.supabase
      .from('orders')
      .select('total')
      .gte('created_date', startIso)
      .lte('created_date', endIso)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// One query, one round-trip per period. Fans out to:
//   - getDashboardStats Edge Function (KPIs, sales reps, trends)
//   - direct entity counts for things the Edge Function doesn't expose
//     (support tickets by status/priority, orders by production/payment,
//      deliveries, low-stock inventory).
// Returned shape feeds HeroStrip + all OverviewTab sections via a single
// `current` object (and an equivalent `previous` from a second invocation
// for period-over-period deltas).
//
// CRITICAL: every call is wrapped in `guard()` so a single failure (e.g. the
// Edge Function 500-ing, or one table being absent) NO LONGER rejects the whole
// Promise.all and blanks every tile to 0. Each failure falls back to a neutral
// value and is recorded in `_errors`, which the page surfaces as a banner — so
// "the data didn't load" is shown honestly instead of masquerading as real
// zeros, and everything that DID load still renders.
async function fetchDashboard2Snapshot({ start, end, label = 'current' }) {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const nowIso = new Date().toISOString();
  // The previous period only feeds HeroStrip's six deltas, so it skips the
  // ~14 counts + inventory scan the current snapshot needs — roughly halving
  // the dashboard's total work.
  const lite = label === 'previous';

  const ticketOpenStatuses = ['open', 'in_progress', 'waiting_customer'];
  const ticketClosedStatuses = ['resolved', 'closed'];

  const errors = [];
  // Cap every call so one slow/hanging request (the stats Edge Function on a
  // cold start, a large inventory scan, a stalled socket) can't freeze the whole
  // dashboard on skeletons forever. On timeout we degrade to the fallback and
  // record the error, exactly like a rejection — the page renders what loaded
  // plus a banner instead of spinning indefinitely.
  const CALL_TIMEOUT_MS = 20000;
  const withTimeout = (promise, ms = CALL_TIMEOUT_MS) =>
    Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`נתקע (timeout מעל ${Math.round(ms / 1000)} שניות)`)), ms)),
    ]);
  const guard = (source, promise, fallback, { silent = false, timeout = CALL_TIMEOUT_MS } = {}) =>
    withTimeout(promise, timeout).catch((e) => {
      if (!silent) errors.push({ source, message: e?.message || String(e) });
      return fallback;
    });

  const invokeStats = () =>
    base44.functions.invoke('getDashboardStats', { startDate: startIso, endDate: endIso });

  if (lite) {
    // Everything stays in one Promise.all so the Edge Function runs in
    // parallel with the counts (not serialized after it).
    const [stats, newLeadsCount, ordersCount, openTickets, inProduction] = await Promise.all([
      guard('getDashboardStats', invokeStats(), null, { silent: true }),
      guard('leads.new', base44.entities.Lead.count({ effective_sort_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
      guard('orders.count', base44.entities.Order.count({ created_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
      guard('tickets.open', base44.entities.SupportTicket.count({ status: { $in: ticketOpenStatuses } }), 0, { silent: true }),
      guard('orders.inProduction', base44.entities.Order.count({ production_status: { $in: IN_PRODUCTION_STATUSES } }), 0, { silent: true }),
    ]);
    return {
      newLeadsCount,
      ordersCount,
      openTickets,
      inProduction,
      revenue: Number(stats?.summary_kpis?.revenue?.value || 0),
      tasksOverdue: stats?.live_pipeline?.tasks_overdue?.count || 0,
      _errors: errors,
    };
  }

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
    inventory,
  ] = await Promise.all([
    guard('getDashboardStats', invokeStats(), null),
    guard('leads.new', base44.entities.Lead.count({ effective_sort_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('leads.open', base44.entities.Lead.count({ status: { $nin: CLOSED_STATUSES } }), 0),
    guard('leads.noAnswer', base44.entities.Lead.count({ status: { $in: NO_ANSWER_STATUSES } }), 0),
    guard('orders.count', base44.entities.Order.count({ created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('orders.unpaid', base44.entities.Order.count({ payment_status: { $in: ['unpaid', 'deposit_paid'] } }), 0),
    guard('orders.paid', base44.entities.Order.count({ payment_status: 'paid', created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('orders.inProduction', base44.entities.Order.count({ production_status: { $in: IN_PRODUCTION_STATUSES } }), 0),
    guard('orders.ready', base44.entities.Order.count({ production_status: 'ready' }), 0),
    guard('orders.notStarted', base44.entities.Order.count({ production_status: 'not_started' }), 0),
    guard('orders.delivered', base44.entities.Order.count({ delivery_status: 'delivered', created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('tickets.open', base44.entities.SupportTicket.count({ status: { $in: ticketOpenStatuses } }), 0),
    guard('tickets.urgent', base44.entities.SupportTicket.count({ priority: 'urgent', status: { $nin: ticketClosedStatuses } }), 0),
    guard('tickets.slaBreached', base44.entities.SupportTicket.count({ sla_due_date: { $lt: nowIso }, status: { $nin: ticketClosedStatuses } }), 0),
    guard('tickets.today', base44.entities.SupportTicket.count({ created_date: { $gte: startIso, $lte: endIso } }), 0),
    // Deliveries + inventory fail silently (some deployments don't have these
    // tables yet) — a missing optional module shouldn't raise an alarm banner.
    guard('deliveries.today', base44.entities.DeliveryShipment.count({ scheduled_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
    guard('deliveries.needScheduling', base44.entities.DeliveryShipment.count({ status: 'need_scheduling' }), 0, { silent: true }),
    guard('deliveries.shipped', base44.entities.DeliveryShipment.count({ status: 'delivered', scheduled_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
    guard('inventory', fetchInventoryThresholds(), [], { silent: true }),
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

  // KPIs that normally come from the Edge Function. When it failed
  // (stats === null) we backfill them with direct queries so the dashboard
  // shows correct core numbers instead of zeros. This extra round-trip only
  // happens on the degraded path — the healthy path stays a single fan-out.
  let conversion = Number(summary?.conversion?.value || 0);
  let revenue = Number(summary?.revenue?.value || 0);
  let tasksToday = live?.tasks_today?.count || 0;
  let tasksOverdue = live?.tasks_overdue?.count || 0;
  let pendingQuotes = live?.pending_quotes?.count || 0;

  if (!stats) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
    const dayStartIso = dayStart.toISOString();
    const dayEndIso = dayEnd.toISOString();
    const [wonLeads, overdueCount, todayCount, pendingCount, orderTotals] = await Promise.all([
      guard('fallback.wonLeads', base44.entities.Lead.count({ status: 'deal_closed', effective_sort_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
      guard('fallback.tasksOverdue', base44.entities.SalesTask.count({ task_status: 'not_completed', due_date: { $lt: dayStartIso } }), 0, { silent: true }),
      guard('fallback.tasksToday', base44.entities.SalesTask.count({ task_status: 'not_completed', due_date: { $gte: dayStartIso, $lte: dayEndIso } }), 0, { silent: true }),
      guard('fallback.pendingQuotes', base44.entities.Quote.count({ status: 'sent' }), 0, { silent: true }),
      guard('fallback.revenue', fetchOrderTotalsInRange(startIso, endIso), [], { silent: true }),
    ]);
    conversion = newLeadsCount > 0 ? Math.round((wonLeads / newLeadsCount) * 1000) / 10 : 0;
    tasksOverdue = overdueCount;
    tasksToday = todayCount;
    pendingQuotes = pendingCount;
    revenue = orderTotals.reduce((acc, o) => acc + Number(o?.total || 0), 0);
  }

  const tasksOpen = tasksToday + tasksOverdue;
  const avgOrder = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;

  const factoryOverdueAlert = (stats?.smart_alerts || []).find((a) => a.type === 'factory_overdue');

  const sources = marketing?.sources || [];
  // Normalize each source into the same shape the Marketing leaderboard
  // expects (leads_count + closing/handling/lost % + cost + ROI).
  // CRITICAL: getDashboardStats emits each source as
  // { source, leads, won, open, lost, conversion_rate, spend,
  //   attributed_revenue, roas } — NOT leads_count/won_count/cost/revenue.
  // The old mapping read those nonexistent keys, so every source row
  // collapsed to 0 leads / 0% / — even though the leads carry full source
  // data (same bug the reps leaderboard had). We read the Edge Function's
  // real field names first, with the *_count aliases kept as fallbacks for
  // any future shape. `??` (not `||`) so a legit 0 isn't skipped.
  const marketingBreakdown = sources.map((s) => {
    const leads = Number(s.leads_count ?? s.leads ?? s.value ?? 0);
    const won = Number(s.won_count ?? s.won ?? 0);
    const inHandling = Number(s.in_handling_count ?? s.open_count ?? s.open ?? 0);
    const lost = Number(s.lost_count ?? s.lost ?? Math.max(0, leads - won - inHandling));
    const pct = (n) => (leads > 0 ? +((n / leads) * 100).toFixed(1) : 0);
    const cost = Number(s.cost ?? s.spend ?? 0);
    const sourceRevenue = Number(s.revenue ?? s.attributed_revenue ?? 0);
    const conversion = s.conversion != null
      ? Number(s.conversion)
      : (s.conversion_rate != null ? Number(s.conversion_rate) : pct(won));
    const roi = s.roas != null
      ? Number(s.roas)
      : (cost > 0 ? +((sourceRevenue / cost).toFixed(1)) : null);
    return {
      name: s.source || s.name || 'אחר',
      leads_count: leads,
      won_count: won,
      conversion,
      in_handling_rate: s.in_handling_rate != null ? Number(s.in_handling_rate) : pct(inHandling),
      lost_rate: s.lost_rate != null ? Number(s.lost_rate) : pct(lost),
      cost,
      revenue: sourceRevenue,
      roi,
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
    conversion,
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
    tasksOpen,
    tasksToday,
    tasksOverdue,
    pendingQuotes,
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
    _errors: errors,
  };
}

export default function useDashboard2Data({ start, end, enabled = true, label = 'current' }) {
  return useQuery({
    queryKey: ['dashboard2', label, start?.toISOString(), end?.toISOString()],
    queryFn: () => fetchDashboard2Snapshot({ start, end, label }),
    enabled: enabled && !!start && !!end,
    staleTime: 45 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
