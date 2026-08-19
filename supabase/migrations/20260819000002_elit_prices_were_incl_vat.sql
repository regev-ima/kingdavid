-- עלית: the catalogue prices were entered into the WRONG field.
--
-- The 2025 catalogue quotes עלית at ₪5,900 (140/190) — a price INCLUDING VAT.
-- It was typed into the pre-VAT field, so the app added 18% on top and quoted
-- the customer ₪6,962. Same for all eight sizes.
--
-- The fix divides each size's stored pre-VAT price by 1.18, so the
-- including-VAT price the customer sees becomes exactly the catalogue number
-- that was typed. Scoped to the eight ELT SKUs BY EXPLICIT old→new pairs:
-- a row is only touched while it still holds the wrong value, which makes the
-- migration idempotent (a second run matches nothing) and inert if a price
-- was already corrected by hand.
--
-- Quotes and orders already written are historical documents and are not
-- touched. Only this product's catalogue prices change.

BEGIN;

WITH fix (sku, old_final, new_price) AS (
  VALUES
    ('ELT140190', 5900.00, 5000.00),
    ('ELT140200', 6290.00, 5330.51),
    ('ELT150190', 6290.00, 5330.51),
    ('ELT150200', 6390.00, 5415.25),
    ('ELT160190', 6390.00, 5415.25),
    ('ELT160200', 6390.00, 5415.25),
    ('ELT180200', 6890.00, 5838.98),
    ('ELT200200', 7190.00, 6093.22)
)
UPDATE public.product_variations v
SET base_price  = round(v.base_price / 1.18, 2),
    final_price = f.new_price
FROM fix f
WHERE v.sku = f.sku
  AND round(v.final_price::numeric, 2) = f.old_final;

NOTIFY pgrst, 'reload schema';

COMMIT;
