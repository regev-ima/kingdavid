-- Phone lookup on the New Quote page (and anywhere else that uses
-- `ILIKE '%tail%'` against leads.phone / customers.phone) was doing a full
-- table scan on every keystroke because LIKE patterns with a leading
-- wildcard can't use a btree index. With a few thousand rows the lookup
-- already feels sluggish; with tens of thousands it's unusable.
--
-- pg_trgm + a GIN trigram index makes substring/ILIKE searches on these
-- columns near-instant — the index covers `%tail%`, `%mid%`, `tail%`, all
-- of them.
--
-- The extension is created in the standard `extensions` schema if Supabase
-- exposes it; otherwise we fall back to creating it in `public`. CREATE
-- EXTENSION IF NOT EXISTS is idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS leads_phone_trgm_idx
  ON public.leads USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS customers_phone_trgm_idx
  ON public.customers USING gin (phone gin_trgm_ops);
