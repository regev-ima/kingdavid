// Dashboard control-center stats. CORS reflects the canonical site + Vercel
// previews (see _shared/supabase.ts) so the dashboard works during PR review.
import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

const SLA_RED_MINUTES = 15;
const EXPIRING_QUOTES_DAYS = 3;
const FAILING_CAMPAIGN_MIN_VOLUME = 8;
const FAILING_CAMPAIGN_MIN_CONVERSION = 2;
const STUCK_LEAD_DAYS = 7;

// Lead statuses that terminate the sales pipeline. Anything not in this set
// is considered "open" for the unassigned/stuck-leads alerts. Mirrors
// CLOSED_STATUSES in src/constants/leadOptions.js — kept in sync manually
// since edge functions can't import frontend modules.
const CLOSED_LEAD_STATUSES = [
  'deal_closed',
  'not_relevant_duplicate',
  'mailing_remove_request',
  'lives_far_phone_concern',
  'products_not_available',
  'not_relevant_bought_elsewhere',
  'not_relevant_1000_nis',
  'not_relevant_denies_contact',
  'not_relevant_service',
  'not_interested_hangs_up',
  'not_relevant_no_explanation',
  'heard_price_not_interested',
  'not_relevant_wrong_number',
  'closed_by_manager_to_mailing',
];

function normalizeLower(v: unknown) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function normalizeString(v: unknown) { return typeof v === 'string' ? v.trim() : ''; }
function safeNumber(v: unknown) { if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v === 'string') { const p = Number(v.replace(/[,$\s]/g, '')); return Number.isFinite(p) ? p : 0; } return 0; }

function parseDateLoose(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return !Number.isNaN(value.getTime()) ? value : null;
  if (typeof value === 'number') { const d = new Date(value); return !Number.isNaN(d.getTime()) ? d : null; }
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) ? d : null;
}

function isLeadWon(status: unknown) { return normalizeLower(status) === 'deal_closed'; }

const CLOSED_LEAD_STATUS_SET = new Set(CLOSED_LEAD_STATUSES);
// "Lost" = any terminal status that isn't a win, so a source/campaign can
// report real סגירה/בטיפול/אבד instead of lumping everything not-won as lost.
function isLeadClosed(status: unknown) { return CLOSED_LEAD_STATUS_SET.has(normalizeLower(status)); }

// Where did the lead come from? Prefer explicit utm_source/source, but
// Facebook lead-form leads frequently arrive with no utm_source while
// carrying facebook_* metadata — attribute those by platform so they don't
// all collapse into "אחר". Returns '' when nothing is known (→ normalizeSource → other).
function deriveSource(lead: any) {
  const explicit = normalizeString(lead?.utm_source) || normalizeString(lead?.source);
  if (explicit) return explicit;
  const platform = normalizeLower(lead?.facebook_platform);
  if (platform) return platform; // 'facebook' / 'instagram' (present only on SELECT * fallback)
  // Confirmed facebook_* lead-form columns — their presence means Facebook.
  if (lead?.facebook_campaign_name || lead?.facebook_ad_name || lead?.facebook_adset_name
      || lead?.facebook_lead_id || lead?.facebook_form_id) return 'facebook';
  return '';
}

function normalizeSource(source: unknown) {
  const v = normalizeLower(source);
  if (!v) return 'other';
  if (v.includes('facebook') || v === 'fb' || v.includes('meta')) return 'facebook';
  if (v.includes('instagram') || v === 'ig') return 'instagram';
  if (v.includes('google') || v.includes('adwords') || v.includes('gads')) return 'google';
  if (v.includes('tiktok')) return 'tiktok';
  if (v.includes('taboola')) return 'taboola';
  if (v.includes('outbrain')) return 'outbrain';
  if (v.includes('whatsapp')) return 'whatsapp';
  return v;
}

function normalizeCampaign(c: unknown) { return normalizeString(c) || 'ללא קמפיין'; }

function aggregateTrend(items: any[], dateField: string, valueField?: string) {
  const map = new Map<string, number>();
  items.forEach(item => {
    const d = parseDateLoose(item?.[dateField]);
    if (!d) return;
    const key = d.toISOString().slice(0, 10);
    const delta = valueField ? safeNumber(item?.[valueField]) : 1;
    map.set(key, (map.get(key) || 0) + delta);
  });
  return Array.from(map.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

function getSeverityWeight(s: string) { if (s === 'critical') return 4; if (s === 'high') return 3; if (s === 'medium') return 2; return 1; }

// Page through a table. `columns` lets callers fetch only what they use —
// critical for `leads`, which has ~40 columns (every utm_*/facebook_* field)
// and dominates this function's payload + CPU on wide date ranges. If a
// projected column doesn't exist in this deployment's schema the projected
// query errors; rather than sink the whole table (and the dashboard) we retry
// once with SELECT * — i.e. degrade to "slower but correct", never empty.
async function fetchAll(supabase: any, table: string, query: any, columns = '*') {
  const runWith = async (cols: string) => {
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let q = supabase.from(table).select(cols).range(from, from + batchSize - 1);
      if (query.gte) for (const [col, val] of Object.entries(query.gte)) q = q.gte(col, val);
      if (query.lte) for (const [col, val] of Object.entries(query.lte)) q = q.lte(col, val);
      if (query.lt) for (const [col, val] of Object.entries(query.lt)) q = q.lt(col, val);
      if (query.eq) for (const [col, val] of Object.entries(query.eq)) q = q.eq(col, val);
      if (query.order) q = q.order(query.order, { ascending: query.ascending ?? false });
      const { data, error } = await q;
      if (error) throw error;
      allData = allData.concat(data || []);
      if (!data || data.length < batchSize) break;
      from += batchSize;
    }
    return allData;
  };
  if (columns === '*') return runWith('*');
  try {
    return await runWith(columns);
  } catch (e) {
    console.warn(`[getDashboardStats] column projection on "${table}" failed, retrying with *:`, e);
    return runWith('*');
  }
}

// Only the lead columns this function reads — keeps the heaviest query lean so
// wide ranges (30/60/90 days) don't time out. `deriveSource`/campaign use the
// confirmed facebook_* name columns; the SELECT * fallback in fetchAll covers
// any column that's absent in a given deployment.
const LEAD_COLUMNS = 'id,status,rep1,created_date,effective_sort_date,first_action_at,utm_source,source,utm_campaign,landing_page,facebook_campaign_name,facebook_ad_name,facebook_adset_name';

Deno.serve(async (req) => {
  // Reflect the caller's origin (canonical site + Vercel previews) so the
  // dashboard works during PR review, not only on production.
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

    const supabase = createServiceClient();
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    let start = body.startDate ? new Date(String(body.startDate)) : todayStart;
    let end = body.endDate ? new Date(String(body.endDate)) : todayEnd;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { start = todayStart; end = todayEnd; }
    if (start > end) { const tmp = start; start = end; end = tmp; }

    const startIso = start.toISOString();
    const endIso = end.toISOString();

    // Manager-action alerts ignore the dashboard's date range — admins want
    // "X leads waiting to be assigned" and "X leads neglected over a week"
    // as facts about the live pipeline, not a slice of the selected window.
    const stuckCutoffIso = new Date(now.getTime() - STUCK_LEAD_DAYS * 86400000).toISOString();
    const closedStatusesList = `(${CLOSED_LEAD_STATUSES.join(',')})`;

    // Resilience: a single missing table/column (or a transient query error)
    // must NOT 500 the entire dashboard — that turns every tile into a zero on
    // the client and hides which source actually broke. Each source degrades to
    // a neutral fallback and is recorded in `failures`, so the client still
    // receives every section that could be computed.
    const failures: string[] = [];
    const safe = async <T>(name: string, p: PromiseLike<T>, fallback: T): Promise<T> => {
      try { return await p; } catch (e) {
        console.error(`[getDashboardStats] ${name} failed:`, e);
        failures.push(name);
        return fallback;
      }
    };

    // Heavy lead/order/quote aggregation runs in Postgres (dashboard_stats_v1)
    // — one call returns pre-summed rows instead of pulling thousands of raw
    // rows per request. Everything else here is small/point-in-time. The RPC
    // is fetched alongside; if it's unavailable we fall back to the raw scan.
    const [statsRpc, rangeMarketingCosts, allUsers, overdueTasks, todayTasks, sentQuotes, unassignedLeadsCountRes, stuckLeadsCountRes] = await Promise.all([
      safe('dashboardStatsRpc', supabase.rpc('dashboard_stats_v1', { p_start: startIso, p_end: endIso }).then((r: any) => { if (r.error) throw r.error; return r.data; }), null as any),
      safe('marketing_costs', fetchAll(supabase, 'marketing_costs', { gte: { date: startIso }, lte: { date: endIso }, order: 'date' }), [] as any[]),
      safe('users', supabase.from('users').select('email,full_name,role,profile_icon').then((r: any) => { if (r.error) throw r.error; return r.data || []; }), [] as any[]),
      safe('overdueTasks', fetchAll(supabase, 'sales_tasks', { eq: { task_status: 'not_completed' }, lt: { due_date: todayStart.toISOString() }, order: 'due_date' }), [] as any[]),
      safe('todayTasks', fetchAll(supabase, 'sales_tasks', { eq: { task_status: 'not_completed' }, gte: { due_date: todayStart.toISOString() }, lte: { due_date: todayEnd.toISOString() }, order: 'due_date' }), [] as any[]),
      safe('sentQuotes', fetchAll(supabase, 'quotes', { eq: { status: 'sent' }, order: 'created_date' }), [] as any[]),
      safe('unassignedLeads', supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .or('rep1.is.null,rep1.eq.""')
        .not('status', 'in', closedStatusesList), { count: 0 } as any),
      safe('stuckLeads', supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .not('rep1', 'is', null)
        .neq('rep1', '')
        .lt('effective_sort_date', stuckCutoffIso)
        .not('status', 'in', closedStatusesList), { count: 0 } as any),
    ]);

    const unassignedLeadsCount = unassignedLeadsCountRes?.count || 0;
    const stuckLeadsCount = stuckLeadsCountRes?.count || 0;
    const openTaskCount = overdueTasks.length + todayTasks.length;

    // Marketing maps — populated identically whether the numbers come from the
    // SQL function (fast) or the raw scan (fallback).
    const sourceMap = new Map();
    const campaignMap = new Map();
    const landingPageMap = new Map();
    const getSourceRow = (source: string) => {
      if (!sourceMap.has(source)) sourceMap.set(source, { source, leads: 0, won: 0, lost: 0, open: 0, quote_sent: 0, conversion_rate: 0, quote_rate: 0, attributed_revenue: 0, spend: 0, roas: null, cost_per_lead: 0 });
      return sourceMap.get(source);
    };
    const getCampaignRow = (campaign: string, source = 'other') => {
      if (!campaignMap.has(campaign)) campaignMap.set(campaign, { campaign, source, leads: 0, won: 0, lost: 0, open: 0, quote_sent: 0, conversion_rate: 0, quote_rate: 0, attributed_revenue: 0, spend: 0, roas: null, cost_per_lead: 0 });
      const row = campaignMap.get(campaign);
      if (row.source === 'other' && source !== 'other') row.source = source;
      return row;
    };
    const getLandingPageRow = (lp: string, source = 'other') => {
      if (!landingPageMap.has(lp)) landingPageMap.set(lp, { landing_page: lp, source, leads: 0, won: 0, lost: 0, open: 0, quote_sent: 0, conversion_rate: 0, quote_rate: 0, attributed_revenue: 0 });
      const row = landingPageMap.get(lp);
      if (row.source === 'other' && source !== 'other') row.source = source;
      return row;
    };

    let rangeLeadsCount = 0;
    let rangeWonLeadsCount = 0;
    let rangeRevenue = 0;
    let liveSlaRedCount = 0;
    let leadsTrend: any[] = [];
    let revenueTrend: any[] = [];
    const repAgg = new Map<string, { leads: number; won: number; revenue: number; slaRed: number }>();
    const bumpRep = (email: string) => {
      if (!repAgg.has(email)) repAgg.set(email, { leads: 0, won: 0, revenue: 0, slaRed: 0 });
      return repAgg.get(email)!;
    };

    if (statsRpc) {
      // ── Fast path: Postgres already did the GROUP BYs. Normalize the raw
      // source/campaign keys + merge here (small arrays, single source of truth
      // for normalization stays in JS).
      const d: any = statsRpc;
      rangeLeadsCount = safeNumber(d.summary?.leads);
      rangeWonLeadsCount = safeNumber(d.summary?.won);
      rangeRevenue = safeNumber(d.summary?.revenue);
      liveSlaRedCount = safeNumber(d.summary?.sla_red);
      (d.lead_sources || []).forEach((r: any) => { const row = getSourceRow(normalizeSource(r.k)); row.leads += safeNumber(r.leads); row.won += safeNumber(r.won); row.lost += safeNumber(r.lost); row.open += safeNumber(r.open); row.quote_sent += safeNumber(r.quote_sent); });
      (d.src_rev || []).forEach((r: any) => { getSourceRow(normalizeSource(r.k)).attributed_revenue += safeNumber(r.revenue); });
      (d.lead_campaigns || []).forEach((r: any) => { const row = getCampaignRow(normalizeCampaign(r.k), normalizeSource(r.src)); row.leads += safeNumber(r.leads); row.won += safeNumber(r.won); row.lost += safeNumber(r.lost); row.open += safeNumber(r.open); row.quote_sent += safeNumber(r.quote_sent); });
      (d.camp_rev || []).forEach((r: any) => { getCampaignRow(normalizeCampaign(r.k)).attributed_revenue += safeNumber(r.revenue); });
      (d.lead_lps || []).forEach((r: any) => { const row = getLandingPageRow(normalizeString(r.k) || 'ללא דף נחיתה', normalizeSource(r.src)); row.leads += safeNumber(r.leads); row.won += safeNumber(r.won); row.lost += safeNumber(r.lost); row.open += safeNumber(r.open); row.quote_sent += safeNumber(r.quote_sent); });
      (d.lp_rev || []).forEach((r: any) => { getLandingPageRow(normalizeString(r.k) || 'ללא דף נחיתה').attributed_revenue += safeNumber(r.revenue); });
      (d.reps || []).forEach((r: any) => { const e = normalizeLower(r.email); if (e) repAgg.set(e, { leads: safeNumber(r.leads), won: safeNumber(r.won), revenue: safeNumber(r.revenue), slaRed: safeNumber(r.sla_red) }); });
      leadsTrend = (d.leads_daily || []).map((x: any) => ({ date: x.date, value: safeNumber(x.value) }));
      revenueTrend = (d.revenue_daily || []).map((x: any) => ({ date: x.date, value: safeNumber(x.value) }));
    } else {
      // ── Fallback: scan the raw rows in JS (the previous behaviour). Slower,
      // but keeps the dashboard correct if the SQL function isn't deployed yet.
      const [rangeLeads, rangeOrders, rangeQuotes] = await Promise.all([
        safe('leads', fetchAll(supabase, 'leads', { gte: { effective_sort_date: startIso }, lte: { effective_sort_date: endIso }, order: 'effective_sort_date' }, LEAD_COLUMNS), [] as any[]),
        safe('orders', fetchAll(supabase, 'orders', { gte: { created_date: startIso }, lte: { created_date: endIso }, order: 'created_date' }), [] as any[]),
        safe('quotes', fetchAll(supabase, 'quotes', { gte: { created_date: startIso }, lte: { created_date: endIso }, order: 'created_date' }), [] as any[]),
      ]);
      const rangeLeadsById = new Map(rangeLeads.map((l: any) => [l.id, l]));
      const leadsWithQuoteRange = new Set(rangeQuotes.map((q: any) => q.lead_id).filter(Boolean));
      const slaRedLeads = rangeLeads.filter((l: any) => {
        if (l.first_action_at) return false;
        const c = parseDateLoose(l.created_date);
        return c ? ((now.getTime() - c.getTime()) / 60000) > SLA_RED_MINUTES : false;
      });
      rangeLeadsCount = rangeLeads.length;
      rangeWonLeadsCount = rangeLeads.filter((l: any) => isLeadWon(l.status)).length;
      rangeRevenue = rangeOrders.reduce((a: number, o: any) => a + safeNumber(o.total), 0);
      liveSlaRedCount = slaRedLeads.length;
      slaRedLeads.forEach((l: any) => { const e = normalizeLower(l.rep1); if (e) bumpRep(e).slaRed += 1; });

      rangeLeads.forEach((lead: any) => {
        const source = normalizeSource(deriveSource(lead));
        const campaign = normalizeCampaign(lead.utm_campaign || lead.facebook_campaign_name);
        const lp = normalizeString(lead.landing_page) || 'ללא דף נחיתה';
        const sRow = getSourceRow(source);
        const cRow = getCampaignRow(campaign, source);
        const lRow = getLandingPageRow(lp, source);
        sRow.leads += 1; cRow.leads += 1; lRow.leads += 1;
        const won = isLeadWon(lead.status);
        if (won) { sRow.won += 1; cRow.won += 1; lRow.won += 1; }
        else if (isLeadClosed(lead.status)) { sRow.lost += 1; cRow.lost += 1; lRow.lost += 1; }
        else { sRow.open += 1; cRow.open += 1; lRow.open += 1; }
        if (leadsWithQuoteRange.has(lead.id)) { sRow.quote_sent += 1; cRow.quote_sent += 1; lRow.quote_sent += 1; }
        const e = normalizeLower(lead.rep1);
        if (e) { const ra = bumpRep(e); ra.leads += 1; if (won) ra.won += 1; }
      });

      rangeOrders.forEach((order: any) => {
        const lead = order.lead_id ? rangeLeadsById.get(order.lead_id) : null;
        const source = normalizeSource((lead && deriveSource(lead)) || order.source);
        const campaign = normalizeCampaign(lead?.utm_campaign || lead?.facebook_campaign_name);
        const lp = normalizeString(lead?.landing_page) || 'ללא דף נחיתה';
        const total = safeNumber(order.total);
        getSourceRow(source).attributed_revenue += total;
        getCampaignRow(campaign, source).attributed_revenue += total;
        getLandingPageRow(lp, source).attributed_revenue += total;
        const e = normalizeLower(order.rep1) || (lead ? normalizeLower(lead.rep1) : '');
        if (e) bumpRep(e).revenue += total;
      });

      leadsTrend = aggregateTrend(rangeLeads, 'effective_sort_date');
      revenueTrend = aggregateTrend(rangeOrders, 'created_date', 'total');
    }

    // Spend comes from the (small) marketing_costs table — merged in JS either
    // way so we never have to reference its columns from SQL.
    rangeMarketingCosts.forEach((cost: any) => {
      const source = normalizeSource(cost.source || cost.utm_source || cost.channel || cost.platform);
      const campaign = normalizeCampaign(cost.campaign_name || cost.campaign || cost.utm_campaign);
      const amount = safeNumber(cost.amount);
      getSourceRow(source).spend += amount;
      getCampaignRow(campaign, source).spend += amount;
    });

    const expiringQuotes = sentQuotes.map((q: any) => {
      const vu = parseDateLoose(q.valid_until);
      if (!vu) return null;
      const dl = Math.ceil((vu.getTime() - now.getTime()) / 86400000);
      if (dl < 0 || dl > EXPIRING_QUOTES_DAYS) return null;
      return { id: q.id, quote_number: q.quote_number, customer_name: q.customer_name, total: safeNumber(q.total), valid_until: q.valid_until, days_left: dl };
    }).filter(Boolean).slice(0, 8);

    const pendingQuotesLive = sentQuotes.filter((q: any) => {
      if (!q.valid_until) return true;
      const vu = parseDateLoose(q.valid_until);
      return vu ? vu >= todayStart : true;
    });

    const rangeConversionRate = rangeLeadsCount > 0 ? Math.round((rangeWonLeadsCount / rangeLeadsCount) * 1000) / 10 : 0;
    const rangeSlaCompliance = rangeLeadsCount > 0 ? Math.max(0, Math.round(((rangeLeadsCount - liveSlaRedCount) / rangeLeadsCount) * 1000) / 10) : 100;

    const summary_kpis = {
      revenue: { value: rangeRevenue, currency: 'ILS', label: 'הכנסות בטווח' },
      conversion: { value: rangeConversionRate, won_leads: rangeWonLeadsCount, total_leads: rangeLeadsCount, label: 'המרה', unit: '%' },
      sla: { value: rangeSlaCompliance, red_count: liveSlaRedCount, threshold_minutes: SLA_RED_MINUTES, label: 'SLA תקין', unit: '%' },
      open_workload: { value: openTaskCount, label: 'עומס פתוח' },
    };

    const live_pipeline = {
      tasks_overdue: { count: overdueTasks.length, label: 'משימות באיחור' },
      tasks_today: { count: todayTasks.length, label: 'משימות להיום' },
      sla_red_open: { count: liveSlaRedCount, label: 'SLA אדום פתוח' },
      pending_quotes: { count: pendingQuotesLive.length, label: 'הצעות ממתינות' },
    };

    // Rep performance — one row per active rep (admin/user), filled from the
    // aggregated counts + live task workload.
    const repRows = (allUsers as any[]).filter(u => u.role === 'admin' || u.role === 'user').map(rep => {
      const repEmail = normalizeLower(rep.email);
      const agg = repAgg.get(repEmail) || { leads: 0, won: 0, revenue: 0, slaRed: 0 };
      const repTasksOverdue = overdueTasks.filter((t: any) => normalizeLower(t.rep1) === repEmail || normalizeLower(t.rep2) === repEmail);
      const repTasksToday = todayTasks.filter((t: any) => normalizeLower(t.rep1) === repEmail || normalizeLower(t.rep2) === repEmail);
      return {
        rep_name: rep.full_name || rep.email,
        rep_email: rep.email,
        profile_icon: rep.profile_icon || null,
        leads_range: agg.leads,
        won_range: agg.won,
        conversion_rate: agg.leads > 0 ? Math.round((agg.won / agg.leads) * 1000) / 10 : 0,
        revenue: agg.revenue,
        workload_open_tasks: repTasksOverdue.length + repTasksToday.length,
        workload_overdue_tasks: repTasksOverdue.length,
        sla_red_open: agg.slaRed,
      };
    }).sort((a, b) => b.revenue !== a.revenue ? b.revenue - a.revenue : b.conversion_rate - a.conversion_rate);

    const finalizeMktRow = (row: any) => {
      row.conversion_rate = row.leads > 0 ? Math.round((row.won / row.leads) * 1000) / 10 : 0;
      row.quote_rate = row.leads > 0 ? Math.round((row.quote_sent / row.leads) * 1000) / 10 : 0;
      row.roas = row.spend > 0 ? Math.round((row.attributed_revenue / row.spend) * 100) / 100 : null;
      row.cost_per_lead = row.leads > 0 ? Math.round(row.spend / row.leads) : 0;
      return row;
    };
    const finalizeLpRow = (row: any) => {
      row.conversion_rate = row.leads > 0 ? Math.round((row.won / row.leads) * 1000) / 10 : 0;
      row.quote_rate = row.leads > 0 ? Math.round((row.quote_sent / row.leads) * 1000) / 10 : 0;
      return row;
    };

    const sourceRows = Array.from(sourceMap.values()).map(finalizeMktRow).sort((a: any, b: any) => b.leads - a.leads);
    const campaignRows = Array.from(campaignMap.values()).map(finalizeMktRow).sort((a: any, b: any) => b.leads - a.leads);
    const landingPageRows = Array.from(landingPageMap.values()).map(finalizeLpRow).sort((a: any, b: any) => b.leads - a.leads);
    const failingCampaigns = campaignRows.filter((c: any) => c.leads >= FAILING_CAMPAIGN_MIN_VOLUME && (c.won === 0 || c.conversion_rate < FAILING_CAMPAIGN_MIN_CONVERSION));

    // Smart alerts
    const smart_alerts: any[] = [];
    if (liveSlaRedCount > 0) smart_alerts.push({ id: 'sla_red_open', type: 'sla_red', severity: liveSlaRedCount >= 25 ? 'critical' : liveSlaRedCount >= 10 ? 'high' : 'medium', owner: 'צוות מכירות', impact: liveSlaRedCount, reason: `${liveSlaRedCount} לידים ללא מענה מעל ${SLA_RED_MINUTES} דקות` });
    if (unassignedLeadsCount > 0) smart_alerts.push({ id: 'unassigned_leads', type: 'unassigned_leads', severity: unassignedLeadsCount >= 25 ? 'critical' : unassignedLeadsCount >= 10 ? 'high' : 'medium', owner: 'מנהל מכירות', impact: unassignedLeadsCount, reason: `${unassignedLeadsCount} לידים ממתינים לשיוך לנציג` });
    if (overdueTasks.length > 0) smart_alerts.push({ id: 'tasks_overdue', type: 'tasks_overdue', severity: overdueTasks.length >= 30 ? 'critical' : overdueTasks.length >= 12 ? 'high' : 'medium', owner: 'צוות מכירות', impact: overdueTasks.length, reason: `${overdueTasks.length} משימות באיחור דורשות טיפול` });
    if (stuckLeadsCount > 0) smart_alerts.push({ id: 'stuck_leads', type: 'stuck_leads', severity: stuckLeadsCount >= 30 ? 'critical' : stuckLeadsCount >= 10 ? 'high' : 'medium', owner: 'מנהל מכירות', impact: stuckLeadsCount, reason: `${stuckLeadsCount} לידים פתוחים שלא נגעו בהם מעל ${STUCK_LEAD_DAYS} ימים` });
    if (failingCampaigns.length > 0) smart_alerts.push({ id: 'failing_campaigns', type: 'failing_campaign', severity: failingCampaigns.length >= 3 ? 'high' : 'medium', owner: 'שיווק', impact: failingCampaigns.slice(0, 3).reduce((a: number, i: any) => a + i.leads, 0), reason: `קמפיינים חלשים: ${failingCampaigns.slice(0, 3).map((i: any) => i.campaign).join(' • ')}` });
    if (expiringQuotes.length > 0) smart_alerts.push({ id: 'expiring_quotes', type: 'expiring_quotes', severity: expiringQuotes.length >= 10 ? 'high' : 'low', owner: 'צוות מכירות', impact: expiringQuotes.length, reason: `${expiringQuotes.length} הצעות יפוגו ב-${EXPIRING_QUOTES_DAYS} ימים הקרובים` });
    smart_alerts.sort((a, b) => getSeverityWeight(b.severity) - getSeverityWeight(a.severity));

    return Response.json({
      meta: { generated_at: now.toISOString(), range: { start: startIso, end: endIso }, partial: failures.length > 0, failures },
      summary_kpis,
      live_pipeline,
      sales_performance: { reps: repRows },
      marketing_performance: { totals: { leads: rangeLeadsCount, won_leads: rangeWonLeadsCount, spend: rangeMarketingCosts.reduce((a: number, r: any) => a + safeNumber(r.amount), 0), conversion_rate: rangeConversionRate }, sources: sourceRows, campaigns: campaignRows, landing_pages: landingPageRows },
      smart_alerts,
      trends: { leads_daily: leadsTrend, revenue_daily: revenueTrend },
      tasks: { pending_total: openTaskCount, today: todayTasks.length, overdue: overdueTasks.length },
    }, { headers: cors });
  } catch (error) {
    // Surface the real reason (the client extracts body.error into the failure
    // banner) instead of a generic 500 that hides what actually broke.
    console.error('Function error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `getDashboardStats failed: ${message}` }, { status: 500, headers: cors });
  }
});
