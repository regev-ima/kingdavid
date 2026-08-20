-- ============================================================================
-- Stop the lead/customer search from reading the whole table
-- ============================================================================
-- Every search box in the app — the phone lookup in "הזמנה חדשה" and "הצעה
-- חדשה", "איתור ליד", the customers list, the service-ticket dialog — asks
-- Postgres a question of this shape:
--
--     WHERE phone ILIKE '%537772829%'
--
-- A pattern that starts with % cannot use a btree index, so there is nothing
-- for the planner to do but read every row. Measured on production:
--
--     Seq Scan on leads … Rows Removed by Filter: 125592
--     Execution Time: 3229.371 ms
--
-- Three seconds, for one of the two queries a single lookup fires, on every
-- search. pg_trgm's GIN index makes exactly this pattern indexable.
--
-- ── WHY THE COLUMN LIST LOOKS OVER-EAGER ───────────────────────────────────
-- "איתור ליד" searches three columns at once:
--
--     full_name ILIKE '%x%' OR email ILIKE '%x%' OR unique_id ILIKE '%x%'
--
-- A BitmapOr needs an index on EVERY branch. Index two of the three and the
-- planner still falls back to a sequential scan for the whole OR — so leaving
-- `email` out to save a few megabytes would buy nothing at all. Same reasoning
-- for the customers list, which ORs full_name/phone/email.
--
-- ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
-- supabase/migrations/20260428000001_phone_trigram_indexes.sql asked for the
-- two phone indexes back in April and was never deployed: migrations in this
-- repo only run if they have a workflow of their own, and that one never got
-- one. It sat in the tree looking applied for four months. It is deleted in
-- this commit rather than left as a second, dead source of truth; the index
-- names here are the same, so an environment where someone ran it by hand
-- keeps what it has.
--
-- ── LOCKING ────────────────────────────────────────────────────────────────
-- Plain CREATE INDEX takes a SHARE lock: reads continue, writes on that table
-- wait for the build. Measured at ~1.5 s per index on 125k rows, so the whole
-- migration blocks writes for a few seconds. Not CONCURRENTLY, because the
-- Management API sends the file as one implicit transaction and CONCURRENTLY
-- cannot run inside a transaction block.
--
-- Idempotent: CREATE EXTENSION / CREATE INDEX, both IF NOT EXISTS.
-- ============================================================================

-- Index builds on a 125k-row table run past the default API timeout.
SET statement_timeout = '600s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ── leads ───────────────────────────────────────────────────────────────────
-- phone: the lookup in NewOrder / NewQuote / LeadLookupPanel.
CREATE INDEX IF NOT EXISTS leads_phone_trgm_idx
  ON public.leads USING gin (phone gin_trgm_ops);

-- full_name + email + unique_id: the three branches of "איתור ליד".
CREATE INDEX IF NOT EXISTS leads_full_name_trgm_idx
  ON public.leads USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS leads_email_trgm_idx
  ON public.leads USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS leads_unique_id_trgm_idx
  ON public.leads USING gin (unique_id gin_trgm_ops);


-- ── customers ───────────────────────────────────────────────────────────────
-- Every phone lookup queries customers in parallel with leads, so an indexed
-- leads table alone would still leave the search waiting on this one.
CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx
  ON public.customers USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_full_name_trgm_idx
  ON public.customers USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_email_trgm_idx
  ON public.customers USING gin (email gin_trgm_ops);


-- Fresh statistics, so the planner actually believes the new indexes on the
-- first query rather than the tenth.
ANALYZE public.leads;
ANALYZE public.customers;


DO $$
DECLARE
  built int;
BEGIN
  SELECT count(*) INTO built
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'leads_phone_trgm_idx', 'leads_full_name_trgm_idx',
      'leads_email_trgm_idx', 'leads_unique_id_trgm_idx',
      'customers_phone_trgm_idx', 'customers_full_name_trgm_idx',
      'customers_email_trgm_idx');

  IF built <> 7 THEN
    RAISE EXCEPTION 'expected 7 trigram indexes, found % — search is still scanning', built;
  END IF;

  RAISE NOTICE 'search indexes in place: % of 7', built;
END $$;
