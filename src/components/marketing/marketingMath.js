import { resolveSourceChannel } from '@/constants/sourceChannels';

// Pure merge/derivation layer for the marketing panel: takes the two
// marketing_stats_v1 snapshots (current + previous period) plus raw
// marketing_costs rows, and returns display-ready rows with spend, rates and
// period-over-period deltas attached. No fetching and no JSX here on purpose —
// every number the panel shows is computable (and testable) from plain data.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pct = (part, whole) => (whole > 0 ? +((part / whole) * 100).toFixed(1) : 0);

// Period-over-period fraction: +0.25 = grew 25%. null when there is no
// meaningful baseline (prev 0 → a "∞%" badge would be noise, not signal).
const delta = (curr, prev) => (prev > 0 ? +(((curr - prev) / prev).toFixed(3)) : null);

const norm = (v) => String(v ?? '').trim();
const normKey = (v) => norm(v).toLowerCase();

// marketing_costs is a base44-legacy table whose column names vary between
// deployments — read them as loosely as getDashboardStats does.
export function costRowChannel(cost) {
  return resolveSourceChannel(cost?.source || cost?.utm_source || cost?.channel || cost?.platform);
}
export function costRowCampaign(cost) {
  return norm(cost?.campaign_name || cost?.campaign || cost?.utm_campaign);
}
export function costRowAmount(cost) {
  const v = cost?.amount;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const p = Number(v.replace(/[,₪$\s]/g, ''));
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
}

// { total, byChannel: Map<channel, spend>, byCampaign: Map<lowercased name, {name, channel, spend}> }
export function buildSpendIndex(costs = []) {
  const byChannel = new Map();
  const byCampaign = new Map();
  let total = 0;
  for (const cost of costs) {
    const amount = costRowAmount(cost);
    if (!amount) continue;
    total += amount;
    const channel = costRowChannel(cost);
    byChannel.set(channel, (byChannel.get(channel) || 0) + amount);
    const campaign = costRowCampaign(cost);
    if (campaign) {
      const key = campaign.toLowerCase();
      const row = byCampaign.get(key) || { name: campaign, channel, spend: 0 };
      row.spend += amount;
      byCampaign.set(key, row);
    }
  }
  return { total, byChannel, byCampaign };
}

function withRates(row) {
  const { leads, contacted, quoted, won, revenue, orders, spend } = row;
  return {
    ...row,
    conversion: pct(won, leads),
    contactedRate: pct(contacted, leads),
    quoteRate: pct(quoted, leads),
    cpl: spend > 0 && leads > 0 ? Math.round(spend / leads) : null,
    cac: spend > 0 && won > 0 ? Math.round(spend / won) : null,
    roas: spend > 0 ? +((revenue / spend).toFixed(2)) : null,
    revenuePerLead: leads > 0 ? Math.round(revenue / leads) : 0,
    avgOrder: orders > 0 ? Math.round(revenue / orders) : null,
  };
}

function attachPrev(row, prev) {
  if (!prev) return { ...row, prev: null, leadsDelta: null, convDelta: null, revenueDelta: null };
  const prevConv = pct(num(prev.won), num(prev.leads));
  return {
    ...row,
    prev: { leads: num(prev.leads), won: num(prev.won), revenue: num(prev.revenue), conversion: prevConv },
    leadsDelta: delta(row.leads, num(prev.leads)),
    convDelta: prevConv > 0 ? +((row.conversion - prevConv).toFixed(1)) : null, // percentage POINTS
    revenueDelta: delta(row.revenue, num(prev.revenue)),
  };
}

// RPC rows are re-grouped case/whitespace-insensitively (utm_campaign is
// URL-lowercase while facebook_campaign_name is human Title-Case — same
// campaign, two keys). drillKey keeps the dominant variant's RAW server key so
// the drill-down RPC filters by a string that actually exists in the data.
function groupCampaigns(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const name = norm(r.campaign) || 'ללא קמפיין';
    const key = name.toLowerCase();
    const row = map.get(key) || {
      campaign: name, channel: r.channel || 'unknown', drillKey: r.campaign, domLeads: -1,
      leads: 0, contacted: 0, quoted: 0, won: 0, lost: 0, open: 0, revenue: 0, orders: 0,
    };
    if (num(r.leads) > row.domLeads) {
      row.domLeads = num(r.leads);
      row.channel = r.channel || row.channel;
      row.drillKey = r.campaign;
    }
    row.leads += num(r.leads);
    row.contacted += num(r.contacted);
    row.quoted += num(r.quoted);
    row.won += num(r.won);
    row.lost += num(r.lost);
    row.open += num(r.open);
    row.revenue += num(r.revenue);
    row.orders += num(r.orders);
    map.set(key, row);
  }
  return map;
}

export function mergeMarketingData({ current, previous, costs = [], prevCosts = [] }) {
  const spend = buildSpendIndex(costs);
  const prevSpend = buildSpendIndex(prevCosts);

  const currCampaigns = groupCampaigns(current?.campaigns);
  const prevCampaigns = groupCampaigns(previous?.campaigns);

  const campaigns = [];
  for (const [key, row] of currCampaigns) {
    const { domLeads, ...rest } = row;
    const spendRow = spend.byCampaign.get(key);
    const enriched = withRates({ ...rest, spend: spendRow ? spendRow.spend : 0 });
    campaigns.push(attachPrev(enriched, prevCampaigns.get(key)));
  }
  // Spend rows whose campaign name matches no lead — money going out with
  // nothing coming in. Surfaced as zero-lead rows so they are impossible to
  // miss — but only when the campaigns cut is exhaustive: the RPC caps it at
  // its top 400, and past that cap "no matching row" no longer proves "no
  // leads".
  const campaignLeadSum = [...currCampaigns.values()].reduce((acc, r) => acc + r.leads, 0);
  const campaignsExhaustive = campaignLeadSum >= num(current?.summary?.leads);
  if (campaignsExhaustive) {
    for (const [key, spendRow] of spend.byCampaign) {
      if (currCampaigns.has(key)) continue;
      campaigns.push(attachPrev(withRates({
        campaign: spendRow.name, channel: spendRow.channel,
        leads: 0, contacted: 0, quoted: 0, won: 0, lost: 0, open: 0, revenue: 0, orders: 0,
        spend: spendRow.spend, costOnly: true,
      }), prevCampaigns.get(key)));
    }
  }
  campaigns.sort((a, b) => b.leads - a.leads || b.spend - a.spend);

  const prevChannelMap = new Map((previous?.channels || []).map((c) => [c.channel, c]));
  const channels = (current?.channels || []).map((c) => {
    const row = withRates({
      channel: c.channel || 'unknown',
      leads: num(c.leads), contacted: num(c.contacted), quoted: num(c.quoted),
      won: num(c.won), lost: num(c.lost), open: num(c.open),
      revenue: num(c.revenue), orders: num(c.orders),
      medianMins: c.median_mins_to_contact != null ? Math.round(Number(c.median_mins_to_contact)) : null,
      spend: spend.byChannel.get(c.channel) || 0,
    });
    return attachPrev(row, prevChannelMap.get(c.channel));
  });
  // Channel-level spend with no leads at all in the range still belongs in the
  // picture (e.g. a paused channel that keeps billing).
  for (const [channel, amount] of spend.byChannel) {
    if (channels.some((c) => c.channel === channel) || !amount) continue;
    channels.push(attachPrev(withRates({
      channel, leads: 0, contacted: 0, quoted: 0, won: 0, lost: 0, open: 0,
      revenue: 0, orders: 0, medianMins: null, spend: amount, costOnly: true,
    }), prevChannelMap.get(channel)));
  }
  channels.sort((a, b) => b.leads - a.leads || b.spend - a.spend);

  const s = current?.summary || {};
  const p = previous?.summary || {};
  const totalsBase = withRates({
    leads: num(s.leads), contacted: num(s.contacted), quoted: num(s.quoted),
    won: num(s.won), lost: num(s.lost), open: num(s.open),
    revenue: num(s.revenue), orders: num(s.orders), spend: spend.total,
  });
  const prevTotals = withRates({
    leads: num(p.leads), contacted: num(p.contacted), quoted: num(p.quoted),
    won: num(p.won), lost: num(p.lost), open: num(p.open),
    revenue: num(p.revenue), orders: num(p.orders), spend: prevSpend.total,
  });
  const totals = {
    ...totalsBase,
    periodRevenue: num(s.period_revenue),
    medianMins: s.median_mins_to_contact != null ? Math.round(Number(s.median_mins_to_contact)) : null,
    prevMedianMins: p.median_mins_to_contact != null ? Math.round(Number(p.median_mins_to_contact)) : null,
    prev: prevTotals,
    deltas: {
      leads: delta(totalsBase.leads, prevTotals.leads),
      won: delta(totalsBase.won, prevTotals.won),
      revenue: delta(totalsBase.revenue, prevTotals.revenue),
      spend: delta(totalsBase.spend, prevTotals.spend),
      conversion: prevTotals.conversion > 0 ? +((totalsBase.conversion - prevTotals.conversion).toFixed(1)) : null,
      cpl: totalsBase.cpl != null && prevTotals.cpl != null ? delta(totalsBase.cpl, prevTotals.cpl) : null,
      cac: totalsBase.cac != null && prevTotals.cac != null ? delta(totalsBase.cac, prevTotals.cac) : null,
      roas: totalsBase.roas != null && prevTotals.roas != null ? delta(totalsBase.roas, prevTotals.roas) : null,
    },
  };

  return { totals, channels, campaigns };
}
