import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const SLA_RED_MINUTES = 15;
const EXPIRING_QUOTES_DAYS = 3;
const FAILING_CAMPAIGN_MIN_VOLUME = 8;
const FAILING_CAMPAIGN_MIN_CONVERSION = 2;
const BATCH_SIZE = 500;

function normalizeLower(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function normalizeString(v) { return typeof v === 'string' ? v.trim() : ''; }
function safeNumber(v) { if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v === 'string') { const p = Number(v.replace(/[,$\s]/g, '')); return Number.isFinite(p) ? p : 0; } return 0; }

function parseDateLoose(value) {
  if (!value) return null;
  if (value instanceof Date) return !Number.isNaN(value.getTime()) ? value : null;
  if (typeof value === 'number') { const d = new Date(value); return !Number.isNaN(d.getTime()) ? d : null; }
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) ? d : null;
}

function isLeadWon(status) { return normalizeLower(status) === 'deal_closed'; }
function isLeadClosed(status) {
  const cs = new Set(['deal_closed','not_relevant_duplicate','mailing_remove_request','lives_far_phone_concern','products_not_available','not_relevant_bought_elsewhere','not_relevant_1000_nis','not_relevant_denies_contact','not_relevant_service','not_interested_hangs_up','not_relevant_no_explanation','heard_price_not_interested','not_relevant_wrong_number','closed_by_manager_to_mailing']);
  return cs.has(normalizeLower(status));
}

function normalizeSource(source) {
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

function normalizeCampaign(c) { return normalizeString(c) || 'ללא קמפיין'; }

async function fetchFiltered(base44, entity, query, sort = '-created_date', maxItems = 10000) {
  const all = [];
  let skip = 0;
  while (all.length < maxItems) {
    const batch = await base44.asServiceRole.entities[entity].filter(query, sort, BATCH_SIZE, skip);
    all.push(...batch);
    if (batch.length < BATCH_SIZE) break;
    skip += BATCH_SIZE;
  }
  return all;
}

function createDrilldowns(startIso: string, endIso: string) {
  return {
    summary_kpis: {
      revenue: { page: 'Orders', query: { tab: 'all' } },
      conversion: { page: 'Leads', query: { tab: 'open' } },
      sla: { page: 'Leads', query: { tab: 'open' } },
      open_workload: { page: 'SalesTasks', query: { tab: 'not_completed' } },
    },
    live_pipeline: {
      tasks_overdue: { page: 'SalesTasks', query: { tab: 'overdue' } },
      tasks_today: { page: 'SalesTasks', query: { tab: 'today' } },
      sla_red_open: { page: 'Leads', query: { tab: 'open' } },
      pending_quotes: { page: 'Quotes', query: { tab: 'pending' } },
    },
    sales_performance: {
      rep_row: {
        page: 'Leads',
        query: {
          tab: 'all',
          rep1: '{rep_email}',
          repScope: 'primary',
          startDate: startIso,
          endDate: endIso,
        },
      },
    },
    marketing_performance: {
      source_row: { page: 'Leads', query: { tab: 'all', source: '{source}' } },
      campaign_row: { page: 'Marketing', query: { utm_campaign: '{campaign}' } },
    },
    smart_alerts: {
      sla_red: { page: 'Leads', query: { tab: 'open' } },
      tasks_overdue: { page: 'SalesTasks', query: { tab: 'overdue' } },
      failing_campaign: { page: 'Marketing', query: {} },
      expiring_quotes: { page: 'Quotes', query: { tab: 'expiring' } },
    },
  };
}

function aggregateTrend(items, dateField, valueField) {
  const map = new Map();
  items.forEach(item => {
    const d = parseDateLoose(item?.[dateField]);
    if (!d) return;
    const key = d.toISOString().slice(0, 10);
    const delta = valueField ? safeNumber(item?.[valueField]) : 1;
    map.set(key, (map.get(key) || 0) + delta);
  });
  return Array.from(map.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

function getSeverityWeight(s) { if (s === 'critical') return 4; if (s === 'high') return 3; if (s === 'medium') return 2; return 1; }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const fallbackStart = todayStart;
    const fallbackEnd = todayEnd;
    let start = body.startDate ? new Date(String(body.startDate)) : fallbackStart;
    let end = body.endDate ? new Date(String(body.endDate)) : fallbackEnd;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { start = fallbackStart; end = fallbackEnd; }
    if (start > end) { const tmp = start; start = end; end = tmp; }

    const rangeQuery = { effective_sort_date: { $gte: start.toISOString(), $lte: end.toISOString() } };
    const orderRangeQuery = { created_date: { $gte: start.toISOString(), $lte: end.toISOString() } };

    // Fetch ONLY what we need - no "fetch all leads in system"
    const [
      rangeLeads,
      rangeOrders,
      rangeQuotes,
      rangeMarketingCosts,
      allUsers,
      overdueTasks,
      todayTasks,
      sentQuotes
    ] = await Promise.all([
      fetchFiltered(base44, 'Lead', rangeQuery, '-effective_sort_date'),
      fetchFiltered(base44, 'Order', orderRangeQuery, '-created_date'),
      fetchFiltered(base44, 'Quote', orderRangeQuery, '-created_date'),
      fetchFiltered(base44, 'MarketingCost', { date: { $gte: start.toISOString(), $lte: end.toISOString() } }, '-date'),
      base44.asServiceRole.entities.User.list(),
      fetchFiltered(base44, 'SalesTask', { task_status: 'not_completed', due_date: { $lt: todayStart.toISOString() } }, '-due_date'),
      fetchFiltered(base44, 'SalesTask', { task_status: 'not_completed', due_date: { $gte: todayStart.toISOString(), $lte: todayEnd.toISOString() } }, '-due_date'),
      fetchFiltered(base44, 'Quote', { status: 'sent' }, '-created_date'),
    ]);

    // Open workload = overdue + today (actionable tasks now)
    const openTaskCount = overdueTasks.length + todayTasks.length;

    // Build lead map from range leads for order attribution
    const rangeLeadsById = new Map(rangeLeads.map(l => [l.id, l]));
    const leadsWithQuoteRange = new Set(rangeQuotes.map(q => q.lead_id).filter(Boolean));

    // SLA: only check range leads
    const rangeSlaRedLeads = rangeLeads.filter(l => {
      if (l.first_action_at) return false;
      const c = parseDateLoose(l.created_date);
      return c ? ((now.getTime() - c.getTime()) / 60000) > SLA_RED_MINUTES : false;
    });

    // Live SLA from open tasks (already filtered by task_status)
    // For live SLA red we check open tasks' leads - but approximate from range
    const liveSlaRedCount = rangeSlaRedLeads.length;

    // Tasks - already fetched filtered from DB
    const tasksOverdue = overdueTasks;
    const tasksToday = todayTasks;

    // Expiring quotes
    const expiringQuotes = sentQuotes.map(q => {
      const vu = parseDateLoose(q.valid_until);
      if (!vu) return null;
      const dl = Math.ceil((vu.getTime() - now.getTime()) / 86400000);
      if (dl < 0 || dl > EXPIRING_QUOTES_DAYS) return null;
      return { id: q.id, quote_number: q.quote_number, customer_name: q.customer_name, total: safeNumber(q.total), valid_until: q.valid_until, days_left: dl };
    }).filter(Boolean).slice(0, 8);

    const pendingQuotesLive = sentQuotes.filter(q => {
      if (!q.valid_until) return true;
      const vu = parseDateLoose(q.valid_until);
      return vu ? vu >= todayStart : true;
    });

    // Summary KPIs
    const rangeRevenue = rangeOrders.reduce((a, o) => a + safeNumber(o.total), 0);
    const rangeLeadsCount = rangeLeads.length;
    const rangeWonLeadsCount = rangeLeads.filter(l => isLeadWon(l.status)).length;
    const rangeConversionRate = rangeLeadsCount > 0 ? Math.round((rangeWonLeadsCount / rangeLeadsCount) * 1000) / 10 : 0;
    const rangeSlaCompliance = rangeLeadsCount > 0 ? Math.max(0, Math.round(((rangeLeadsCount - rangeSlaRedLeads.length) / rangeLeadsCount) * 1000) / 10) : 100;

    const summary_kpis = {
      revenue: { value: rangeRevenue, currency: 'ILS', label: 'הכנסות בטווח' },
      conversion: { value: rangeConversionRate, won_leads: rangeWonLeadsCount, total_leads: rangeLeadsCount, label: 'המרה', unit: '%' },
      sla: { value: rangeSlaCompliance, red_count: rangeSlaRedLeads.length, threshold_minutes: SLA_RED_MINUTES, label: 'SLA תקין', unit: '%' },
      open_workload: { value: openTaskCount, label: 'עומס פתוח' },
    };

    const live_pipeline = {
      tasks_overdue: { count: tasksOverdue.length, label: 'משימות באיחור' },
      tasks_today: { count: tasksToday.length, label: 'משימות להיום' },
      sla_red_open: { count: liveSlaRedCount, label: 'SLA אדום פתוח' },
      pending_quotes: { count: pendingQuotesLive.length, label: 'הצעות ממתינות' },
    };

    // Rep performance - use only range data
    const reps = allUsers.filter(u => u.role === 'admin' || u.role === 'user');
    const repRows = reps.map(rep => {
      const repEmail = normalizeLower(rep.email);
      const repLeads = rangeLeads.filter(l => normalizeLower(l.rep1) === repEmail);
      const repWon = repLeads.filter(l => isLeadWon(l.status)).length;
      const repConversion = repLeads.length > 0 ? Math.round((repWon / repLeads.length) * 1000) / 10 : 0;
      const repRevenue = rangeOrders.reduce((acc, order) => {
        if (normalizeLower(order.rep1) === repEmail) return acc + safeNumber(order.total);
        const lead = order.lead_id ? rangeLeadsById.get(order.lead_id) : null;
        if (lead && normalizeLower(lead.rep1) === repEmail) return acc + safeNumber(order.total);
        return acc;
      }, 0);
      const repTasksOverdue = overdueTasks.filter(t => normalizeLower(t.rep1) === repEmail || normalizeLower(t.rep2) === repEmail);
      const repTasksToday = todayTasks.filter(t => normalizeLower(t.rep1) === repEmail || normalizeLower(t.rep2) === repEmail);
      const repSlaRed = rangeSlaRedLeads.filter(l => normalizeLower(l.rep1) === repEmail).length;

      return {
        rep_name: rep.full_name || rep.email,
        rep_email: rep.email,
        profile_icon: rep.profile_icon || null,
        leads_range: repLeads.length,
        won_range: repWon,
        conversion_rate: repConversion,
        revenue: repRevenue,
        workload_open_tasks: repTasksOverdue.length + repTasksToday.length,
        workload_overdue_tasks: repTasksOverdue.length,
        sla_red_open: repSlaRed,
      };
    }).sort((a, b) => b.revenue !== a.revenue ? b.revenue - a.revenue : b.conversion_rate - a.conversion_rate);

    // Marketing
    const sourceMap = new Map();
    const campaignMap = new Map();
    const landingPageMap = new Map();

    const getSourceRow = (source) => {
      if (!sourceMap.has(source)) sourceMap.set(source, { source, leads: 0, won: 0, quote_sent: 0, conversion_rate: 0, quote_rate: 0, attributed_revenue: 0, spend: 0, roas: null, cost_per_lead: 0 });
      return sourceMap.get(source);
    };
    const getCampaignRow = (campaign, source = 'other') => {
      if (!campaignMap.has(campaign)) campaignMap.set(campaign, { campaign, source, leads: 0, won: 0, quote_sent: 0, conversion_rate: 0, quote_rate: 0, attributed_revenue: 0, spend: 0, roas: null, cost_per_lead: 0 });
      const row = campaignMap.get(campaign);
      if (row.source === 'other' && source !== 'other') row.source = source;
      return row;
    };

    const getLandingPageRow = (lp, source = 'other') => {
      if (!landingPageMap.has(lp)) landingPageMap.set(lp, { landing_page: lp, source, leads: 0, won: 0, quote_sent: 0, conversion_rate: 0, quote_rate: 0, attributed_revenue: 0 });
      const row = landingPageMap.get(lp);
      if (row.source === 'other' && source !== 'other') row.source = source;
      return row;
    };

    rangeLeads.forEach(lead => {
      const source = normalizeSource(lead.utm_source || lead.source);
      const campaign = normalizeCampaign(lead.utm_campaign);
      const lp = normalizeString(lead.landing_page) || 'ללא דף נחיתה';
      getSourceRow(source).leads += 1;
      getCampaignRow(campaign, source).leads += 1;
      getLandingPageRow(lp, source).leads += 1;
      if (isLeadWon(lead.status)) { getSourceRow(source).won += 1; getCampaignRow(campaign, source).won += 1; getLandingPageRow(lp, source).won += 1; }
      if (leadsWithQuoteRange.has(lead.id)) { getSourceRow(source).quote_sent += 1; getCampaignRow(campaign, source).quote_sent += 1; getLandingPageRow(lp, source).quote_sent += 1; }
    });

    rangeOrders.forEach(order => {
      const lead = order.lead_id ? rangeLeadsById.get(order.lead_id) : null;
      const source = normalizeSource(lead?.utm_source || lead?.source || order.source);
      const campaign = normalizeCampaign(lead?.utm_campaign);
      const lp = normalizeString(lead?.landing_page) || 'ללא דף נחיתה';
      const total = safeNumber(order.total);
      getSourceRow(source).attributed_revenue += total;
      getCampaignRow(campaign, source).attributed_revenue += total;
      getLandingPageRow(lp, source).attributed_revenue += total;
    });

    rangeMarketingCosts.forEach(cost => {
      const source = normalizeSource(cost.source || cost.utm_source || cost.channel || cost.platform);
      const campaign = normalizeCampaign(cost.campaign_name || cost.campaign || cost.utm_campaign);
      const amount = safeNumber(cost.amount);
      getSourceRow(source).spend += amount;
      getCampaignRow(campaign, source).spend += amount;
    });

    const finalizeMktRow = (row) => {
      row.conversion_rate = row.leads > 0 ? Math.round((row.won / row.leads) * 1000) / 10 : 0;
      row.quote_rate = row.leads > 0 ? Math.round((row.quote_sent / row.leads) * 1000) / 10 : 0;
      row.roas = row.spend > 0 ? Math.round((row.attributed_revenue / row.spend) * 100) / 100 : null;
      row.cost_per_lead = row.leads > 0 ? Math.round(row.spend / row.leads) : 0;
      return row;
    };

    const finalizeLpRow = (row) => {
      row.conversion_rate = row.leads > 0 ? Math.round((row.won / row.leads) * 1000) / 10 : 0;
      row.quote_rate = row.leads > 0 ? Math.round((row.quote_sent / row.leads) * 1000) / 10 : 0;
      return row;
    };

    const sourceRows = Array.from(sourceMap.values()).map(finalizeMktRow).sort((a, b) => b.leads - a.leads);
    const campaignRows = Array.from(campaignMap.values()).map(finalizeMktRow).sort((a, b) => b.leads - a.leads);
    const landingPageRows = Array.from(landingPageMap.values()).map(finalizeLpRow).sort((a, b) => b.leads - a.leads);

    const failingCampaigns = campaignRows.filter(c => c.leads >= FAILING_CAMPAIGN_MIN_VOLUME && (c.won === 0 || c.conversion_rate < FAILING_CAMPAIGN_MIN_CONVERSION));

    // Smart alerts
    const drilldowns_meta = createDrilldowns(start.toISOString(), end.toISOString());
    const smart_alerts = [];

    if (liveSlaRedCount > 0) {
      smart_alerts.push({ id: 'sla_red_open', type: 'sla_red', severity: liveSlaRedCount >= 25 ? 'critical' : liveSlaRedCount >= 10 ? 'high' : 'medium', owner: 'צוות מכירות', impact: liveSlaRedCount, reason: `${liveSlaRedCount} לידים ללא מענה מעל ${SLA_RED_MINUTES} דקות`, action_link: drilldowns_meta.smart_alerts.sla_red });
    }
    if (tasksOverdue.length > 0) {
      smart_alerts.push({ id: 'tasks_overdue', type: 'tasks_overdue', severity: tasksOverdue.length >= 30 ? 'critical' : tasksOverdue.length >= 12 ? 'high' : 'medium', owner: 'צוות מכירות', impact: tasksOverdue.length, reason: `${tasksOverdue.length} משימות באיחור דורשות טיפול`, action_link: drilldowns_meta.smart_alerts.tasks_overdue });
    }
    if (failingCampaigns.length > 0) {
      const names = failingCampaigns.slice(0, 3).map(i => i.campaign).join(' • ');
      smart_alerts.push({ id: 'failing_campaigns', type: 'failing_campaign', severity: failingCampaigns.length >= 3 ? 'high' : 'medium', owner: 'שיווק', impact: failingCampaigns.slice(0, 3).reduce((a, i) => a + i.leads, 0), reason: `קמפיינים חלשים: ${names}`, action_link: drilldowns_meta.smart_alerts.failing_campaign });
    }
    if (expiringQuotes.length > 0) {
      smart_alerts.push({ id: 'expiring_quotes', type: 'expiring_quotes', severity: expiringQuotes.length >= 10 ? 'high' : 'low', owner: 'צוות מכירות', impact: expiringQuotes.length, reason: `${expiringQuotes.length} הצעות יפוגו ב-${EXPIRING_QUOTES_DAYS} ימים הקרובים`, action_link: drilldowns_meta.smart_alerts.expiring_quotes });
    }
    smart_alerts.sort((a, b) => getSeverityWeight(b.severity) - getSeverityWeight(a.severity));

    return Response.json({
      meta: { generated_at: now.toISOString(), range: { start: start.toISOString(), end: end.toISOString() } },
      summary_kpis,
      live_pipeline,
      sales_performance: { reps: repRows },
      marketing_performance: { totals: { leads: rangeLeadsCount, won_leads: rangeWonLeadsCount, spend: rangeMarketingCosts.reduce((a, r) => a + safeNumber(r.amount), 0), conversion_rate: rangeConversionRate }, sources: sourceRows, campaigns: campaignRows, landing_pages: landingPageRows },
      smart_alerts,
      drilldowns_meta,
      trends: { leads_daily: aggregateTrend(rangeLeads, 'effective_sort_date'), revenue_daily: aggregateTrend(rangeOrders, 'created_date', 'total') },
      tasks: { pending_total: openTaskCount, today: tasksToday.length, overdue: tasksOverdue.length },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
});
