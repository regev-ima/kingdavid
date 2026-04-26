-- /LandingPages was timing out (or never returning) because the page tried to
-- fetchAll() leads, orders and quotes in 500-row batches and aggregated in
-- the browser. With ~104k leads that meant ~200 round-trips before the page
-- could even render. Move the aggregation server-side.
--
-- The view exposes everything the React table needs in a single round-trip:
--   landing_page, total_leads, won_leads, quote_leads, open_leads, revenue,
--   sources (concatenated UTM/source labels), conversion_rate, quote_rate.
--
-- "Open" matches the closed-status set the client used so the math stays
-- consistent across pages. Rates are pre-rounded to one decimal in the view
-- so we don't need to recompute on the client.

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
  SELECT unnest(ARRAY[
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
    'closed_by_manager_to_mailing'
  ]) AS status
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

NOTIFY pgrst, 'reload schema';
