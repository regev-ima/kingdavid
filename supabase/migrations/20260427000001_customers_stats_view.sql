-- Aggregate KPIs for /Customers in a single round-trip. The page used to
-- pull every customer (PostgREST capped it at 1000 rows by default) and sum
-- in the browser, so "סה״כ לקוחות" rendered 1,000 even when there were
-- ~15k+ rows after the deal_closed → customers backfill.
--
-- One-row view exposing total / vip / revenue / orders for the whole table.
-- Same pattern as public.rep_stats and public.landing_pages_stats.

CREATE OR REPLACE VIEW public.customers_stats AS
SELECT
  COUNT(*)                                                   AS total,
  COUNT(*) FILTER (WHERE vip_status IS TRUE)                 AS vip,
  COALESCE(SUM(total_revenue), 0)::numeric                   AS revenue,
  COALESCE(SUM(total_orders), 0)::bigint                     AS orders
FROM public.customers;

GRANT SELECT ON public.customers_stats TO authenticated;
GRANT SELECT ON public.customers_stats TO anon;

NOTIFY pgrst, 'reload schema';
