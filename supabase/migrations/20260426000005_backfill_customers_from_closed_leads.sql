-- Backfill the customers table from every lead that has reached
-- status='deal_closed'. Until now the only path that promoted a lead to a
-- customer was the manual "המר ללקוח" button on /LeadDetails (and the
-- automatic create on /NewOrder), so the ~16k closed deals normalized in
-- the previous migration (20260426000004_normalize_lead_statuses.sql) were
-- still missing matching customer rows.
--
-- Insert one customer per UNIQUE phone, picking the most-recently-updated
-- closed lead as the canonical source. Skip phones that already have a
-- customer (LEFT JOIN ... WHERE c.id IS NULL), so this migration is
-- idempotent — safe to re-run if needed.
--
-- The column list mirrors the convertToCustomerMutation in
-- src/pages/LeadDetails.jsx so the rows look identical to ones produced by
-- the manual button.

BEGIN;

INSERT INTO public.customers (
  full_name,
  phone,
  email,
  address,
  city,
  lead_id,
  original_source,
  total_orders,
  total_revenue,
  lifetime_value,
  account_manager,
  created_date,
  updated_date
)
SELECT DISTINCT ON (l.phone)
  l.full_name,
  l.phone,
  l.email,
  l.address,
  l.city,
  l.id              AS lead_id,
  l.source          AS original_source,
  0                 AS total_orders,
  0                 AS total_revenue,
  0                 AS lifetime_value,
  l.rep1            AS account_manager,
  COALESCE(l.updated_date, l.created_date, now()) AS created_date,
  now()             AS updated_date
FROM public.leads l
LEFT JOIN public.customers c ON c.phone = l.phone
WHERE l.status = 'deal_closed'
  AND l.phone IS NOT NULL
  AND btrim(l.phone) <> ''
  AND c.id IS NULL
ORDER BY l.phone, l.updated_date DESC NULLS LAST, l.created_date DESC NULLS LAST;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Sanity-check after the migration runs:
--   SELECT COUNT(*) FROM public.customers;
--   SELECT COUNT(DISTINCT phone) FROM public.leads WHERE status = 'deal_closed';
-- The two numbers should be very close once you account for any customers
-- that already existed before the backfill.
