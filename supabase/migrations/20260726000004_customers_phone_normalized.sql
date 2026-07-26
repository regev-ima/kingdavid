-- Same canonical phone key for customers as for leads.
--
-- customers.phone has the same problem leads.phone had: it stores whatever the
-- source wrote, and every "does this customer already exist?" check compares the
-- raw string (`Customer.filter({ phone })`). Two consequences, both worse than on
-- leads because money is attached:
--
--   • Closing a deal ("המר ללקוח") and saving an order each create a SECOND
--     customer row when the phone was stored in another format.
--   • The order counters live on that row — NewOrder increments total_orders and
--     lifetime_value on whichever record it matched — so a duplicate SPLITS the
--     customer's order count and lifetime value across two records, and every
--     revenue view built on them under-reports.
--
-- normalize_il_phone() already exists (leads migration); this adds the same
-- trigger-maintained column, index and duplicates view for customers.
--
-- The index is NOT unique here either: duplicates already exist, and merging
-- them means moving orders/revenue between rows — a follow-up, not a migration.

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_normalized text;

COMMENT ON COLUMN public.customers.phone_normalized IS
  'Canonical form of phone (972XXXXXXXXX), maintained by trigger. Use this to match/dedupe customers by phone — never the raw phone column.';

CREATE OR REPLACE FUNCTION public.customers_sync_phone_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_normalized := public.normalize_il_phone(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_phone_normalized_sync ON public.customers;
CREATE TRIGGER customers_phone_normalized_sync
  BEFORE INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.customers_sync_phone_normalized();

UPDATE public.customers
SET phone_normalized = public.normalize_il_phone(phone)
WHERE phone_normalized IS DISTINCT FROM public.normalize_il_phone(phone);

CREATE INDEX IF NOT EXISTS customers_phone_normalized_idx
  ON public.customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- Duplicate groups, with the split totals spelled out so the damage is visible
-- before anything is merged.
CREATE OR REPLACE VIEW public.customer_phone_duplicates AS
SELECT
  phone_normalized,
  count(*)::bigint AS customer_count,
  sum(coalesce(total_orders, 0))::bigint AS total_orders_combined,
  sum(coalesce(lifetime_value, 0)) AS lifetime_value_combined,
  min(created_date) AS first_created,
  array_agg(id ORDER BY created_date) AS customer_ids
FROM public.customers
WHERE phone_normalized IS NOT NULL
GROUP BY phone_normalized
HAVING count(*) > 1;

COMMENT ON VIEW public.customer_phone_duplicates IS
  'Customers sharing one canonical phone, with their combined order count and lifetime value. Input for the merge flow.';

GRANT SELECT ON public.customer_phone_duplicates TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
