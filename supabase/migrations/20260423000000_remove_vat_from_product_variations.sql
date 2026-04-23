-- Fix product pricing: base_price / final_price were uploaded inclusive of VAT,
-- but the app treats them as "before VAT" and multiplies by 1.18 for display.
-- Divide both columns by 1.18 (18% Israeli VAT) and round to the nearest shekel
-- so the "including VAT" display column reproduces the original uploaded price.
--
-- Scope: product_variations only. Addons (product_addons, product_addon_prices)
-- are intentionally excluded.
--
-- This migration is idempotent-unsafe: running it twice will divide by 1.18^2.
-- Do NOT rerun without verifying prices first.

BEGIN;

UPDATE product_variations
SET base_price = ROUND(base_price / 1.18)
WHERE base_price IS NOT NULL AND base_price > 0;

UPDATE product_variations
SET final_price = ROUND(final_price / 1.18)
WHERE final_price IS NOT NULL AND final_price > 0;

COMMIT;
