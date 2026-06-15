-- Dashboard control center was recomputing every metric by pulling all leads /
-- orders / quotes in the range into the Edge Function and aggregating in JS.
-- With ~104k leads that meant fetching thousands of rows per request (and on
-- every range change) — the same problem that was already solved for the
-- LandingPages screen with the landing_pages_stats VIEW. This moves the heavy
-- aggregation into Postgres: one function call returns a few dozen pre-summed
-- rows instead of thousands of raw ones. getDashboardStats normalizes/merges
-- those small arrays (and folds in the small marketing_costs table) in JS, and
-- falls back to the old raw scan if this function is ever unavailable.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE FUNCTION.

-- Indexes that back the range filters / joins the function relies on.
CREATE INDEX IF NOT EXISTS idx_leads_effective_sort_date ON public.leads (effective_sort_date);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_date ON public.orders (created_date);
CREATE INDEX IF NOT EXISTS idx_orders_lead_id ON public.orders (lead_id);
CREATE INDEX IF NOT EXISTS idx_quotes_lead_id ON public.quotes (lead_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_date ON public.quotes (created_date);

CREATE OR REPLACE FUNCTION public.dashboard_stats_v1(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $func$
WITH closed_set AS (
  SELECT unnest(ARRAY[
    'deal_closed','not_relevant_duplicate','mailing_remove_request',
    'lives_far_phone_concern','products_not_available','not_relevant_bought_elsewhere',
    'not_relevant_1000_nis','not_relevant_denies_contact','not_relevant_service',
    'not_interested_hangs_up','not_relevant_no_explanation','heard_price_not_interested',
    'not_relevant_wrong_number','closed_by_manager_to_mailing'
  ]) AS status
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
      FROM public.orders WHERE created_date >= p_start AND created_date <= p_end AND created_date IS NOT NULL GROUP BY 1) s)
);
$func$;

GRANT EXECUTE ON FUNCTION public.dashboard_stats_v1(timestamptz, timestamptz) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
