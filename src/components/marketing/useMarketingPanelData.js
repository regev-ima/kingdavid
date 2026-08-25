import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getDateRange, getPreviousDateRange } from '@/utils/dateRange';
import { mergeMarketingData } from './marketingMath';
import computeInsights from './computeInsights';

// Data layer for the smart marketing panel. All heavy aggregation happens in
// Postgres (marketing_stats_v1 — see migration 20260825000001): each call
// returns a few hundred pre-summed rows, so the panel stays fast on any range.
// The panel runs the RPC twice — current range and the mirrored previous range
// — for like-for-like deltas, and merges the small marketing_costs table
// client-side (its column names vary; SQL never references them on purpose).

const CALL_TIMEOUT_MS = 25000;
const withTimeout = (promise, ms = CALL_TIMEOUT_MS) =>
  Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`נתקע (timeout מעל ${Math.round(ms / 1000)} שניות)`)), ms,
    )),
  ]);

async function fetchMarketingStats({ start, end, channel = null, campaign = null }) {
  const { data, error } = await withTimeout(
    base44.supabase.rpc('marketing_stats_v1', {
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_channel: channel,
      p_campaign: campaign,
    }),
  );
  if (error) {
    // PGRST202 = the function isn't in the schema (migration not applied yet
    // in this environment) — say that instead of a cryptic PostgREST message.
    if (error.code === 'PGRST202' || /marketing_stats_v1/.test(error.message || '')) {
      throw new Error('פונקציית הנתונים (marketing_stats_v1) עדיין לא הותקנה בבסיס הנתונים — יש להריץ את המיגרציה 20260825000001');
    }
    throw error;
  }
  return data || {};
}

// marketing_costs.date may be a plain date column; compare on the date part so
// an end bound of 23:59:59.999Z doesn't drop the range's last day. LOCAL date,
// not toISOString(): range bounds are local midnights, and in Israel (UTC+2/3)
// the UTC date of a local midnight is the previous day — which would pull an
// extra day of spend into every range and double-count it with the previous
// period.
const dayPart = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function fetchCosts({ start, end }) {
  return withTimeout(base44.entities.MarketingCost.filter(
    { date: { $gte: dayPart(start), $lte: `${dayPart(end)}T23:59:59.999Z` } },
    'date',
    5000,
  ));
}

export function useMarketingPanelData({ rangeKey, customRange, enabled = true }) {
  const { start, end } = useMemo(
    () => getDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );
  // "כל הזמנים" has no meaningful previous period — skip the comparison calls.
  const isAll = rangeKey === 'all';
  const prev = useMemo(
    () => (isAll ? null : getPreviousDateRange(rangeKey, customRange?.from, customRange?.to)),
    [rangeKey, customRange, isAll],
  );

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // retry: false on the RPC queries — a 25s timeout must not stack a second
  // concurrent heavy aggregation behind the first (the global default is retry: 1).
  const currentQ = useQuery({
    queryKey: ['marketingPanel', startIso, endIso],
    enabled,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    placeholderData: (p) => p,
    queryFn: () => fetchMarketingStats({ start, end }),
  });

  const previousQ = useQuery({
    queryKey: ['marketingPanelPrev', prev?.start?.toISOString(), prev?.end?.toISOString()],
    enabled: enabled && !!prev,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    placeholderData: (p) => p,
    queryFn: () => (prev ? fetchMarketingStats({ start: prev.start, end: prev.end }) : null),
  });

  const costsQ = useQuery({
    queryKey: ['marketingPanelCosts', startIso, endIso],
    enabled,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (p) => p,
    queryFn: () => fetchCosts({ start, end }),
  });

  const prevCostsQ = useQuery({
    queryKey: ['marketingPanelCosts', prev?.start?.toISOString(), prev?.end?.toISOString()],
    enabled: enabled && !!prev,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (p) => p,
    queryFn: () => (prev ? fetchCosts({ start: prev.start, end: prev.end }) : []),
  });

  const merged = useMemo(() => {
    if (!currentQ.data) return null;
    // Gate the comparison inputs on prev: on "כל הזמנים" a placeholder from a
    // previously-viewed range must not leak stale deltas into the cards.
    const data = mergeMarketingData({
      current: currentQ.data,
      previous: prev ? (previousQ.data || null) : null,
      costs: costsQ.data || [],
      prevCosts: prev ? (prevCostsQ.data || []) : [],
    });
    return { ...data, insights: computeInsights(data) };
  }, [currentQ.data, previousQ.data, costsQ.data, prevCostsQ.data, prev]);

  return {
    data: merged,
    raw: currentQ.data || null,
    hasComparison: !!prev && !!previousQ.data,
    dateRange: { start, end },
    isLoading: currentQ.isLoading,
    isFetching: currentQ.isFetching || previousQ.isFetching || costsQ.isFetching,
    // Spend/comparison failures degrade the panel, they don't blank it —
    // surfaced as a warning banner instead of an error state.
    error: currentQ.error,
    partialFailures: [
      previousQ.error ? 'השוואה לתקופה קודמת' : null,
      costsQ.error || prevCostsQ.error ? 'עלויות שיווק' : null,
    ].filter(Boolean),
    // refetch() on a disabled query still fetches in react-query v5 — guard the
    // comparison queries so "כל הזמנים" + רענן doesn't run them with prev=null.
    refetch: () => {
      currentQ.refetch();
      costsQ.refetch();
      if (prev) { previousQ.refetch(); prevCostsQ.refetch(); }
    },
  };
}

// Drill-down into one campaign: same RPC filtered server-side, so the daily
// trend / adsets / ads / landing pages / statuses are exact for that campaign.
export function useCampaignDrill({ campaign, start, end, enabled = true }) {
  return useQuery({
    queryKey: ['marketingPanelDrill', campaign, start?.toISOString(), end?.toISOString()],
    enabled: enabled && !!campaign && !!start && !!end,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    queryFn: () => fetchMarketingStats({ start, end, campaign }),
  });
}
