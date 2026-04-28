-- ProductsNew.jsx → createVariationMutation ships a payload with
--   product_id, sku, length_cm, width_cm, height_cm, base_price,
--   discount_percent, final_price, stock_quantity, min_stock_threshold,
--   cost, is_active
-- but several environments are missing some of those columns (the seeds
-- INSERT into them but no CREATE/ALTER ever defined them in this repo
-- — they were originally added through the Supabase web UI). We've
-- already had two PGRST204 reports for this table:
--   #80 added `cost`
--   the next save then surfaced a missing `discount_percent`
-- and there's a real risk more columns are missing too.
--
-- This migration adds every variation-form column the frontend expects,
-- guarded by IF NOT EXISTS so it's safe to run anywhere — environments
-- that already have a column are unaffected. Defaults match what
-- ProductsNew.jsx assumes on read.
--
-- After running: NOTIFY pgrst, 'reload schema' so the API picks up the
-- new columns immediately.

ALTER TABLE public.product_variations
  ADD COLUMN IF NOT EXISTS sku                  text,
  ADD COLUMN IF NOT EXISTS length_cm            numeric(8,2),
  ADD COLUMN IF NOT EXISTS width_cm             numeric(8,2),
  ADD COLUMN IF NOT EXISTS height_cm            numeric(8,2),
  ADD COLUMN IF NOT EXISTS base_price           numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_percent     numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_price          numeric(10,2),
  ADD COLUMN IF NOT EXISTS stock_quantity       integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_threshold  integer,
  ADD COLUMN IF NOT EXISTS cost                 numeric(10,2),
  ADD COLUMN IF NOT EXISTS is_active            boolean DEFAULT true;

-- The frontend treats discount_percent as a number it can compute final_price
-- against, so backfill the default for any pre-existing NULLs that slipped
-- through (e.g. rows inserted before the DEFAULT existed).
UPDATE public.product_variations
   SET discount_percent = 0
 WHERE discount_percent IS NULL;

UPDATE public.product_variations
   SET stock_quantity = 0
 WHERE stock_quantity IS NULL;

UPDATE public.product_variations
   SET is_active = true
 WHERE is_active IS NULL;

NOTIFY pgrst, 'reload schema';
