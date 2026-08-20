-- ============================================================================
-- The second phone number becomes searchable
-- ============================================================================
-- leads.phone_2, customers.phone_2 and orders.customer_phone_2 have existed
-- since 20260804000003 and no search has ever looked at them. A customer whose
-- mobile sits in the second field is invisible to every lookup in the app —
-- the rep types the number they were just called from, gets nothing, and
-- creates the record again. The duplicate-lead warning then flags the mess
-- that the search itself caused.
--
-- ── WHY AN INDEX IS PART OF THE FIX AND NOT A FOLLOW-UP ────────────────────
-- The client change is one extra branch in each search:
--
--     WHERE phone ILIKE '%…%' OR phone_2 ILIKE '%…%'
--
-- Postgres builds a BitmapOr only when EVERY branch has an index. Add the
-- branch without the index and the planner drops the whole OR back to a
-- sequential scan — undoing 20260820000001 for the exact query it was written
-- for, and turning a 15 ms lookup back into three seconds. Shipping the client
-- half alone would have been a performance regression wearing a bug fix's
-- clothes.
--
-- ── WHY NOT phone_2_normalized ─────────────────────────────────────────────
-- phone_normalized is a GENERATED STORED column with a btree index, and an
-- equality match on it is cheaper and more correct than any substring search.
-- The obvious move is to give phone_2 the same treatment — and it is the right
-- move, but it belongs with the change that switches the screens over to the
-- normalized column, because that is the only code that would read it. Adding
-- the column here would ship a generated column on two large tables that
-- nothing queries. Trigram matches how phone itself is searched today, so the
-- second number behaves exactly like the first one.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.
-- ============================================================================

SET statement_timeout = '600s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS leads_phone_2_trgm_idx
  ON public.leads USING gin (phone_2 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_phone_2_trgm_idx
  ON public.customers USING gin (phone_2 gin_trgm_ops);

-- The order search matches on customer_phone; its second number is named
-- differently but is the same field to a rep looking an order up.
CREATE INDEX IF NOT EXISTS orders_customer_phone_2_trgm_idx
  ON public.orders USING gin (customer_phone_2 gin_trgm_ops);

-- orders.customer_phone itself was never indexed either — the order search has
-- been scanning all along, it just never came up because leads is the table
-- with 125k rows. Both branches of that OR need one.
CREATE INDEX IF NOT EXISTS orders_customer_phone_trgm_idx
  ON public.orders USING gin (customer_phone gin_trgm_ops);

ANALYZE public.leads;
ANALYZE public.customers;
ANALYZE public.orders;


DO $$
DECLARE
  built int;
BEGIN
  SELECT count(*) INTO built
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'leads_phone_2_trgm_idx', 'customers_phone_2_trgm_idx',
      'orders_customer_phone_2_trgm_idx', 'orders_customer_phone_trgm_idx');

  IF built <> 4 THEN
    RAISE EXCEPTION 'expected 4 second-phone indexes, found % — the OR would scan', built;
  END IF;

  RAISE NOTICE 'second-phone search indexes in place: % of 4', built;
END $$;
