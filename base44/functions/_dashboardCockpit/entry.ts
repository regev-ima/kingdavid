const ISRAEL_TIMEZONE = 'Asia/Jerusalem';
const SLA_RED_MINUTES = 15;
const EXPIRING_QUOTES_DAYS = 3;
const FAILING_CAMPAIGN_MIN_VOLUME = 8;
const FAILING_CAMPAIGN_MIN_CONVERSION = 2;

const CLOSED_LEAD_STATUSES = new Set([
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
]);

const ACTIVE_PIPELINE_STATUSES = new Set([
  'new_lead',
  'hot_lead',
  'followup_before_quote',
  'followup_after_quote',
  'coming_to_branch',
]);

const OPEN_TASK_STATUS = 'not_completed';

type Base44Client = any;

type DateRange = {
  start: Date;
  end: Date;
};

function isValidDate(value: Date | null): value is Date {
  return Boolean(value) && !Number.isNaN(value.getTime());
}

export function parseDateLoose(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }

  if (typeof value === 'number') {
    const numericDate = new Date(value);
    return isValidDate(numericDate) ? numericDate : null;
  }

  if (typeof value !== 'string') return null;

  const direct = new Date(value);
  if (isValidDate(direct)) return direct;

  const withTime = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/);
  if (withTime) {
    const [, dd, mm, yyyy, hh, min] = withTime;
    const parsed = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${min}:00`);
    return isValidDate(parsed) ? parsed : null;
  }

  const fullDate = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fullDate) {
    const [, dd, mm, yyyy] = fullDate;
    const parsed = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    return isValidDate(parsed) ? parsed : null;
  }

  const shortDateTime = value.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (shortDateTime) {
    const [, dd, mm, hh, min] = shortDateTime;
    const year = new Date().getFullYear();
    const parsed = new Date(`${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${min}:00`);
    return isValidDate(parsed) ? parsed : null;
  }

  const shortDate = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortDate) {
    const [, dd, mm] = shortDate;
    const year = new Date().getFullYear();
    const parsed = new Date(`${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    return isValidDate(parsed) ? parsed : null;
  }

  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function normalizeSource(source: unknown): string {
  const value = normalizeLower(source);
  if (!value) return 'other';
  if (value.includes('facebook') || value === 'fb' || value.includes('meta')) return 'facebook';
  if (value.includes('instagram') || value === 'ig') return 'instagram';
  if (value.includes('google') || value.includes('adwords') || value.includes('gads')) return 'google';
  if (value.includes('tiktok')) return 'tiktok';
  if (value.includes('taboola')) return 'taboola';
  if (value.includes('outbrain')) return 'outbrain';
  if (value.includes('whatsapp')) return 'whatsapp';
  return value;
}

function normalizeCampaign(campaign: unknown): string {
  const value = normalizeString(campaign);
  return value || 'ללא קמפיין';
}

function safeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,$\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toMinuteDiff(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 60000);
}

function isLeadClosed(status: unknown): boolean {
  return CLOSED_LEAD_STATUSES.has(normalizeLower(status));
}

function isLeadWon(status: unknown): boolean {
  return normalizeLower(status) === 'deal_closed';
}

function getLeadStage(status: unknown): 'won' | 'lost' | 'no_answer' | 'active' {
  const normalized = normalizeLower(status);
  if (normalized === 'deal_closed') return 'won';
  if (CLOSED_LEAD_STATUSES.has(normalized)) return 'lost';
  if (normalized.startsWith('no_answer')) return 'no_answer';
  if (ACTIVE_PIPELINE_STATUSES.has(normalized)) return 'active';
  return 'active';
}

function identifierCandidates(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => identifierCandidates(entry));
  }

  if (typeof value === 'object') {
    return [
      ...identifierCandidates((value as Record<string, unknown>).email),
      ...identifierCandidates((value as Record<string, unknown>).id),
      ...identifierCandidates((value as Record<string, unknown>).full_name),
      ...identifierCandidates((value as Record<string, unknown>).name),
      ...identifierCandidates((value as Record<string, unknown>).username),
    ];
  }

  if (typeof value === 'string') {
    const normalized = normalizeLower(value);
    if (!normalized) return [];
    const localPart = normalized.includes('@') ? normalized.split('@')[0] : '';
    const compact = normalized.replace(/\s+/g, '');
    return [normalized, localPart, compact].filter(Boolean);
  }

  return [];
}

function matchesIdentifier(user: Record<string, unknown>, ...values: unknown[]): boolean {
  const candidates = new Set([
    ...identifierCandidates(user.email),
    ...identifierCandidates(user.id),
    ...identifierCandidates(user.full_name),
    ...identifierCandidates(user.name),
  ]);

  return values.some((value) => identifierCandidates(value).some((candidate) => candidates.has(candidate)));
}

function taskOwnedByRep(task: Record<string, unknown>, rep: Record<string, unknown>): boolean {
  return matchesIdentifier(
    rep,
    task.rep1,
    task.rep2,
    task.pending_rep_email,
    task.assigned_to,
    task.owner,
  );
}

async function fetchAllByQuery(
  base44: Base44Client,
  entity: string,
  query: Record<string, unknown> = {},
  sort = '',
  batchSize = 500,
): Promise<any[]> {
  const all: any[] = [];
  let skip = 0;

  while (true) {
    const batch = await base44.asServiceRole.entities[entity].filter(query, sort, batchSize, skip);
    all.push(...batch);
    if (batch.length < batchSize) break;
    skip += batchSize;
  }

  return all;
}

async function fetchAllList(base44: Base44Client, entity: string, sort = '-created_date', batchSize = 500): Promise<any[]> {
  const all: any[] = [];
  let skip = 0;

  while (true) {
    const batch = await base44.asServiceRole.entities[entity].list(sort, batchSize, skip);
    all.push(...batch);
    if (batch.length < batchSize) break;
    skip += batchSize;
  }

  return all;
}

function createDrilldowns(range: DateRange) {
  const rangeQuery = {
    startDate: range.start.toISOString(),
    endDate: range.end.toISOString(),
  };

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
      rep_row: { page: 'Leads', query: { tab: 'all', rep1: '{rep_email}' } },
      rep_workload: { page: 'SalesTasks', query: { tab: 'not_completed', rep1: '{rep_email}' } },
      range: rangeQuery,
    },
    marketing_performance: {
      source_row: { page: 'Leads', query: { tab: 'all', source: '{source}' } },
      campaign_row: { page: 'Marketing', query: { utm_campaign: '{campaign}' } },
      range: rangeQuery,
    },
    smart_alerts: {
      sla_red: { page: 'Leads', query: { tab: 'open' } },
      tasks_overdue: { page: 'SalesTasks', query: { tab: 'overdue' } },
      failing_campaign: { page: 'Marketing', query: {} },
      expiring_quotes: { page: 'Quotes', query: { tab: 'expiring' } },
    },
  };
}

function aggregateTrend(items: any[], dateField: string, valueField?: string) {
  const map = new Map<string, number>();

  items.forEach((item) => {
    const parsedDate = parseDateLoose(item?.[dateField]);
    if (!parsedDate) return;
    const key = parsedDate.toISOString().slice(0, 10);
    const delta = valueField ? safeNumber(item?.[valueField]) : 1;
    map.set(key, (map.get(key) || 0) + delta);
  });

  return Array.from(map.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const escapedHeaders = headers.map((header) => `"${String(header).replace(/"/g, '""')}"`);
  const escapedRows = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
  return [escapedHeaders.join(','), ...escapedRows].join('\n');
}

function getSeverityWeight(severity: string): number {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export async function buildDashboardCockpitPayload(base44: Base44Client, range: DateRange) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const [
    rangeLeads,
    allLeads,
    rangeOrders,
    rangeQuotes,
    allQuotes,
    rangeMarketingCosts,
    allUsers,
    openTasks,
    sentQuotes,
  ] = await Promise.all([
    fetchAllByQuery(
      base44,
      'Lead',
      { effective_sort_date: { $gte: range.start.toISOString(), $lte: range.end.toISOString() } },
      '-effective_sort_date',
    ),
    fetchAllList(base44, 'Lead', '-created_date'),
    fetchAllByQuery(
      base44,
      'Order',
      { created_date: { $gte: range.start.toISOString(), $lte: range.end.toISOString() } },
      '-created_date',
    ),
    fetchAllByQuery(
      base44,
      'Quote',
      { created_date: { $gte: range.start.toISOString(), $lte: range.end.toISOString() } },
      '-created_date',
    ),
    fetchAllList(base44, 'Quote', '-created_date'),
    fetchAllByQuery(
      base44,
      'MarketingCost',
      { date: { $gte: range.start.toISOString(), $lte: range.end.toISOString() } },
      '-date',
    ),
    base44.asServiceRole.entities.User.list(),
    fetchAllByQuery(base44, 'SalesTask', { task_status: OPEN_TASK_STATUS }, '-created_date'),
    fetchAllByQuery(base44, 'Quote', { status: 'sent' }, '-created_date'),
  ]);

  const allLeadsById = new Map(allLeads.map((lead) => [lead.id, lead]));

  const leadsWithQuoteRange = new Set(rangeQuotes.map((quote) => quote.lead_id).filter(Boolean));

  const responseTimes = rangeLeads
    .filter((lead) => lead.first_action_at)
    .map((lead) => {
      const created = parseDateLoose(lead.created_date);
      const firstAction = parseDateLoose(lead.first_action_at);
      if (!created || !firstAction) return null;
      return toMinuteDiff(created, firstAction);
    })
    .filter((value) => value !== null) as number[];

  const avgResponseMinutes = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((acc, value) => acc + value, 0) / responseTimes.length)
    : 0;

  const liveOpenLeads = allLeads.filter((lead) => !isLeadClosed(lead.status));
  const liveSlaRedLeads = liveOpenLeads.filter((lead) => {
    if (lead.first_action_at) return false;
    const created = parseDateLoose(lead.created_date);
    if (!created) return false;
    return toMinuteDiff(created, now) > SLA_RED_MINUTES;
  });

  const rangeSlaRedLeads = rangeLeads.filter((lead) => {
    if (lead.first_action_at) return false;
    const created = parseDateLoose(lead.created_date);
    if (!created) return false;
    return toMinuteDiff(created, now) > SLA_RED_MINUTES;
  });

  const parseTaskDue = (task: any) => parseDateLoose(task?.due_date);

  const tasksOverdue = openTasks.filter((task) => {
    const due = parseTaskDue(task);
    return due ? due.getTime() < now.getTime() : false;
  });

  const tasksToday = openTasks.filter((task) => {
    const due = parseTaskDue(task);
    if (!due) return false;
    return due >= todayStart && due <= todayEnd;
  });

  const expiringQuotes = sentQuotes
    .map((quote) => {
      const validUntil = parseDateLoose(quote.valid_until);
      if (!validUntil) return null;
      const daysLeft = Math.ceil((validUntil.getTime() - now.getTime()) / 86400000);
      if (daysLeft < 0 || daysLeft > EXPIRING_QUOTES_DAYS) return null;
      return {
        id: quote.id,
        quote_number: quote.quote_number,
        customer_name: quote.customer_name,
        total: safeNumber(quote.total),
        valid_until: quote.valid_until,
        days_left: daysLeft,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  const rangeRevenue = rangeOrders.reduce((acc, order) => acc + safeNumber(order.total), 0);
  const rangeLeadsCount = rangeLeads.length;
  const rangeWonLeadsCount = rangeLeads.filter((lead) => isLeadWon(lead.status)).length;
  const rangeConversionRate = rangeLeadsCount > 0
    ? Math.round((rangeWonLeadsCount / rangeLeadsCount) * 1000) / 10
    : 0;
  const rangeSlaCompliance = rangeLeadsCount > 0
    ? Math.max(0, Math.round(((rangeLeadsCount - rangeSlaRedLeads.length) / rangeLeadsCount) * 1000) / 10)
    : 100;

  const pendingQuotesLive = sentQuotes.filter((quote) => {
    if (!quote.valid_until) return true;
    const validUntil = parseDateLoose(quote.valid_until);
    return validUntil ? validUntil >= todayStart : true;
  });

  const summary_kpis = {
    revenue: {
      value: rangeRevenue,
      currency: 'ILS',
      label: 'הכנסות בטווח',
      drilldown_key: 'summary_kpis.revenue',
    },
    conversion: {
      value: rangeConversionRate,
      won_leads: rangeWonLeadsCount,
      total_leads: rangeLeadsCount,
      label: 'המרה',
      unit: '%',
      drilldown_key: 'summary_kpis.conversion',
    },
    sla: {
      value: rangeSlaCompliance,
      red_count: rangeSlaRedLeads.length,
      threshold_minutes: SLA_RED_MINUTES,
      label: 'SLA תקין',
      unit: '%',
      drilldown_key: 'summary_kpis.sla',
    },
    open_workload: {
      value: openTasks.length,
      label: 'עומס פתוח',
      drilldown_key: 'summary_kpis.open_workload',
    },
  };

  const live_pipeline = {
    tasks_overdue: {
      count: tasksOverdue.length,
      label: 'משימות באיחור',
      drilldown_key: 'live_pipeline.tasks_overdue',
    },
    tasks_today: {
      count: tasksToday.length,
      label: 'משימות להיום',
      drilldown_key: 'live_pipeline.tasks_today',
    },
    sla_red_open: {
      count: liveSlaRedLeads.length,
      label: 'SLA אדום פתוח',
      threshold_minutes: SLA_RED_MINUTES,
      drilldown_key: 'live_pipeline.sla_red_open',
    },
    pending_quotes: {
      count: pendingQuotesLive.length,
      label: 'הצעות ממתינות',
      drilldown_key: 'live_pipeline.pending_quotes',
    },
  };

  const reps = allUsers.filter((user) => user.role === 'admin' || user.role === 'user');

  const repRows = reps.map((rep) => {
    const repLeadsRange = rangeLeads.filter((lead) => normalizeLower(lead.rep1) === normalizeLower(rep.email));
    const repOpenLeadsLive = liveOpenLeads.filter((lead) => normalizeLower(lead.rep1) === normalizeLower(rep.email));
    const repWonRange = repLeadsRange.filter((lead) => isLeadWon(lead.status)).length;
    const repRangeConversion = repLeadsRange.length > 0
      ? Math.round((repWonRange / repLeadsRange.length) * 1000) / 10
      : 0;

    const repRevenue = rangeOrders.reduce((acc, order) => {
      const orderRep = normalizeLower(order.rep1);
      if (orderRep && orderRep === normalizeLower(rep.email)) {
        return acc + safeNumber(order.total);
      }

      const lead = order.lead_id ? allLeadsById.get(order.lead_id) : null;
      if (lead && normalizeLower(lead.rep1) === normalizeLower(rep.email)) {
        return acc + safeNumber(order.total);
      }

      return acc;
    }, 0);

    const repTasksOpen = openTasks.filter((task) => taskOwnedByRep(task, rep));
    const repTasksOverdue = repTasksOpen.filter((task) => {
      const due = parseTaskDue(task);
      return due ? due.getTime() < now.getTime() : false;
    });
    const repTasksToday = repTasksOpen.filter((task) => {
      const due = parseTaskDue(task);
      return due ? due >= todayStart && due <= todayEnd : false;
    });

    const repSlaRed = liveSlaRedLeads.filter((lead) => normalizeLower(lead.rep1) === normalizeLower(rep.email)).length;

    const repSlaCompliance = repOpenLeadsLive.length > 0
      ? Math.max(0, Math.round(((repOpenLeadsLive.length - repSlaRed) / repOpenLeadsLive.length) * 1000) / 10)
      : 100;

    const healthScore = Math.max(
      0,
      Math.min(
        100,
        100 - (repTasksOverdue.length * 1.5) - (repSlaRed * 2) + (repRangeConversion * 0.2),
      ),
    );

    return {
      rep_name: rep.full_name || rep.email,
      rep_email: rep.email,
      profile_icon: rep.profile_icon || null,
      leads_range: repLeadsRange.length,
      won_range: repWonRange,
      conversion_rate: repRangeConversion,
      revenue: repRevenue,
      workload_open_tasks: repTasksOpen.length,
      workload_overdue_tasks: repTasksOverdue.length,
      workload_today_tasks: repTasksToday.length,
      sla_red_open: repSlaRed,
      sla_compliance: repSlaCompliance,
      health_score: Math.round(healthScore),
    };
  });

  const teamConversion = repRows.length > 0
    ? Math.round((repRows.reduce((acc, row) => acc + row.conversion_rate, 0) / repRows.length) * 10) / 10
    : 0;

  const sales_performance = {
    team_conversion_rate: teamConversion,
    reps: repRows
      .map((row) => ({
        ...row,
        conversion_variance: Math.round((row.conversion_rate - teamConversion) * 10) / 10,
      }))
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        if (b.conversion_rate !== a.conversion_rate) return b.conversion_rate - a.conversion_rate;
        return b.workload_open_tasks - a.workload_open_tasks;
      }),
  };

  const sourceMap = new Map<string, any>();
  const campaignMap = new Map<string, any>();

  const getSourceRow = (source: string) => {
    if (!sourceMap.has(source)) {
      sourceMap.set(source, {
        source,
        leads: 0,
        won: 0,
        quote_sent: 0,
        conversion_rate: 0,
        quote_rate: 0,
        attributed_revenue: 0,
        spend: 0,
        roas: null,
        cost_per_lead: 0,
      });
    }
    return sourceMap.get(source);
  };

  const getCampaignRow = (campaign: string, source = 'other') => {
    if (!campaignMap.has(campaign)) {
      campaignMap.set(campaign, {
        campaign,
        source,
        leads: 0,
        won: 0,
        quote_sent: 0,
        conversion_rate: 0,
        quote_rate: 0,
        attributed_revenue: 0,
        spend: 0,
        roas: null,
        cost_per_lead: 0,
      });
    }
    const row = campaignMap.get(campaign);
    if (row.source === 'other' && source !== 'other') {
      row.source = source;
    }
    return row;
  };

  rangeLeads.forEach((lead) => {
    const source = normalizeSource(lead.utm_source || lead.source);
    const campaign = normalizeCampaign(lead.utm_campaign);

    const sourceRow = getSourceRow(source);
    const campaignRow = getCampaignRow(campaign, source);

    sourceRow.leads += 1;
    campaignRow.leads += 1;

    if (isLeadWon(lead.status)) {
      sourceRow.won += 1;
      campaignRow.won += 1;
    }

    if (leadsWithQuoteRange.has(lead.id)) {
      sourceRow.quote_sent += 1;
      campaignRow.quote_sent += 1;
    }
  });

  rangeOrders.forEach((order) => {
    const lead = order.lead_id ? allLeadsById.get(order.lead_id) : null;
    const source = normalizeSource(lead?.utm_source || lead?.source || order.source);
    const campaign = normalizeCampaign(lead?.utm_campaign || order.campaign_name);
    const total = safeNumber(order.total);

    const sourceRow = getSourceRow(source);
    const campaignRow = getCampaignRow(campaign, source);

    sourceRow.attributed_revenue += total;
    campaignRow.attributed_revenue += total;
  });

  rangeMarketingCosts.forEach((cost) => {
    const source = normalizeSource(cost.source || cost.utm_source || cost.channel || cost.platform);
    const campaign = normalizeCampaign(cost.campaign_name || cost.campaign || cost.utm_campaign);
    const amount = safeNumber(cost.amount);

    const sourceRow = getSourceRow(source);
    const campaignRow = getCampaignRow(campaign, source);

    sourceRow.spend += amount;
    campaignRow.spend += amount;
  });

  const finalizeMktRow = (row: any) => {
    row.conversion_rate = row.leads > 0 ? Math.round((row.won / row.leads) * 1000) / 10 : 0;
    row.quote_rate = row.leads > 0 ? Math.round((row.quote_sent / row.leads) * 1000) / 10 : 0;
    row.roas = row.spend > 0 ? Math.round((row.attributed_revenue / row.spend) * 100) / 100 : null;
    row.cost_per_lead = row.leads > 0 ? Math.round(row.spend / row.leads) : 0;
    return row;
  };

  const sourceRows = Array.from(sourceMap.values())
    .map((row) => finalizeMktRow(row))
    .sort((a, b) => {
      if (b.leads !== a.leads) return b.leads - a.leads;
      return b.attributed_revenue - a.attributed_revenue;
    });

  const campaignRows = Array.from(campaignMap.values())
    .map((row) => finalizeMktRow(row))
    .sort((a, b) => {
      if (b.leads !== a.leads) return b.leads - a.leads;
      return b.attributed_revenue - a.attributed_revenue;
    });

  const marketing_performance = {
    totals: {
      leads: rangeLeadsCount,
      won_leads: rangeWonLeadsCount,
      attributed_revenue: rangeOrders.reduce((acc, order) => {
        const lead = order.lead_id ? allLeadsById.get(order.lead_id) : null;
        if (lead && isLeadWon(lead.status)) return acc + safeNumber(order.total);
        return acc;
      }, 0),
      spend: rangeMarketingCosts.reduce((acc, row) => acc + safeNumber(row.amount), 0),
      quote_sent: rangeLeads.filter((lead) => leadsWithQuoteRange.has(lead.id)).length,
      conversion_rate: rangeConversionRate,
    },
    sources: sourceRows,
    campaigns: campaignRows,
  };

  const failingCampaigns = campaignRows.filter((campaign) => {
    if (campaign.leads < FAILING_CAMPAIGN_MIN_VOLUME) return false;
    if (campaign.won === 0) return true;
    return campaign.conversion_rate < FAILING_CAMPAIGN_MIN_CONVERSION;
  });

  const drilldowns_meta = createDrilldowns(range);

  const smart_alerts: any[] = [];

  if (liveSlaRedLeads.length > 0) {
    smart_alerts.push({
      id: 'sla_red_open',
      type: 'sla_red',
      severity: liveSlaRedLeads.length >= 25 ? 'critical' : liveSlaRedLeads.length >= 10 ? 'high' : 'medium',
      owner: 'צוות מכירות',
      impact: liveSlaRedLeads.length,
      reason: `${liveSlaRedLeads.length} לידים ללא מענה מעל ${SLA_RED_MINUTES} דקות`,
      action_link: drilldowns_meta.smart_alerts.sla_red,
    });
  }

  if (tasksOverdue.length > 0) {
    smart_alerts.push({
      id: 'tasks_overdue',
      type: 'tasks_overdue',
      severity: tasksOverdue.length >= 30 ? 'critical' : tasksOverdue.length >= 12 ? 'high' : 'medium',
      owner: 'צוות מכירות',
      impact: tasksOverdue.length,
      reason: `${tasksOverdue.length} משימות באיחור דורשות טיפול`,
      action_link: drilldowns_meta.smart_alerts.tasks_overdue,
    });
  }

  if (failingCampaigns.length > 0) {
    const topFailing = failingCampaigns.slice(0, 3);
    const names = topFailing.map((item) => item.campaign).join(' • ');

    smart_alerts.push({
      id: 'failing_campaigns',
      type: 'failing_campaign',
      severity: failingCampaigns.length >= 3 ? 'high' : 'medium',
      owner: 'שיווק',
      impact: topFailing.reduce((acc, item) => acc + item.leads, 0),
      reason: `קמפיינים חלשים: ${names}`,
      action_link: drilldowns_meta.smart_alerts.failing_campaign,
      meta: {
        min_volume: FAILING_CAMPAIGN_MIN_VOLUME,
        min_conversion: FAILING_CAMPAIGN_MIN_CONVERSION,
      },
    });
  }

  if (expiringQuotes.length > 0) {
    smart_alerts.push({
      id: 'expiring_quotes',
      type: 'expiring_quotes',
      severity: expiringQuotes.length >= 10 ? 'high' : 'low',
      owner: 'צוות מכירות',
      impact: expiringQuotes.length,
      reason: `${expiringQuotes.length} הצעות יפוגו ב-${EXPIRING_QUOTES_DAYS} ימים הקרובים`,
      action_link: drilldowns_meta.smart_alerts.expiring_quotes,
    });
  }

  smart_alerts.sort((a, b) => {
    const severityDiff = getSeverityWeight(b.severity) - getSeverityWeight(a.severity);
    if (severityDiff !== 0) return severityDiff;
    return (b.impact || 0) - (a.impact || 0);
  });

  const statusBreakdown = rangeLeads.reduce((acc, lead) => {
    const status = normalizeLower(lead.status) || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sourceBreakdownForLegacy = sourceRows.map((row) => ({
    source: row.source,
    leads: row.leads,
    won: row.won,
    revenue: row.attributed_revenue,
    quoteSent: row.quote_sent,
    inProgress: rangeLeads.filter((lead) => normalizeSource(lead.utm_source || lead.source) === row.source && getLeadStage(lead.status) === 'active').length,
    conversionRate: row.conversion_rate,
    quoteRate: row.quote_rate,
  }));

  const campaignBreakdownForLegacy = campaignRows.map((row) => ({
    campaign: row.campaign,
    source: row.source,
    leads: row.leads,
    won: row.won,
    revenue: row.attributed_revenue,
    quoteSent: row.quote_sent,
    inProgress: rangeLeads.filter((lead) => normalizeCampaign(lead.utm_campaign) === row.campaign && getLeadStage(lead.status) === 'active').length,
    conversionRate: row.conversion_rate,
    quoteRate: row.quote_rate,
  }));

  const todayStr = todayStart.toISOString().slice(0, 10);

  const pendingQuotesAll = allQuotes.filter((quote) => {
    const status = normalizeLower(quote.status);
    const validUntil = parseDateLoose(quote.valid_until);
    if (!(status === 'sent' || status === 'draft')) return false;
    if (!quote.valid_until) return true;
    return validUntil ? validUntil.toISOString().slice(0, 10) >= todayStr : true;
  });

  const expiredQuotesAll = allQuotes.filter((quote) => {
    const status = normalizeLower(quote.status);
    const validUntil = parseDateLoose(quote.valid_until);

    if (status === 'expired') return true;
    if (!(status === 'sent' || status === 'draft')) return false;
    if (!quote.valid_until) return false;
    return validUntil ? validUntil.toISOString().slice(0, 10) < todayStr : false;
  });

  const approvedQuotesAll = allQuotes.filter((quote) => normalizeLower(quote.status) === 'approved');
  const rejectedQuotesAll = allQuotes.filter((quote) => normalizeLower(quote.status) === 'rejected');

  const revenueByChannelMap = new Map<string, { source: string; revenue: number; count: number }>();
  const revenueByMktSourceMap = new Map<string, { source: string; revenue: number; count: number }>();
  const revenueByCampaignMap = new Map<string, { campaign: string; revenue: number; count: number }>();

  rangeOrders.forEach((order) => {
    const channel = normalizeString(order.source) || 'other';
    const channelRow = revenueByChannelMap.get(channel) || { source: channel, revenue: 0, count: 0 };
    channelRow.revenue += safeNumber(order.total);
    channelRow.count += 1;
    revenueByChannelMap.set(channel, channelRow);

    const lead = order.lead_id ? allLeadsById.get(order.lead_id) : null;
    const source = normalizeSource(lead?.utm_source || lead?.source || order.source);
    const sourceRow = revenueByMktSourceMap.get(source) || { source, revenue: 0, count: 0 };
    sourceRow.revenue += safeNumber(order.total);
    sourceRow.count += 1;
    revenueByMktSourceMap.set(source, sourceRow);

    const campaign = normalizeCampaign(lead?.utm_campaign || order.campaign_name);
    const campaignRow = revenueByCampaignMap.get(campaign) || { campaign, revenue: 0, count: 0 };
    campaignRow.revenue += safeNumber(order.total);
    campaignRow.count += 1;
    revenueByCampaignMap.set(campaign, campaignRow);
  });

  const rep_performance = sales_performance.reps.map((rep) => ({
    name: rep.rep_name,
    email: rep.rep_email,
    profile_icon: rep.profile_icon,
    totalLeads: rep.leads_range,
    openLeads: liveOpenLeads.filter((lead) => normalizeLower(lead.rep1) === normalizeLower(rep.rep_email)).length,
    closedLeads: rangeLeads.filter((lead) => normalizeLower(lead.rep1) === normalizeLower(rep.rep_email) && isLeadClosed(lead.status)).length,
    newLeads: rangeLeads.filter((lead) => normalizeLower(lead.rep1) === normalizeLower(rep.rep_email) && normalizeLower(lead.status) === 'new_lead').length,
    slaRedCount: rep.sla_red_open,
    wonLeads: rep.won_range,
    revenue: rep.revenue,
    conversionRate: rep.conversion_rate,
    slaCompliance: rep.sla_compliance,
  }));

  const leads_trend = aggregateTrend(rangeLeads, 'effective_sort_date').map((row) => ({
    date: row.date,
    count: row.value,
  }));

  const financial = {
    total_revenue: rangeRevenue,
    paid_revenue: rangeOrders.filter((order) => normalizeLower(order.payment_status) === 'paid').reduce((acc, order) => acc + safeNumber(order.total), 0),
    unpaid_revenue: rangeOrders.filter((order) => normalizeLower(order.payment_status) === 'unpaid').reduce((acc, order) => acc + safeNumber(order.total), 0),
    deposit_revenue: rangeOrders.filter((order) => normalizeLower(order.payment_status) === 'deposit_paid').reduce((acc, order) => acc + safeNumber(order.total), 0),
    orders_count: rangeOrders.length,
    avg_order_value: rangeOrders.length > 0 ? Math.round(rangeRevenue / rangeOrders.length) : 0,
    commissions_pending: 0,
    revenue_by_channel: Array.from(revenueByChannelMap.values()).sort((a, b) => b.revenue - a.revenue),
    revenue_by_mkt_source: Array.from(revenueByMktSourceMap.values()).sort((a, b) => b.revenue - a.revenue),
    revenue_by_campaign: Array.from(revenueByCampaignMap.values()).sort((a, b) => b.revenue - a.revenue),
    quotes_pending: pendingQuotesAll.length,
    quotes_pending_value: pendingQuotesAll.reduce((acc, quote) => acc + safeNumber(quote.total), 0),
    quotes_expired: expiredQuotesAll.length,
    quotes_expired_value: expiredQuotesAll.reduce((acc, quote) => acc + safeNumber(quote.total), 0),
    quotes_approved: approvedQuotesAll.length,
    quotes_approved_value: approvedQuotesAll.reduce((acc, quote) => acc + safeNumber(quote.total), 0),
    quotes_rejected: rejectedQuotesAll.length,
    quotes_rejected_value: rejectedQuotesAll.reduce((acc, quote) => acc + safeNumber(quote.total), 0),
  };

  const marketing = {
    total_spend: marketing_performance.totals.spend,
    leads_count: rangeLeadsCount,
    won_leads_count: rangeWonLeadsCount,
    attributed_revenue: marketing_performance.totals.attributed_revenue,
    overall_conversion_rate: rangeConversionRate,
    quote_sent_count: marketing_performance.totals.quote_sent,
    quote_rate: rangeLeadsCount > 0 ? Math.round((marketing_performance.totals.quote_sent / rangeLeadsCount) * 1000) / 10 : 0,
    status_breakdown: statusBreakdown,
    by_source: sourceBreakdownForLegacy,
    by_medium: [],
    by_campaign: campaignBreakdownForLegacy,
    by_content: [],
    by_term: [],
  };

  const tasks = {
    pending_total: openTasks.length,
    today: tasksToday.length,
    overdue: tasksOverdue.length,
  };

  const payload = {
    meta: {
      generated_at: now.toISOString(),
      timezone: ISRAEL_TIMEZONE,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
    },
    summary_kpis,
    live_pipeline,
    sales_performance,
    marketing_performance,
    smart_alerts,
    drilldowns_meta,
    trends: {
      leads_daily: aggregateTrend(rangeLeads, 'effective_sort_date'),
      revenue_daily: aggregateTrend(rangeOrders, 'created_date', 'total'),
    },
    legacy: {
      leads_count: rangeLeadsCount,
      unassigned_leads: rangeLeads.filter((lead) => !normalizeString(lead.rep1)).length,
      quotes_count: rangeQuotes.length,
      sla_red: rangeSlaRedLeads.length,
      avg_response_time: avgResponseMinutes,
      upsell_rate: 0,
      no_answer_count: 0,
      auto_whatsapp_count: 0,
      whatsapp_return_rate: 0,
      recent_no_answer: [],
      upsell_total_suggestions: 0,
      upsell_added_suggestions: 0,
      upsell_suggestion_rate: 0,
      upsell_top_decline: null,
      upsell_opportunities: [],
      rep_performance,
      expiring_quotes: expiringQuotes,
      financial,
      marketing,
      leads_trend,
      tasks,
    },
  };

  return payload;
}

export function buildDashboardCsvExport(data: any, exportType: string) {
  const normalizedType = normalizeLower(exportType);

  if (normalizedType === 'reps') {
    const headers = ['נציג', 'אימייל', 'לידים בטווח', 'נסגרו', 'המרה %', 'הכנסות ₪', 'משימות פתוחות', 'באיחור', 'SLA אדום'];
    const rows = (data?.sales_performance?.reps || []).map((row: any) => [
      row.rep_name,
      row.rep_email,
      row.leads_range,
      row.won_range,
      row.conversion_rate,
      row.revenue,
      row.workload_open_tasks,
      row.workload_overdue_tasks,
      row.sla_red_open,
    ]);

    return {
      filename: 'dashboard_reps.csv',
      csv: buildCsv(headers, rows),
      rows_count: rows.length,
    };
  }

  if (normalizedType === 'sources') {
    const headers = ['מקור', 'לידים', 'הצעות %', 'המרה %', 'הכנסות ₪', 'הוצאות ₪', 'ROAS'];
    const rows = (data?.marketing_performance?.sources || []).map((row: any) => [
      row.source,
      row.leads,
      row.quote_rate,
      row.conversion_rate,
      row.attributed_revenue,
      row.spend,
      row.roas ?? '',
    ]);

    return {
      filename: 'dashboard_sources.csv',
      csv: buildCsv(headers, rows),
      rows_count: rows.length,
    };
  }

  if (normalizedType === 'campaigns') {
    const headers = ['קמפיין', 'מקור', 'לידים', 'הצעות %', 'המרה %', 'הכנסות ₪', 'הוצאות ₪', 'ROAS'];
    const rows = (data?.marketing_performance?.campaigns || []).map((row: any) => [
      row.campaign,
      row.source,
      row.leads,
      row.quote_rate,
      row.conversion_rate,
      row.attributed_revenue,
      row.spend,
      row.roas ?? '',
    ]);

    return {
      filename: 'dashboard_campaigns.csv',
      csv: buildCsv(headers, rows),
      rows_count: rows.length,
    };
  }

  if (normalizedType === 'alerts') {
    const headers = ['סוג', 'חומרה', 'בעלים', 'השפעה', 'סיבה'];
    const rows = (data?.smart_alerts || []).map((row: any) => [
      row.type,
      row.severity,
      row.owner,
      row.impact,
      row.reason,
    ]);

    return {
      filename: 'dashboard_alerts.csv',
      csv: buildCsv(headers, rows),
      rows_count: rows.length,
    };
  }

  return {
    filename: 'dashboard_export.csv',
    csv: buildCsv(['הודעה'], [['סוג ייצוא לא נתמך']]),
    rows_count: 1,
  };
}
