-- ============================================================================
-- The rest of the search: quotes, tickets, and the branches nobody indexed
-- ============================================================================
-- Two holes were left after 20260820000003, and closing them turned up a third.
--
--   1. A phone number never found a QUOTE. The global search matched quotes on
--      quote_number and customer_name only — no phone at all, even though
--      quotes.customer_phone has always been there and customer_phone_2 was
--      added in 20260804000003. Type a customer's number and you got their
--      lead and their orders; the quote you were looking for stayed hidden.
--
--   2. Service tickets had no second phone to search. Not a client bug — the
--      column did not exist. It does now, and the ticket dialog fills it from
--      whichever record the rep matched.
--
--   3. And the one that fell out of writing this: orders, quotes and tickets
--      search several columns with OR, and Postgres builds a BitmapOr only
--      when EVERY branch has an index. 20260820000003 indexed
--      orders.customer_phone and customer_phone_2 — but order_number and
--      customer_name still had none, so the order search kept scanning the
--      whole table and the two new indexes went unused. Half an OR indexed is
--      the same as none of it.
--
-- So this indexes every column every search actually asks about:
--
--   orders          order_number, customer_name         (phones: 20260820000003)
--   quotes          quote_number, customer_name, customer_phone, customer_phone_2
--   support_tickets ticket_number, customer_name, customer_phone, customer_phone_2
--
-- leads and customers were finished in 20260820000001 + 20260820000003.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- ============================================================================

SET statement_timeout = '600s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The second number a service call can come in on. Nothing reads it until the
-- client half of this change ships, which is the same commit.
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS customer_phone_2 text;


-- ── orders: the branches 20260820000003 left bare ───────────────────────────
CREATE INDEX IF NOT EXISTS orders_order_number_trgm_idx
  ON public.orders USING gin (order_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_customer_name_trgm_idx
  ON public.orders USING gin (customer_name gin_trgm_ops);


-- ── quotes: all four, since none existed ────────────────────────────────────
CREATE INDEX IF NOT EXISTS quotes_quote_number_trgm_idx
  ON public.quotes USING gin (quote_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS quotes_customer_name_trgm_idx
  ON public.quotes USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS quotes_customer_phone_trgm_idx
  ON public.quotes USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS quotes_customer_phone_2_trgm_idx
  ON public.quotes USING gin (customer_phone_2 gin_trgm_ops);


-- ── support_tickets: all four, same reason ──────────────────────────────────
CREATE INDEX IF NOT EXISTS tickets_ticket_number_trgm_idx
  ON public.support_tickets USING gin (ticket_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tickets_customer_name_trgm_idx
  ON public.support_tickets USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tickets_customer_phone_trgm_idx
  ON public.support_tickets USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tickets_customer_phone_2_trgm_idx
  ON public.support_tickets USING gin (customer_phone_2 gin_trgm_ops);


ANALYZE public.orders;
ANALYZE public.quotes;
ANALYZE public.support_tickets;

-- PostgREST caches the schema; without this the first write to
-- support_tickets.customer_phone_2 fails with PGRST204.
NOTIFY pgrst, 'reload schema';


DO $$
DECLARE
  built int;
BEGIN
  SELECT count(*) INTO built
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'orders_order_number_trgm_idx', 'orders_customer_name_trgm_idx',
      'quotes_quote_number_trgm_idx', 'quotes_customer_name_trgm_idx',
      'quotes_customer_phone_trgm_idx', 'quotes_customer_phone_2_trgm_idx',
      'tickets_ticket_number_trgm_idx', 'tickets_customer_name_trgm_idx',
      'tickets_customer_phone_trgm_idx', 'tickets_customer_phone_2_trgm_idx');

  IF built <> 10 THEN
    RAISE EXCEPTION 'expected 10 indexes, found % — an OR branch is still bare and the search will scan', built;
  END IF;

  RAISE NOTICE 'search index coverage complete: % of 10', built;
END $$;
