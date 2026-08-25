-- ============================================================================
-- marketing_stats_v1 — the aggregation behind the smart marketing panel
-- ============================================================================
-- The Marketing page needs answers the existing dashboard_stats_v1 can't give:
-- which CAMPAIGN is worth more budget and which is burning it. That question
-- needs cuts the dashboard never computes — per-adset and per-ad breakdowns,
-- an hour×day arrival matrix for dayparting, a treatment funnel
-- (ליד → טופל → הצעה → נסגר), response-time medians, and a per-day trend by
-- channel — and it needs them for an arbitrary channel/campaign slice without
-- pulling 100k+ raw lead rows into the browser.
--
-- One call returns every cut pre-summed. Drill-down re-calls with p_campaign
-- (or p_channel) and gets the same shapes filtered to that slice, so the
-- panel's "top-level view" and "drill view" cannot disagree with each other.
--
-- Two deliberate semantic choices, both different from dashboard_stats_v1:
--
--   • COHORT revenue, not period revenue. A campaign is judged by what the
--     leads it brought in are worth — wherever their orders' created_date
--     falls. dashboard_stats_v1 counts orders created inside the range, which
--     answers "how did the business do this month", not "did this campaign
--     work". summary.period_revenue keeps the in-range figure for the trend
--     chart and reconciliation with the dashboard.
--   • The campaign key falls back to leads.source. Historic leads (e.g.
--     "גוגל דף חדש עלית - ליד", 13,599 rows) carry the campaign name in
--     `source` with no utm_campaign at all — under dashboard_stats_v1's key
--     they all collapse into "ללא קמפיין" and the biggest campaigns in the
--     account become invisible.
--
-- Channel normalization reuses public.lead_source_channel() (20260824000001),
-- the same rules that label the מקור הגעה badge and filter on ניהול לידים —
-- one vocabulary everywhere. Cancelled orders (cancelled_at IS NOT NULL) are
-- never revenue here.
--
-- Ad spend (marketing_costs) is deliberately NOT referenced from SQL — its
-- column names vary between deployments, so the client keeps merging that
-- small table in JS, same as getDashboardStats does (see 20260615000001).
--
-- Also below: dashboard_stats_v1 is re-created with the one behavioural fix
-- it owed — excluding cancelled orders — see its own comment.
--
-- Idempotent: CREATE OR REPLACE FUNCTION only; indexes it relies on
-- (idx_leads_effective_sort_date, idx_orders_lead_id, idx_quotes_lead_id,
-- idx_orders_created_date) already exist from 20260615000001.

BEGIN;

CREATE OR REPLACE FUNCTION public.marketing_stats_v1(
  p_start timestamptz,
  p_end timestamptz,
  p_channel text DEFAULT NULL,
  p_campaign text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
-- Planner guard: with wide ranges the parameterized bounds mislead the row
-- estimates and the lq/lr semi-joins flip to nested loops over 100k+ rows —
-- measured >135s on the "כל הזמנים" range vs ~3.4s with hash joins. Scoped to
-- this function only; small ranges are unaffected (slightly faster, even).
SET enable_nestloop = off
AS $func$
WITH closed_set AS (
  SELECT unnest(public.lead_closed_statuses()) AS status
),
lead_base AS (
  SELECT
    l.id,
    l.status,
    -- Channel via the shared resolver, fed the same derived raw source
    -- dashboard_stats_v1 uses: utm_source, else source, else 'facebook' when
    -- only facebook_* lead-form metadata identifies the platform.
    public.lead_source_channel(
      COALESCE(
        NULLIF(btrim(l.utm_source), ''),
        NULLIF(btrim(l.source), ''),
        CASE WHEN NULLIF(btrim(l.facebook_campaign_name), '') IS NOT NULL
                OR NULLIF(btrim(l.facebook_ad_name), '') IS NOT NULL
                OR NULLIF(btrim(l.facebook_adset_name), '') IS NOT NULL
             THEN 'facebook' END,
        ''
      )
    ) AS channel,
    -- Campaign key: utm_campaign → facebook campaign → the legacy campaign
    -- name living in `source` (see header) → "ללא קמפיין".
    COALESCE(
      NULLIF(btrim(l.utm_campaign), ''),
      NULLIF(btrim(l.facebook_campaign_name), ''),
      NULLIF(btrim(l.source), ''),
      'ללא קמפיין'
    ) AS campaign,
    NULLIF(btrim(l.facebook_adset_name), '') AS adset,
    NULLIF(btrim(l.facebook_ad_name), '') AS ad,
    COALESCE(NULLIF(btrim(l.landing_page), ''), 'ללא דף נחיתה') AS lp,
    (l.status = 'deal_closed') AS is_won,
    (l.status <> 'deal_closed' AND l.status IN (SELECT status FROM closed_set)) AS is_lost,
    (l.status NOT IN (SELECT status FROM closed_set)) AS is_open,
    (l.first_action_at IS NOT NULL) AS contacted,
    CASE WHEN l.first_action_at IS NOT NULL AND l.created_date IS NOT NULL
              AND l.first_action_at > l.created_date
         THEN EXTRACT(EPOCH FROM (l.first_action_at - l.created_date)) / 60.0
    END AS mins_to_contact,
    -- Israel-local buckets: the trend and the hour×day matrix answer "when do
    -- leads arrive" as the office experiences it, not in UTC days.
    to_char(l.effective_sort_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS il_day,
    EXTRACT(DOW  FROM (COALESCE(l.created_date, l.effective_sort_date) AT TIME ZONE 'Asia/Jerusalem'))::int AS il_dow,
    EXTRACT(HOUR FROM (COALESCE(l.created_date, l.effective_sort_date) AT TIME ZONE 'Asia/Jerusalem'))::int AS il_hour
  FROM public.leads l
  WHERE l.effective_sort_date >= p_start AND l.effective_sort_date <= p_end
),
fl AS (
  -- Campaign match is case-insensitive: the panel merges 'Spring Sale' (a
  -- human-typed facebook_campaign_name) with 'spring sale' (a URL utm_campaign)
  -- into one row, and the drill has to return that whole row.
  SELECT * FROM lead_base
  WHERE (p_channel IS NULL OR channel = p_channel)
    AND (p_campaign IS NULL OR lower(campaign) = lower(p_campaign))
),
-- Cohort joins: a lead of this range counts its quote/order whenever they
-- happened, so a lead from the range's last day still gets credit for the
-- quote sent two days later.
lq AS (
  SELECT DISTINCT q.lead_id FROM public.quotes q
  WHERE q.lead_id IN (SELECT id FROM fl)
),
lr AS (
  SELECT o.lead_id, SUM(COALESCE(o.total, 0)) AS rev, COUNT(*) AS n_orders
  FROM public.orders o
  WHERE o.lead_id IN (SELECT id FROM fl) AND o.cancelled_at IS NULL
  GROUP BY o.lead_id
),
flx AS (
  SELECT f.*, (q.lead_id IS NOT NULL) AS has_quote,
         COALESCE(r.rev, 0) AS rev, COALESCE(r.n_orders, 0) AS n_orders
  FROM fl f
  LEFT JOIN lq q ON q.lead_id = f.id
  LEFT JOIN lr r ON r.lead_id = f.id
),
-- Period revenue for the daily trend: orders created inside the range
-- (cancelled excluded), attributed through their lead joined WITHOUT a date
-- filter, so an old lead's order still knows its channel/campaign.
po AS (
  SELECT
    COALESCE(o.total, 0) AS total,
    to_char(o.created_date AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS il_day,
    public.lead_source_channel(
      COALESCE(
        NULLIF(btrim(l.utm_source), ''),
        NULLIF(btrim(l.source), ''),
        CASE WHEN NULLIF(btrim(l.facebook_campaign_name), '') IS NOT NULL
                OR NULLIF(btrim(l.facebook_ad_name), '') IS NOT NULL
                OR NULLIF(btrim(l.facebook_adset_name), '') IS NOT NULL
             THEN 'facebook' END,
        ''
      )
    ) AS channel,
    COALESCE(
      NULLIF(btrim(l.utm_campaign), ''),
      NULLIF(btrim(l.facebook_campaign_name), ''),
      NULLIF(btrim(l.source), ''),
      'ללא קמפיין'
    ) AS campaign
  FROM public.orders o
  LEFT JOIN public.leads l ON l.id = o.lead_id
  WHERE o.created_date >= p_start AND o.created_date <= p_end
    AND o.cancelled_at IS NULL
),
fpo AS (
  SELECT * FROM po
  WHERE (p_channel IS NULL OR channel = p_channel)
    AND (p_campaign IS NULL OR lower(campaign) = lower(p_campaign))
)
SELECT jsonb_build_object(
  'summary', (SELECT jsonb_build_object(
      'leads',     COUNT(*),
      'contacted', COUNT(*) FILTER (WHERE contacted),
      'quoted',    COUNT(*) FILTER (WHERE has_quote),
      'won',       COUNT(*) FILTER (WHERE is_won),
      'lost',      COUNT(*) FILTER (WHERE is_lost),
      'open',      COUNT(*) FILTER (WHERE is_open),
      'revenue',   COALESCE(SUM(rev), 0),
      'orders',    COALESCE(SUM(n_orders), 0),
      'period_revenue', COALESCE((SELECT SUM(total) FROM fpo), 0),
      'median_mins_to_contact',
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins_to_contact)
           FROM flx WHERE mins_to_contact IS NOT NULL)
    ) FROM flx),
  'channels', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'channel', s.channel, 'leads', s.n_leads, 'contacted', s.n_contacted,
      'quoted', s.n_quoted, 'won', s.n_won, 'lost', s.n_lost, 'open', s.n_open,
      'revenue', s.revenue, 'orders', s.orders,
      'median_mins_to_contact', s.med_mins) ORDER BY s.n_leads DESC), '[]'::jsonb)
    FROM (SELECT channel,
            COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE contacted) AS n_contacted,
            COUNT(*) FILTER (WHERE has_quote) AS n_quoted,
            COUNT(*) FILTER (WHERE is_won) AS n_won,
            COUNT(*) FILTER (WHERE is_lost) AS n_lost,
            COUNT(*) FILTER (WHERE is_open) AS n_open,
            SUM(rev) AS revenue, SUM(n_orders) AS orders,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY mins_to_contact) AS med_mins
          FROM flx GROUP BY channel) s),
  'campaigns', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'campaign', s.campaign, 'channel', s.channel, 'leads', s.n_leads,
      'contacted', s.n_contacted, 'quoted', s.n_quoted, 'won', s.n_won,
      'lost', s.n_lost, 'open', s.n_open,
      'revenue', s.revenue, 'orders', s.orders) ORDER BY s.n_leads DESC), '[]'::jsonb)
    FROM (SELECT campaign,
            mode() WITHIN GROUP (ORDER BY channel) AS channel,
            COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE contacted) AS n_contacted,
            COUNT(*) FILTER (WHERE has_quote) AS n_quoted,
            COUNT(*) FILTER (WHERE is_won) AS n_won,
            COUNT(*) FILTER (WHERE is_lost) AS n_lost,
            COUNT(*) FILTER (WHERE is_open) AS n_open,
            SUM(rev) AS revenue, SUM(n_orders) AS orders
          FROM flx GROUP BY campaign
          ORDER BY COUNT(*) DESC LIMIT 400) s),
  'adsets', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'campaign', s.campaign, 'adset', s.adset, 'leads', s.n_leads,
      'quoted', s.n_quoted, 'won', s.n_won, 'revenue', s.revenue)
      ORDER BY s.n_leads DESC), '[]'::jsonb)
    FROM (SELECT campaign, adset, COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE has_quote) AS n_quoted,
            COUNT(*) FILTER (WHERE is_won) AS n_won, SUM(rev) AS revenue
          FROM flx WHERE adset IS NOT NULL GROUP BY campaign, adset
          ORDER BY COUNT(*) DESC LIMIT 300) s),
  'ads', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'campaign', s.campaign, 'ad', s.ad, 'leads', s.n_leads,
      'quoted', s.n_quoted, 'won', s.n_won, 'revenue', s.revenue)
      ORDER BY s.n_leads DESC), '[]'::jsonb)
    FROM (SELECT campaign, ad, COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE has_quote) AS n_quoted,
            COUNT(*) FILTER (WHERE is_won) AS n_won, SUM(rev) AS revenue
          FROM flx WHERE ad IS NOT NULL GROUP BY campaign, ad
          ORDER BY COUNT(*) DESC LIMIT 300) s),
  'landing_pages', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'lp', s.lp, 'channel', s.channel, 'leads', s.n_leads,
      'quoted', s.n_quoted, 'won', s.n_won, 'revenue', s.revenue)
      ORDER BY s.n_leads DESC), '[]'::jsonb)
    FROM (SELECT lp, mode() WITHIN GROUP (ORDER BY channel) AS channel,
            COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE has_quote) AS n_quoted,
            COUNT(*) FILTER (WHERE is_won) AS n_won, SUM(rev) AS revenue
          FROM flx GROUP BY lp
          ORDER BY COUNT(*) DESC LIMIT 200) s),
  'daily', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'd', s.il_day, 'channel', s.channel, 'leads', s.n_leads, 'won', s.n_won)
      ORDER BY s.il_day), '[]'::jsonb)
    FROM (SELECT il_day, channel, COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE is_won) AS n_won
          FROM flx WHERE il_day IS NOT NULL GROUP BY il_day, channel) s),
  'revenue_daily', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'd', s.il_day, 'revenue', s.revenue) ORDER BY s.il_day), '[]'::jsonb)
    FROM (SELECT il_day, SUM(total) AS revenue
          FROM fpo WHERE il_day IS NOT NULL GROUP BY il_day) s),
  'hours', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'dow', s.il_dow, 'hour', s.il_hour, 'leads', s.n_leads, 'won', s.n_won)
      ORDER BY s.il_dow, s.il_hour), '[]'::jsonb)
    FROM (SELECT il_dow, il_hour, COUNT(*) AS n_leads,
            COUNT(*) FILTER (WHERE is_won) AS n_won
          FROM flx WHERE il_dow IS NOT NULL AND il_hour IS NOT NULL
          GROUP BY il_dow, il_hour) s),
  'statuses', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'status', s.status, 'count', s.n) ORDER BY s.n DESC), '[]'::jsonb)
    FROM (SELECT status, COUNT(*) AS n FROM flx
          GROUP BY status ORDER BY COUNT(*) DESC LIMIT 40) s)
);
$func$;

COMMENT ON FUNCTION public.marketing_stats_v1(timestamptz, timestamptz, text, text) IS
  'Pre-summed marketing cuts (channel/campaign/adset/ad/landing page/day/hour/status) for the Marketing panel. Cohort semantics: leads by effective_sort_date in range; their quotes/orders counted whenever created (cancelled orders excluded). p_channel/p_campaign NULL = no filter. Spend (marketing_costs) is merged client-side on purpose — see 20260825000001 header.';

GRANT EXECUTE ON FUNCTION public.marketing_stats_v1(timestamptz, timestamptz, text, text)
  TO authenticated, service_role;


-- ─── dashboard_stats_v1 — cancelled orders are not revenue ──────────────────
-- The JS fallback in getDashboardStats has excluded cancelled orders since
-- 20260803000001 ("A cancelled order is not revenue"), but this SQL fast path
-- was rewritten in 20260803000004 from the pre-cancellation body and still
-- sums them — so the dashboard's revenue depends on which path served it.
-- Same body as 20260803000004 with `cancelled_at IS NULL` added to the three
-- order scans (lr, oa, revenue_daily).
CREATE OR REPLACE FUNCTION public.dashboard_stats_v1(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $func$
WITH closed_set AS (
  SELECT unnest(public.lead_closed_statuses()) AS status
),
lead_base AS (
  SELECT
    l.id,
    lower(btrim(COALESCE(l.rep1, ''))) AS rep,
    l.effective_sort_date,
    -- raw source key, mirroring the Edge Function's deriveSource()
    COALESCE(
      NULLIF(btrim(l.utm_source), ''),
      NULLIF(btrim(l.source), ''),
      CASE WHEN NULLIF(btrim(l.facebook_campaign_name), '') IS NOT NULL
              OR NULLIF(btrim(l.facebook_ad_name), '') IS NOT NULL
              OR NULLIF(btrim(l.facebook_adset_name), '') IS NOT NULL
           THEN 'facebook' END,
      ''
    ) AS src_key,
    COALESCE(NULLIF(btrim(l.utm_campaign), ''), NULLIF(btrim(l.facebook_campaign_name), ''), 'ללא קמפיין') AS camp_key,
    COALESCE(NULLIF(btrim(l.landing_page), ''), 'ללא דף נחיתה') AS lp_key,
    (l.status = 'deal_closed') AS is_won,
    (l.status <> 'deal_closed' AND l.status IN (SELECT status FROM closed_set)) AS is_lost,
    (l.status NOT IN (SELECT status FROM closed_set)) AS is_open,
    (l.first_action_at IS NULL AND l.created_date < (now() - interval '15 minutes')) AS sla_red
  FROM public.leads l
  WHERE l.effective_sort_date >= p_start AND l.effective_sort_date <= p_end
),
lq AS (
  SELECT DISTINCT lead_id FROM public.quotes
  WHERE lead_id IS NOT NULL AND created_date >= p_start AND created_date <= p_end
),
lr AS (
  SELECT lead_id, SUM(COALESCE(total, 0)) AS rev FROM public.orders
  WHERE lead_id IS NOT NULL AND created_date >= p_start AND created_date <= p_end
    AND cancelled_at IS NULL
  GROUP BY lead_id
),
lb AS (
  SELECT b.*, (q.lead_id IS NOT NULL) AS has_quote, COALESCE(r.rev, 0) AS rev
  FROM lead_base b
  LEFT JOIN lq q ON q.lead_id = b.id
  LEFT JOIN lr r ON r.lead_id = b.id
),
-- order revenue attributed to a source/campaign/landing page via the order's lead
oa AS (
  SELECT
    COALESCE(o.total, 0) AS total,
    COALESCE(
      NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source), ''),
      CASE WHEN NULLIF(btrim(l.facebook_campaign_name), '') IS NOT NULL
              OR NULLIF(btrim(l.facebook_ad_name), '') IS NOT NULL
              OR NULLIF(btrim(l.facebook_adset_name), '') IS NOT NULL
           THEN 'facebook' END,
      ''
    ) AS src_key,
    COALESCE(NULLIF(btrim(l.utm_campaign), ''), NULLIF(btrim(l.facebook_campaign_name), ''), 'ללא קמפיין') AS camp_key,
    COALESCE(NULLIF(btrim(l.landing_page), ''), 'ללא דף נחיתה') AS lp_key
  FROM public.orders o
  LEFT JOIN public.leads l ON l.id = o.lead_id
  WHERE o.created_date >= p_start AND o.created_date <= p_end
    AND o.cancelled_at IS NULL
)
SELECT jsonb_build_object(
  'summary', (SELECT jsonb_build_object(
    'leads', COUNT(*),
    'won', COUNT(*) FILTER (WHERE is_won),
    'sla_red', COUNT(*) FILTER (WHERE sla_red),
    'revenue', COALESCE((SELECT SUM(total) FROM oa), 0)
  ) FROM lb),
  'lead_sources', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'k', k, 'leads', leads, 'won', won, 'lost', lost, 'open', open, 'quote_sent', quote_sent)), '[]'::jsonb)
    FROM (SELECT src_key k, COUNT(*) leads, COUNT(*) FILTER (WHERE is_won) won,
        COUNT(*) FILTER (WHERE is_lost) lost, COUNT(*) FILTER (WHERE is_open) open,
        COUNT(*) FILTER (WHERE has_quote) quote_sent
      FROM lb GROUP BY src_key) s),
  'src_rev', (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', k, 'revenue', rev)), '[]'::jsonb)
    FROM (SELECT src_key k, SUM(total) rev FROM oa GROUP BY src_key) s),
  'lead_campaigns', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'k', k, 'src', src, 'leads', leads, 'won', won, 'lost', lost, 'open', open, 'quote_sent', quote_sent)), '[]'::jsonb)
    FROM (SELECT camp_key k, MAX(src_key) src, COUNT(*) leads, COUNT(*) FILTER (WHERE is_won) won,
        COUNT(*) FILTER (WHERE is_lost) lost, COUNT(*) FILTER (WHERE is_open) open,
        COUNT(*) FILTER (WHERE has_quote) quote_sent
      FROM lb GROUP BY camp_key) s),
  'camp_rev', (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', k, 'revenue', rev)), '[]'::jsonb)
    FROM (SELECT camp_key k, SUM(total) rev FROM oa GROUP BY camp_key) s),
  'lead_lps', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'k', k, 'src', src, 'leads', leads, 'won', won, 'lost', lost, 'open', open, 'quote_sent', quote_sent)), '[]'::jsonb)
    FROM (SELECT lp_key k, MAX(src_key) src, COUNT(*) leads, COUNT(*) FILTER (WHERE is_won) won,
        COUNT(*) FILTER (WHERE is_lost) lost, COUNT(*) FILTER (WHERE is_open) open,
        COUNT(*) FILTER (WHERE has_quote) quote_sent
      FROM lb GROUP BY lp_key) s),
  'lp_rev', (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', k, 'revenue', rev)), '[]'::jsonb)
    FROM (SELECT lp_key k, SUM(total) rev FROM oa GROUP BY lp_key) s),
  'reps', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'email', rep, 'leads', leads, 'won', won, 'sla_red', sla_red, 'revenue', rev)), '[]'::jsonb)
    FROM (SELECT rep, COUNT(*) leads, COUNT(*) FILTER (WHERE is_won) won,
        COUNT(*) FILTER (WHERE sla_red) sla_red, SUM(rev) rev
      FROM lb WHERE rep <> '' GROUP BY rep) s),
  'leads_daily', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', c) ORDER BY d), '[]'::jsonb)
    FROM (SELECT to_char(effective_sort_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') d, COUNT(*) c
      FROM lb WHERE effective_sort_date IS NOT NULL GROUP BY 1) s),
  'revenue_daily', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'value', v) ORDER BY d), '[]'::jsonb)
    FROM (SELECT to_char(created_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') d, SUM(COALESCE(total, 0)) v
      FROM public.orders WHERE created_date >= p_start AND created_date <= p_end AND created_date IS NOT NULL
        AND cancelled_at IS NULL
      GROUP BY 1) s)
);
$func$;

GRANT EXECUTE ON FUNCTION public.dashboard_stats_v1(timestamptz, timestamptz) TO authenticated, anon, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
