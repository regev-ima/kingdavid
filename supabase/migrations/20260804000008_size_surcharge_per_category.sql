-- A surcharge per size, per product category.
--
-- global_sizes.size_surcharge holds ONE amount per size, and the seeded numbers
-- are the mattress ones (from the showroom card). A bed in the same 160/200
-- doesn't cost the same upcharge as a mattress in 160/200 — the surcharge
-- belongs to the pair (size, category), not to the size alone.
--
-- WHY A JSONB MAP AND NOT ROWS PER CATEGORY
-- Duplicating each size once per category would have broken things that read
-- the catalog as "one row per size": the size picker in the quote flow would
-- list 160/200 four times, and product_size_prices points at a single
-- global_size_id. One row per size, with the amounts hanging off it, keeps
-- every existing screen exactly as it is.
--
--   surcharges = {"mattress": 490, "bed": 700}
--
-- Reading order stays: a per-product price (product_size_prices) wins, then
-- this map for the product's category, then size_surcharge as the default for a
-- category nobody has filled in, then 0.
--
-- The backfill moves what is already there into "mattress", which is what those
-- numbers have always meant. size_surcharge is left in place as the fallback
-- rather than dropped — nothing has to be migrated in one shot, and an
-- unfilled category still prices like it does today.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only touches rows
-- whose map has no "mattress" key yet.

ALTER TABLE public.global_sizes
  ADD COLUMN IF NOT EXISTS surcharges jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.global_sizes
   SET surcharges = jsonb_build_object('mattress', size_surcharge)
 WHERE size_surcharge IS NOT NULL
   AND size_surcharge <> 0
   AND NOT (surcharges ? 'mattress');

NOTIFY pgrst, 'reload schema';
