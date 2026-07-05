-- Fix mattress sizes where width/length were entered swapped, so width_cm is
-- always the smaller (left / "רוחב") and length_cm the larger (right / "אורך").
-- A mattress is never wider than it is long, so swapping every mattress variation
-- with width_cm > length_cm is safe and idempotent (re-running changes nothing).
-- Scoped to mattress products. (SQL evaluates the RHS with the OLD row values,
-- so the two-column SET performs a true swap.)

BEGIN;

UPDATE public.product_variations v
   SET width_cm  = v.length_cm,
       length_cm = v.width_cm
  FROM public.products p
 WHERE v.product_id = p.id
   AND p.category = 'mattress'
   AND v.width_cm IS NOT NULL
   AND v.length_cm IS NOT NULL
   AND v.width_cm > v.length_cm;

COMMIT;
