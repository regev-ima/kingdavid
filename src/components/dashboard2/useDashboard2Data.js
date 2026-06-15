import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CLOSED_STATUSES } from '@/constants/leadOptions';

// Lead statuses that mean "open / not yet decided". Used for the
// פתוחים סה״כ KPI and the no-answer carve-out.
const NO_ANSWER_STATUSES = [
  'no_answer_1', 'no_answer_2', 'no_answer_3', 'no_answer_4', 'no_answer_5',
  'no_answer_whatsapp_sent', 'no_answer_calls',
];

// "מזרונים בייצור" = anything actively on the floor: materials_check,
// in_production, qc. (`not_started`/`ready` have their own tiles.)
const IN_PRODUCTION_STATUSES = ['materials_check', 'in_production', 'qc'];

const TICKET_OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'];
const TICKET_CLOSED_STATUSES = ['resolved', 'closed'];

// Cap every call so one slow/hanging request can't freeze the dashboard.
const CALL_TIMEOUT_MS = 20000;
function withTimeout(promise, ms = CALL_TIMEOUT_MS) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`נתקע (timeout מעל ${Math.round(ms / 1000)} שניות)`)), ms)),
  ]);
}
function makeGuard(errors) {
  return (source, promise, fallback, { silent = false, timeout = CALL_TIMEOUT_MS } = {}) =>
    withTimeout(promise, timeout).catch((e) => {
      if (!silent) errors.push({ source, message: e?.message || String(e) });
      return fallback;
    });
}

// Low-stock count needs to compare two columns (qty_on_hand ≤ min_threshold),
// which PostgREST can't filter server-side — so we fetch those two columns,
// paged. This is the single slowest call on the dashboard, so it lives in its
// own query (off the first-paint critical path) and is range-independent.
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

// Sum of order revenue for a date range. Fetches just the `total` column (paged)
// so it stays light. Used for the previous-period delta and the stats fallback.
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

// ── Live (range-INDEPENDENT) snapshot ───────────────────────────────────────
// Point-in-time counts that are the same regardless of the selected date range
// (open tickets, unpaid/in-production orders, open/no-answer leads, …). Split
// into its own cached query so switching the date range NO LONGER refetches
// them — that was a big chunk of the "every range change takes forever" cost.
async function fetchLiveSnapshot() {
  const nowIso = new Date().toISOString();
  const errors = [];
  const guard = makeGuard(errors);

  const [
    openLeadsTotal,
    noAnswerLeads,
    unpaidOrders,
    inProduction,
    readyForDelivery,
    notStartedProduction,
    openTickets,
    urgentTickets,
    slaBreachedTickets,
    deliveriesNeedScheduling,
  ] = await Promise.all([
    guard('leads.open', base44.entities.Lead.count({ status: { $nin: CLOSED_STATUSES } }), 0),
    guard('leads.noAnswer', base44.entities.Lead.count({ status: { $in: NO_ANSWER_STATUSES } }), 0),
    guard('orders.unpaid', base44.entities.Order.count({ payment_status: { $in: ['unpaid', 'deposit_paid'] } }), 0),
    guard('orders.inProduction', base44.entities.Order.count({ production_status: { $in: IN_PRODUCTION_STATUSES } }), 0),
    guard('orders.ready', base44.entities.Order.count({ production_status: 'ready' }), 0),
    guard('orders.notStarted', base44.entities.Order.count({ production_status: 'not_started' }), 0),
    guard('tickets.open', base44.entities.SupportTicket.count({ status: { $in: TICKET_OPEN_STATUSES } }), 0),
    guard('tickets.urgent', base44.entities.SupportTicket.count({ priority: 'urgent', status: { $nin: TICKET_CLOSED_STATUSES } }), 0),
    guard('tickets.slaBreached', base44.entities.SupportTicket.count({ sla_due_date: { $lt: nowIso }, status: { $nin: TICKET_CLOSED_STATUSES } }), 0),
    guard('deliveries.needScheduling', base44.entities.DeliveryShipment.count({ status: 'need_scheduling' }), 0, { silent: true }),
  ]);

  return {
    openLeadsTotal,
    noAnswerLeads,
    unpaidOrders,
    inProduction,
    readyForDelivery,
    notStartedProduction,
    openTickets,
    urgentTickets,
    slaBreachedTickets,
    deliveriesNeedScheduling,
    _errors: errors,
  };
}

async function fetchLowStock() {
  try {
    const inventory = await fetchInventoryThresholds();
    return (inventory || []).filter((item) => {
      if (!item || !item.min_threshold) return false;
      return Number(item.qty_on_hand || 0) <= Number(item.min_threshold);
    }).length;
  } catch {
    return 0; // optional module — never block / alarm on it
  }
}

// ── Range-DEPENDENT snapshot (current period) ───────────────────────────────
// getDashboardStats (KPIs, reps, marketing, trends) + the few counts that are
// actually scoped to the selected window. This is the only thing that refetches
// when the range changes.
async function fetchRangeSnapshot({ start, end }) {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const errors = [];
  const guard = makeGuard(errors);

  const invokeStats = () =>
    base44.functions.invoke('getDashboardStats', { startDate: startIso, endDate: endIso });

  const [
    stats,
    newLeadsCount,
    ordersCount,
    paidOrders,
    deliveredOrders,
    ticketsOpenedToday,
    deliveriesToday,
    deliveriesShipped,
  ] = await Promise.all([
    guard('getDashboardStats', invokeStats(), null),
    guard('leads.new', base44.entities.Lead.count({ effective_sort_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('orders.count', base44.entities.Order.count({ created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('orders.paid', base44.entities.Order.count({ payment_status: 'paid', created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('orders.delivered', base44.entities.Order.count({ delivery_status: 'delivered', created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('tickets.today', base44.entities.SupportTicket.count({ created_date: { $gte: startIso, $lte: endIso } }), 0),
    guard('deliveries.today', base44.entities.DeliveryShipment.count({ scheduled_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
    guard('deliveries.shipped', base44.entities.DeliveryShipment.count({ status: 'delivered', scheduled_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
  ]);

  const summary = stats?.summary_kpis || {};
  const live = stats?.live_pipeline || {};
  const trends = stats?.trends || {};
  const marketing = stats?.marketing_performance || {};

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

  // KPIs that normally come from the Edge Function. When it failed (null) we
  // backfill them with direct queries so the dashboard shows correct core
  // numbers instead of zeros — only on the degraded path.
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
  // getDashboardStats emits each source as { source, leads, won, open, lost,
  // conversion_rate, spend, attributed_revenue, roas }. Read the real keys
  // first, keep *_count aliases as fallbacks, use ?? so a legit 0 survives.
  const marketingBreakdown = sources.map((s) => {
    const leads = Number(s.leads_count ?? s.leads ?? s.value ?? 0);
    const won = Number(s.won_count ?? s.won ?? 0);
    const inHandling = Number(s.in_handling_count ?? s.open_count ?? s.open ?? 0);
    const lost = Number(s.lost_count ?? s.lost ?? Math.max(0, leads - won - inHandling));
    const pct = (n) => (leads > 0 ? +((n / leads) * 100).toFixed(1) : 0);
    const cost = Number(s.cost ?? s.spend ?? 0);
    const sourceRevenue = Number(s.revenue ?? s.attributed_revenue ?? 0);
    const conversionRate = s.conversion != null
      ? Number(s.conversion)
      : (s.conversion_rate != null ? Number(s.conversion_rate) : pct(won));
    const roi = s.roas != null
      ? Number(s.roas)
      : (cost > 0 ? +((sourceRevenue / cost).toFixed(1)) : null);
    return {
      name: s.source || s.name || 'אחר',
      leads_count: leads,
      won_count: won,
      conversion: conversionRate,
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
    newLeadsCount,
    conversion,
    revenue,
    ordersCount,
    avgOrder,
    paidOrders,
    deliveredOrders,
    factoryOverdue: factoryOverdueAlert?.impact || 0,
    ticketsOpenedToday,
    tasksOpen,
    tasksToday,
    tasksOverdue,
    pendingQuotes,
    marketingCost,
    marketingLeads,
    topSource,
    marketingRoi,
    deliveriesToday,
    deliveriesShipped,
    leadsTrend: (trends?.leads_daily || []).map((r) => ({ date: r.date, value: r.value })),
    revenueTrend: (trends?.revenue_daily || []).map((r) => ({ date: r.date, value: r.value })),
    sourceBreakdown: marketingBreakdown.map((s) => ({ name: s.name, value: s.leads_count })),
    marketingBreakdown,
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

// ── Previous period (light) — only the 3 range-dependent deltas HeroStrip
// shows (leads / orders / revenue). No Edge Function call: the old version
// invoked getDashboardStats a SECOND time just for revenue, doubling the
// heaviest request for one number.
async function fetchPreviousSnapshot({ start, end }) {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const errors = [];
  const guard = makeGuard(errors);

  const [newLeadsCount, ordersCount, orderTotals] = await Promise.all([
    guard('prev.leads', base44.entities.Lead.count({ effective_sort_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
    guard('prev.orders', base44.entities.Order.count({ created_date: { $gte: startIso, $lte: endIso } }), 0, { silent: true }),
    guard('prev.revenue', fetchOrderTotalsInRange(startIso, endIso), [], { silent: true }),
  ]);

  return {
    newLeadsCount,
    ordersCount,
    revenue: orderTotals.reduce((acc, o) => acc + Number(o?.total || 0), 0),
    _errors: errors,
  };
}

export function useDashboard2Live({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['dashboard2', 'live'],
    queryFn: fetchLiveSnapshot,
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useDashboard2LowStock({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['dashboard2', 'lowStock'],
    queryFn: fetchLowStock,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useDashboard2Previous({ start, end, enabled = true }) {
  return useQuery({
    queryKey: ['dashboard2', 'prev', start?.toISOString(), end?.toISOString()],
    queryFn: () => fetchPreviousSnapshot({ start, end }),
    enabled: enabled && !!start && !!end,
    staleTime: 45 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export default function useDashboard2Data({ start, end, enabled = true }) {
  return useQuery({
    queryKey: ['dashboard2', 'range', start?.toISOString(), end?.toISOString()],
    queryFn: () => fetchRangeSnapshot({ start, end }),
    enabled: enabled && !!start && !!end,
    staleTime: 45 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
