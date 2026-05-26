-- Remove the VIP customer feature entirely. The UI never matured into a
-- real workflow (single toggle on the customer page + a KPI tile + a
-- filter dropdown — no automation, segmentation, or pricing behaviour
-- wired off it), so it added noise without adding value.
--
-- Order of operations matters:
--   1. Reset any vip_status=true rows back to false so the column drop
--      doesn't quietly take a "yes" value into oblivion. Belt-and-suspenders
--      — DROP COLUMN doesn't delete the row, but flipping the flag first
--      makes the data state explicit in the audit trail.
--   2. Recreate customers_stats without the `vip` column. The old view
--      can't drop a column individually so we replace the definition.
--   3. Drop customers.vip_status itself.
--
-- Rows themselves (full_name, phone, orders, revenue, …) are untouched.

UPDATE public.customers
SET vip_status = false
WHERE vip_status IS TRUE;

CREATE OR REPLACE VIEW public.customers_stats AS
SELECT
  COUNT(*)                                                   AS total,
  COALESCE(SUM(total_revenue), 0)::numeric                   AS revenue,
  COALESCE(SUM(total_orders), 0)::bigint                     AS orders
FROM public.customers;

GRANT SELECT ON public.customers_stats TO authenticated;
GRANT SELECT ON public.customers_stats TO anon;

ALTER TABLE public.customers DROP COLUMN IF EXISTS vip_status;

NOTIFY pgrst, 'reload schema';
