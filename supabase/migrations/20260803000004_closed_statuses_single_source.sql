-- ============================================================================
-- The closed-status list gets the 8 statuses it was missing — in one place
-- ============================================================================
-- src/constants/leadOptions.js just grew 22 status keys that migration
-- 20260426000004 had already written into leads.status but that no list in the
-- codebase acknowledged. Eight of them terminate a lead, so they belong in the
-- closed set: without them a handled service ticket and a system-test row count
-- as open pipeline on every dashboard.
--
-- The list lived in THREE separate SQL copies — lead_closed_statuses(),
-- the landing_pages_stats view, and dashboard_stats_v1 — which is how it came
-- to disagree with itself in the first place. This migration extends the
-- function and repoints the other two at it, so SQL now has exactly one copy.
-- (leadOptions.js and getDashboardStats/index.ts are the remaining two, and
-- neither can import from here; both carry a comment naming the others.)
--
-- The view and function bodies below are otherwise byte-identical to
-- 20260426000003 and 20260615000001 — only the CTE that spelled out the list
-- changed. CREATE OR REPLACE throughout, so re-running is a no-op.
--
-- The eight, and why each closes:
--   not_relevant_not_mature            every other "לא רלוונטי - X" is closed
--   system_test                        test data, never real work
--   service_handled                    "טופל" — the ticket is done
--   service_30_nights_trial_handled    ditto
--   service_warranty_handled           ditto
--   service_cancellations_handled      ditto
--   service_missing_items_handled      ditto
--   delivery_inquiry_handled           ditto
-- The un-handled half of each service pair stays OPEN: somebody still owes the
-- customer an answer.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lead_closed_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'deal_closed', 'not_relevant_duplicate', 'mailing_remove_request',
    'lives_far_phone_concern', 'products_not_available',
    'not_relevant_bought_elsewhere', 'not_relevant_1000_nis',
    'not_relevant_denies_contact', 'not_relevant_service',
    'not_interested_hangs_up', 'not_relevant_no_explanation',
    'heard_price_not_interested', 'not_relevant_wrong_number',
    'closed_by_manager_to_mailing',
    -- added with the 20260426000004 keys
    'not_relevant_not_mature', 'system_test',
    'service_handled', 'service_30_nights_trial_handled',
    'service_warranty_handled', 'service_cancellations_handled',
    'service_missing_items_handled', 'delivery_inquiry_handled'
  ]::text[];
$$;

COMMENT ON FUNCTION public.lead_closed_statuses() IS
  'Lead statuses that terminate the pipeline. Single SQL source of truth — landing_pages_stats and dashboard_stats_v1 both call it. Mirrored in src/constants/leadOptions.js and supabase/functions/getDashboardStats/index.ts.';


-- ─── landing_pages_stats — same body, list swapped for the function ─────────
CREATE OR REPLACE VIEW public.landing_pages_stats AS
WITH lead_lp AS (
  SELECT
    COALESCE(NULLIF(btrim(landing_page), ''), 'ללא דף נחיתה') AS landing_page,
    id,
    status,
    NULLIF(btrim(COALESCE(utm_source, source)), '') AS source_label
  FROM public.leads
),
quote_leads AS (
  SELECT DISTINCT lead_id
  FROM public.quotes
  WHERE lead_id IS NOT NULL
),
order_revenue AS (
  SELECT lead_id, SUM(COALESCE(total, 0)) AS revenue
  FROM public.orders
  WHERE lead_id IS NOT NULL
  GROUP BY lead_id
),
closed_status_set AS (
  SELECT unnest(public.lead_closed_statuses()) AS status
)
SELECT
  ll.landing_page,
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE ll.status = 'deal_closed') AS won_leads,
  COUNT(DISTINCT ql.lead_id) AS quote_leads,
  COUNT(*) FILTER (WHERE ll.status NOT IN (SELECT status FROM closed_status_set)) AS open_leads,
  COALESCE(SUM(orev.revenue), 0)::numeric AS revenue,
  COALESCE(STRING_AGG(DISTINCT ll.source_label, ', '), '-') AS sources,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(COUNT(*) FILTER (WHERE ll.status = 'deal_closed')::numeric * 1000 / COUNT(*)) / 10
    ELSE 0 END AS conversion_rate,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(COUNT(DISTINCT ql.lead_id)::numeric * 1000 / COUNT(*)) / 10
    ELSE 0 END AS quote_rate
FROM lead_lp ll
LEFT JOIN quote_leads  ql   ON ql.lead_id   = ll.id
LEFT JOIN order_revenue orev ON orev.lead_id = ll.id
GROUP BY ll.landing_page
ORDER BY total_leads DESC;


GRANT SELECT ON public.landing_pages_stats TO authenticated;
GRANT SELECT ON public.landing_pages_stats TO anon;


-- ─── dashboard_stats_v1 — same body, list swapped for the function ──────────
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
  -- cancelled_at IS NULL added by 20260825000001 (a cancelled order is not
  -- revenue) — kept here too so a re-run of THIS file's workflow can't revert it.
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
