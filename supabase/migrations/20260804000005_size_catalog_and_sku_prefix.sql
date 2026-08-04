-- Building a product's sizes from the catalog instead of one at a time.
--
-- How this business actually prices a mattress (it's printed on the showroom
-- card): one base price for the product's base size — 140/190 on a double,
-- 80/190 on a single — and a fixed surcharge per larger size that is the same
-- across every double mattress: +₪390 for 140/200, +₪490 for 160/200, +₪1,290
-- for 200/200. A product is therefore one price plus a shared table, not a list
-- of independently priced sizes, and a rep should be able to tick the sizes a
-- product comes in and have the variations (and their SKUs) fall out.
--
-- WHAT THIS ADDS
--   global_sizes.width_cm / length_cm  — the numbers behind the free-text
--     `dimensions` field. A variation needs real numbers, and a SKU is built
--     from them.
--   global_sizes.size_surcharge        — the "תוספת" column from the card,
--     relative to the base size (which carries 0).
--   products.sku_prefix                — the 2-3 letters a SKU starts with
--     (EDN120200). Typed once per product; the form suggests it from the name.
--   products.base_size_id              — which catalog size this product's base
--     price is quoted for.
--
-- WHAT THIS DOES NOT TOUCH: `dimensions`, `label`, `price`, and every existing
-- relationship. Nothing reads the new columns until the new screens do, so the
-- catalog behaves exactly as it does today — this is additive, and the app
-- falls back to parsing `dimensions` wherever a width/length is still missing.
--
-- The backfill fills width/length from the text already stored, covering the
-- separators the catalog has collected ("140/190", "140x190", "140X190",
-- "140*190"). Width is the smaller number and length the larger, the same rule
-- migration 20260702000002 enforced on product_variations. A row whose text
-- can't be read stays NULL and is flagged in the sizes screen rather than
-- silently dropped.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only writes rows that
-- are still NULL.

ALTER TABLE public.global_sizes
  ADD COLUMN IF NOT EXISTS width_cm integer,
  ADD COLUMN IF NOT EXISTS length_cm integer,
  ADD COLUMN IF NOT EXISTS size_surcharge numeric NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku_prefix text,
  ADD COLUMN IF NOT EXISTS base_size_id uuid;

-- Backfill width/length from the free text, smaller number first.
WITH parsed AS (
  SELECT
    id,
    (regexp_match(COALESCE(dimensions, label, ''), '(\d{2,3})\s*(?:[xX×*/]|על)\s*(\d{2,3})'))[1]::int AS a,
    (regexp_match(COALESCE(dimensions, label, ''), '(\d{2,3})\s*(?:[xX×*/]|על)\s*(\d{2,3})'))[2]::int AS b
  FROM public.global_sizes
  WHERE width_cm IS NULL OR length_cm IS NULL
)
UPDATE public.global_sizes g
   SET width_cm  = LEAST(parsed.a, parsed.b),
       length_cm = GREATEST(parsed.a, parsed.b)
  FROM parsed
 WHERE g.id = parsed.id
   AND parsed.a IS NOT NULL
   AND parsed.b IS NOT NULL
   AND parsed.a BETWEEN 30 AND 400
   AND parsed.b BETWEEN 30 AND 400;

NOTIFY pgrst, 'reload schema';
