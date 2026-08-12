-- ============================================================================
-- Snap catalog prices so the CUSTOMER's price is a round shekel
-- ============================================================================
-- Catalog prices are stored PRE-VAT and the customer's price is ×1.18, so a
-- round ₪6,390 in the table billed ₪7,540.20 — twenty agorot nobody chose. The
-- product screens hid them behind a whole-shekel Math.round, so the catalog
-- said ₪7,540 while the order said otherwise.
--
-- The forms now take the customer's price and derive the stored one. This does
-- the same to the rows that were already there:
--
--     new_incl  = floor(round(price × 1.18, 2))   -- always DOWN
--     new_price = round(new_incl / 1.18, 2)
--
-- The inner round() is not decoration. 6,389.83 × 1.18 is 7,539.9994, and
-- flooring THAT returns 7,539 — so a second run would walk every price down
-- another shekel, and a third another. Rounding to agorot first makes the
-- second run match no rows at all, which is what the --twice rehearsal checks.
--
-- DOWN, not nearest: no price may rise because of a rounding decision. The most
-- any can fall is 99 agorot, and the report at the end states the exact total.
--
-- ── WHAT IT DOES NOT TOUCH, AND WHY ────────────────────────────────────────
-- The schema has three different conventions living in identical `numeric`
-- columns, and getting this list wrong corrupts money:
--
--   • bed_option_values.price   — ALREADY VAT-inclusive (see src/lib/bedConfig
--                                 .js, BED_VAT_RATE). Dividing it would cut
--                                 every bed-configurator choice by 15%.
--   • extra_charges.cost        — ALREADY VAT-inclusive (see lib/quoteTotals).
--   • product_variations.cost   — the internal COST of the item, not a price to
--                                 anybody. It sits beside base_price and looks
--                                 identical in the schema.
--   • product_sizes.price       — table is empty; a leftover.
--
-- ── REVERSIBLE ─────────────────────────────────────────────────────────────
-- Every value it changes is written to price_rounding_backup first, with the
-- row id and column it came from. scripts/price-rounding-rollback.sql puts them
-- all back. That is what makes running this on live pricing acceptable.
--
-- Idempotent: after the first pass floor(round(p × 1.18, 2)) already equals
-- round(p × 1.18, 2), so a second run matches no rows and backs nothing up.
-- Verified with scripts/local-test-db.sh --twice.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.price_rounding_backup (
  id           bigserial PRIMARY KEY,
  table_name   text        NOT NULL,
  row_id       uuid        NOT NULL,
  column_name  text        NOT NULL,
  old_value    numeric,
  new_value    numeric,
  -- size_prices is jsonb, and a numeric column cannot hold it. Without these
  -- the rollback would have to reconstruct the array by arithmetic, which is
  -- a guess dressed as a restore.
  old_json     jsonb,
  new_json     jsonb,
  applied_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.price_rounding_backup IS
  $c$Every catalog price changed by 20260812000001, so the change can be undone. Restore with scripts/price-rounding-rollback.sql.$c$;

CREATE INDEX IF NOT EXISTS price_rounding_backup_row_idx
  ON public.price_rounding_backup (table_name, row_id);


-- ── product_variations ──────────────────────────────────────────────────────
-- base_price is the typed price; final_price is what documents read, and the
-- app derives it as base × (1 − discount). Both move together so a later save
-- from the product screen doesn't undo this.

WITH target AS (
  SELECT id, base_price,
         round(floor(round(base_price * 1.18, 2)) / 1.18, 2) AS new_base
  FROM public.product_variations
  WHERE base_price > 0
    AND floor(round(base_price * 1.18, 2)) <> round(base_price * 1.18, 2)
), saved AS (
  INSERT INTO public.price_rounding_backup (table_name, row_id, column_name, old_value, new_value)
  SELECT 'product_variations', id, 'base_price', base_price, new_base FROM target
  RETURNING row_id
)
UPDATE public.product_variations v
SET base_price  = t.new_base,
    -- Recomputed the way the client does, so a variation-level discount keeps
    -- meaning what it meant. Agorot produced by a percentage discount are
    -- expected and stay.
    final_price = round(t.new_base * (1 - coalesce(v.discount_percent, 0) / 100.0), 2)
FROM target t
WHERE v.id = t.id;


-- ── product_addons ──────────────────────────────────────────────────────────

WITH target AS (
  SELECT id, base_price,
         round(floor(round(base_price * 1.18, 2)) / 1.18, 2) AS new_base
  FROM public.product_addons
  WHERE base_price > 0
    AND floor(round(base_price * 1.18, 2)) <> round(base_price * 1.18, 2)
), saved AS (
  INSERT INTO public.price_rounding_backup (table_name, row_id, column_name, old_value, new_value)
  SELECT 'product_addons', id, 'base_price', base_price, new_base FROM target
  RETURNING row_id
)
UPDATE public.product_addons a
SET base_price  = t.new_base,
    final_price = CASE WHEN a.final_price IS NULL THEN NULL ELSE t.new_base END
FROM target t
WHERE a.id = t.id;


-- ── product_addons.size_prices (jsonb array of {width_cm,length_cm,price}) ──
-- Snapped element by element, and the whole array — before and after — is kept
-- in the backup's jsonb columns, so restoring it is a copy rather than a
-- reconstruction.

WITH exploded AS (
  SELECT a.id,
         jsonb_agg(
           CASE
             WHEN (elem->>'price') ~ '^[0-9.]+$' AND (elem->>'price')::numeric > 0
               THEN jsonb_set(elem, '{price}',
                      to_jsonb(round(floor(round((elem->>'price')::numeric * 1.18, 2)) / 1.18, 2)))
             ELSE elem
           END
           ORDER BY ord
         ) AS new_sizes
  FROM public.product_addons a
       CROSS JOIN LATERAL jsonb_array_elements(a.size_prices) WITH ORDINALITY AS e(elem, ord)
  WHERE jsonb_typeof(a.size_prices) = 'array'
    AND jsonb_array_length(a.size_prices) > 0
  GROUP BY a.id
), changed AS (
  SELECT e.id, e.new_sizes
  FROM exploded e
       JOIN public.product_addons a ON a.id = e.id
  WHERE a.size_prices IS DISTINCT FROM e.new_sizes
), saved AS (
  INSERT INTO public.price_rounding_backup (table_name, row_id, column_name, old_json, new_json)
  SELECT 'product_addons', c.id, 'size_prices', a.size_prices, c.new_sizes
  FROM changed c JOIN public.product_addons a ON a.id = c.id
  RETURNING row_id
)
UPDATE public.product_addons a
SET size_prices = c.new_sizes
FROM changed c
WHERE a.id = c.id;


-- ── product_addon_prices ────────────────────────────────────────────────────

WITH target AS (
  SELECT id, price,
         round(floor(round(price * 1.18, 2)) / 1.18, 2) AS new_price
  FROM public.product_addon_prices
  WHERE price > 0
    AND floor(round(price * 1.18, 2)) <> round(price * 1.18, 2)
), saved AS (
  INSERT INTO public.price_rounding_backup (table_name, row_id, column_name, old_value, new_value)
  SELECT 'product_addon_prices', id, 'price', price, new_price FROM target
  RETURNING row_id
)
UPDATE public.product_addon_prices p
SET price = t.new_price
FROM target t
WHERE p.id = t.id;


-- ── product_size_prices ─────────────────────────────────────────────────────

WITH target AS (
  SELECT id, price,
         round(floor(round(price * 1.18, 2)) / 1.18, 2) AS new_price
  FROM public.product_size_prices
  WHERE price > 0
    AND floor(round(price * 1.18, 2)) <> round(price * 1.18, 2)
), saved AS (
  INSERT INTO public.price_rounding_backup (table_name, row_id, column_name, old_value, new_value)
  SELECT 'product_size_prices', id, 'price', price, new_price FROM target
  RETURNING row_id
)
UPDATE public.product_size_prices p
SET price = t.new_price
FROM target t
WHERE p.id = t.id;


-- ── The report, and the safety assertion ────────────────────────────────────
-- No price may have risen. If one did, the arithmetic above is wrong and the
-- whole transaction is thrown away rather than left half-applied.

DO $$
DECLARE
  rows_changed  int;
  given_up      numeric;
  worst_rise    numeric;
BEGIN
  SELECT count(*),
         coalesce(round(sum((old_value - new_value) * 1.18), 2), 0),
         coalesce(round(max((new_value - old_value) * 1.18), 2), 0)
    INTO rows_changed, given_up, worst_rise
  FROM public.price_rounding_backup
  WHERE old_value IS NOT NULL
    AND applied_at > now() - interval '1 minute';

  IF worst_rise > 0 THEN
    RAISE EXCEPTION 'a price went UP by %, rounding was supposed to be down only — rolling back', worst_rise;
  END IF;

  RAISE NOTICE 'catalog prices snapped: % rows, ₪% given up in total', rows_changed, given_up;
END $$;

COMMIT;
