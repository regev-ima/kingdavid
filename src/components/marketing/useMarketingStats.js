import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// The Marketing page used to fetch EVERY lead/order/cost into the browser and
// aggregate client-side — which made it load for ages and show zeros while it
// churned. This hook instead leans on the same server-side aggregation the
// control center uses (getDashboardStats → marketing_performance): one small,
// fast round-trip that returns per-source / per-campaign rows already summed.

const CALL_TIMEOUT_MS = 25000;
const withTimeout = (promise, ms = CALL_TIMEOUT_MS) =>
  Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`נתקע (timeout מעל ${Math.round(ms / 1000)} שניות)`)), ms)),
  ]);

// getDashboardStats emits source rows as { source, leads, won, open, lost,
// conversion_rate, spend, attributed_revenue, roas }. Read those real keys
// first, keep *_count aliases as fallbacks, and use ?? so a legit 0 survives.
function mapSources(sources = []) {
  return sources.map((s) => {
    const leads = Number(s.leads_count ?? s.leads ?? s.value ?? 0);
    const won = Number(s.won_count ?? s.won ?? 0);
    const open = Number(s.in_handling_count ?? s.open ?? 0);
    const lost = Number(s.lost_count ?? s.lost ?? Math.max(0, leads - won - open));
    const pct = (n) => (leads > 0 ? +((n / leads) * 100).toFixed(1) : 0);
    const cost = Number(s.cost ?? s.spend ?? 0);
    const revenue = Number(s.revenue ?? s.attributed_revenue ?? 0);
    return {
      name: s.source || s.name || 'אחר',
      leads,
      won,
      open,
      lost,
      conversion: s.conversion_rate != null ? Number(s.conversion_rate) : pct(won),
      in_handling_rate: pct(open),
      lost_rate: pct(lost),
      cost,
      revenue,
      cpl: leads > 0 ? Math.round(cost / leads) : 0,
      cac: won > 0 ? Math.round(cost / won) : null,
      roi: s.roas != null ? Number(s.roas) : (cost > 0 ? +((revenue / cost).toFixed(2)) : null),
    };
  });
}

function mapCampaigns(campaigns = []) {
  return campaigns.map((c) => {
    const leads = Number(c.leads_count ?? c.leads ?? 0);
    const won = Number(c.won_count ?? c.won ?? 0);
    const cost = Number(c.cost ?? c.spend ?? 0);
    const revenue = Number(c.revenue ?? c.attributed_revenue ?? 0);
    return {
      name: c.campaign || c.name || 'ללא קמפיין',
      source: c.source || null,
      leads,
      won,
      conversion: c.conversion_rate != null ? Number(c.conversion_rate) : (leads > 0 ? +(((won / leads) * 100)).toFixed(1) : 0),
      cost,
      revenue,
      cpl: leads > 0 ? Math.round(cost / leads) : 0,
      cac: won > 0 ? Math.round(cost / won) : null,
      roi: c.roas != null ? Number(c.roas) : (cost > 0 ? +((revenue / cost).toFixed(2)) : null),
    };
  });
}

export default function useMarketingStats({ start, end, enabled = true }) {
  return useQuery({
    queryKey: ['marketingStats', start?.toISOString(), end?.toISOString()],
    enabled: enabled && !!start && !!end,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const stats = await withTimeout(
        base44.functions.invoke('getDashboardStats', {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      );
      const mkt = stats?.marketing_performance || {};
      const sources = mapSources(mkt.sources).sort((a, b) => b.leads - a.leads);
      const campaigns = mapCampaigns(mkt.campaigns).sort((a, b) => b.leads - a.leads);

      // Prefer the server's headline totals (they count every lead in range,
      // including those with no source), falling back to summing the rows.
      const sumLeads = sources.reduce((acc, r) => acc + r.leads, 0);
      const sumWon = sources.reduce((acc, r) => acc + r.won, 0);
      const sumCost = sources.reduce((acc, r) => acc + r.cost, 0);
      const sumRevenue = sources.reduce((acc, r) => acc + r.revenue, 0);
      const totalLeads = Number(mkt.totals?.leads ?? sumLeads);
      const totalWon = Number(mkt.totals?.won_leads ?? sumWon);
      const totalCost = Number(mkt.totals?.spend ?? sumCost);
      const totalRevenue = sumRevenue; // server total doesn't expose attributed revenue

      return {
        sources,
        campaigns,
        totals: {
          leads: totalLeads,
          won: totalWon,
          cost: totalCost,
          revenue: totalRevenue,
          conversion: totalLeads > 0 ? +(((totalWon / totalLeads) * 100)).toFixed(1) : 0,
          cpl: totalLeads > 0 ? Math.round(totalCost / totalLeads) : 0,
          cac: totalWon > 0 ? Math.round(totalCost / totalWon) : 0,
          roi: totalCost > 0 ? +((totalRevenue / totalCost).toFixed(2)) : null,
        },
        generatedAt: stats?.meta?.generated_at || null,
        failures: stats?.meta?.failures || [],
      };
    },
  });
}
