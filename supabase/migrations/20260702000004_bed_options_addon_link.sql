-- Bed configurator ↔ existing add-ons: unify pricing on one source of truth.
--
-- The quote flow already turns "תוספות למוצר" (product_addons) into separate
-- priced lines under the bed. The bed configurator adds STRUCTURE on top of that
-- (grouped single-choice questions, dependencies, images) — but the PRICE of a
-- choice should come from the real add-on, not a second hand-typed number.
--
-- So a bed_option_values row may now point at a product_addons row: when linked,
-- the wizard reads the add-on's resolved price (variation/product/size/base) and
-- the resulting quote line references that add-on. Pure choices with no real
-- product (בלי ארגז, צבע רגל) keep their own flat `price` and stay unlinked.

BEGIN;

ALTER TABLE public.bed_option_values
  ADD COLUMN IF NOT EXISTS addon_id uuid REFERENCES public.product_addons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bed_option_values_addon_idx ON public.bed_option_values (addon_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
