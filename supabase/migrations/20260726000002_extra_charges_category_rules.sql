-- Delivery extras (תוספות להובלה) become DATA instead of a guess about their name.
--
-- Until now `extra_charges` held only name / description / cost, and the quote
-- screens decided which rows to offer by running regexes over the Hebrew name
-- ("ל-2 מיטות" → exactly two beds, a bare "מיטות" → two or more, …). Two things
-- followed from that:
--   • the bed count itself was taken from products.bed_type, which is the width
--     family (single/double) and is set on MATTRESSES too — so one bed + one
--     mattress counted as two beds and the only delivery option offered was
--     "הובלה ל-2 מיטות" (₪900), while the correct single-bed and single-mattress
--     rows were both hidden;
--   • any row whose name didn't match the expected phrasing was offered always.
--
-- So each row now states its own rule:
--   applies_to_category  bed | mattress | topper | accessory | any
--   min_qty / max_qty    the quantity window it prices (max NULL = open ended)
--   hide_from_quote      never offered on a quote/order (crane, per-floor …)
--
-- The backfill below derives those from the existing names — the same reading
-- the client used to do at render time — so behaviour is preserved for rows that
-- were already phrased correctly, and from here on the owner edits the rule in
-- the "תוספות להזמנות" screen instead of encoding it in the name.

BEGIN;

ALTER TABLE public.extra_charges
  ADD COLUMN IF NOT EXISTS applies_to_category text,
  ADD COLUMN IF NOT EXISTS min_qty integer,
  ADD COLUMN IF NOT EXISTS max_qty integer,
  ADD COLUMN IF NOT EXISTS hide_from_quote boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extra_charges_applies_to_category_check'
  ) THEN
    ALTER TABLE public.extra_charges
      ADD CONSTRAINT extra_charges_applies_to_category_check
      CHECK (applies_to_category IS NULL
             OR applies_to_category IN ('any', 'bed', 'mattress', 'topper', 'accessory'));
  END IF;
END $$;

COMMENT ON COLUMN public.extra_charges.applies_to_category IS
  'Product category this charge is priced for (bed/mattress/topper/accessory), or any/NULL for a charge that is not category-specific.';
COMMENT ON COLUMN public.extra_charges.min_qty IS
  'Smallest quantity of applies_to_category items this charge covers (default 1).';
COMMENT ON COLUMN public.extra_charges.max_qty IS
  'Largest quantity this charge covers; NULL = no upper bound.';
COMMENT ON COLUMN public.extra_charges.hide_from_quote IS
  'Never offer this charge when building a quote/order (priced on site by the shipper, per-floor, …).';

-- ── Backfill ────────────────────────────────────────────────────
-- 1. Rows the quote screens used to filter out by name, unconditionally.
UPDATE public.extra_charges
SET hide_from_quote = true
WHERE name = 'שירותי מנוף'
   OR name LIKE '%מחויב במנוף%'
   OR name LIKE '%כל מיטה החל מקומה%';

-- 2. Explicit quantity in the name: "הובלה ל-2 מיטות", "הובלה ל 3 מזרנים".
UPDATE public.extra_charges SET
  applies_to_category = 'bed',
  min_qty = (regexp_match(name, 'ל[- ]?(\d+)\s*מיטות'))[1]::int,
  max_qty = (regexp_match(name, 'ל[- ]?(\d+)\s*מיטות'))[1]::int
WHERE applies_to_category IS NULL AND NOT hide_from_quote
  AND name ~ 'ל[- ]?\d+\s*מיטות';

UPDATE public.extra_charges SET
  applies_to_category = 'mattress',
  min_qty = (regexp_match(name, 'ל[- ]?(\d+)\s*מזרנים'))[1]::int,
  max_qty = (regexp_match(name, 'ל[- ]?(\d+)\s*מזרנים'))[1]::int
WHERE applies_to_category IS NULL AND NOT hide_from_quote
  AND name ~ 'ל[- ]?\d+\s*מזרנים';

UPDATE public.extra_charges SET
  applies_to_category = 'topper',
  min_qty = (regexp_match(name, 'ל[- ]?(\d+)\s*טופרים'))[1]::int,
  max_qty = (regexp_match(name, 'ל[- ]?(\d+)\s*טופרים'))[1]::int
WHERE applies_to_category IS NULL AND NOT hide_from_quote
  AND name ~ 'ל[- ]?\d+\s*טופרים';

-- 3. Bare plural → two or more.
UPDATE public.extra_charges SET applies_to_category = 'bed', min_qty = 2, max_qty = NULL
WHERE applies_to_category IS NULL AND NOT hide_from_quote AND name LIKE '%מיטות%';

UPDATE public.extra_charges SET applies_to_category = 'mattress', min_qty = 2, max_qty = NULL
WHERE applies_to_category IS NULL AND NOT hide_from_quote AND name LIKE '%מזרנים%';

UPDATE public.extra_charges SET applies_to_category = 'topper', min_qty = 2, max_qty = NULL
WHERE applies_to_category IS NULL AND NOT hide_from_quote AND name LIKE '%טופרים%';

-- 4. Singular → exactly one. ('מיטה' / 'מזרן' end in a final letter, so they
--    cannot match the plurals handled above; 'טופר' can, which is why the
--    plural passes run first.)
UPDATE public.extra_charges SET applies_to_category = 'bed', min_qty = 1, max_qty = 1
WHERE applies_to_category IS NULL AND NOT hide_from_quote
  AND (name LIKE '%מיטה%' OR name LIKE '%מיטת%');

UPDATE public.extra_charges SET applies_to_category = 'mattress', min_qty = 1, max_qty = 1
WHERE applies_to_category IS NULL AND NOT hide_from_quote AND name LIKE '%מזרן%';

UPDATE public.extra_charges SET applies_to_category = 'topper', min_qty = 1, max_qty = 1
WHERE applies_to_category IS NULL AND NOT hide_from_quote AND name LIKE '%טופר%';

-- 5. Everything else is not category-specific (floors, elevator, assembly …)
--    and stays offered on every quote — same as the old `return true` default.
UPDATE public.extra_charges SET applies_to_category = 'any', min_qty = 1, max_qty = NULL
WHERE applies_to_category IS NULL AND NOT hide_from_quote;

NOTIFY pgrst, 'reload schema';

COMMIT;
