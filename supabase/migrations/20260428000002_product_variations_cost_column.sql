-- The variation form on /ProductsNew has a "עלות ייצור" input that the
-- frontend sends as `cost` to ProductVariation.create. The column never
-- existed on the table, so PostgREST rejected every save with
--   PGRST204: Could not find the 'cost' column of 'product_variations'
-- and the user reported "יצירת וריאציה נכשלה".
--
-- Cost is stored per variation (not per product) because different sizes
-- have different production costs. Allow null — older rows stay untouched
-- and the form leaves the field optional.

ALTER TABLE public.product_variations
  ADD COLUMN IF NOT EXISTS cost numeric(10,2);

COMMENT ON COLUMN public.product_variations.cost IS
  'Manufacturing/acquisition cost per unit, in shekels. Used to compute margins. Optional — nullable for variations without a known cost.';

-- Refresh the PostgREST schema cache so the new column is visible to the
-- API immediately, without waiting for the periodic auto-refresh.
NOTIFY pgrst, 'reload schema';
