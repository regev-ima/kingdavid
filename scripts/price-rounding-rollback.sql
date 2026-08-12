-- ============================================================================
-- Undo 20260812000001 — put every catalog price back where it was
-- ============================================================================
-- The migration snapped catalog prices so the customer's price is a round
-- shekel, and wrote every value it touched into price_rounding_backup first.
-- This reads that table and restores them. It is the reason running the
-- migration on live pricing is a decision that can be taken back.
--
-- It restores ONLY what the migration itself changed: rows are matched by id
-- and column, and a price edited by hand since then is overwritten back to the
-- pre-migration figure like any other. Run it soon after, or not at all.
--
-- Safe to run twice: the second pass writes the same values again and the
-- assertion at the end still passes.
--
-- After a successful rollback the backup rows are left in place on purpose —
-- they are the record of what happened. Delete them yourself once the dust has
-- settled:
--     DELETE FROM public.price_rounding_backup;
-- ============================================================================

BEGIN;

-- ── product_variations ──────────────────────────────────────────────────────
-- final_price is derived, so it is recomputed from the restored base rather
-- than restored on its own — the same way the app derives it.

UPDATE public.product_variations v
SET base_price  = b.old_value,
    final_price = round(b.old_value * (1 - coalesce(v.discount_percent, 0) / 100.0), 2)
FROM public.price_rounding_backup b
WHERE b.table_name = 'product_variations'
  AND b.column_name = 'base_price'
  AND b.row_id = v.id
  AND b.old_value IS NOT NULL;


-- ── product_addons ──────────────────────────────────────────────────────────

UPDATE public.product_addons a
SET base_price  = b.old_value,
    final_price = CASE WHEN a.final_price IS NULL THEN NULL ELSE b.old_value END
FROM public.price_rounding_backup b
WHERE b.table_name = 'product_addons'
  AND b.column_name = 'base_price'
  AND b.row_id = a.id
  AND b.old_value IS NOT NULL;


-- ── product_addons.size_prices ──────────────────────────────────────────────

UPDATE public.product_addons a
SET size_prices = b.old_json
FROM public.price_rounding_backup b
WHERE b.table_name = 'product_addons'
  AND b.column_name = 'size_prices'
  AND b.row_id = a.id
  AND b.old_json IS NOT NULL;


-- ── product_addon_prices ────────────────────────────────────────────────────

UPDATE public.product_addon_prices p
SET price = b.old_value
FROM public.price_rounding_backup b
WHERE b.table_name = 'product_addon_prices'
  AND b.column_name = 'price'
  AND b.row_id = p.id
  AND b.old_value IS NOT NULL;


-- ── product_size_prices ─────────────────────────────────────────────────────

UPDATE public.product_size_prices p
SET price = b.old_value
FROM public.price_rounding_backup b
WHERE b.table_name = 'product_size_prices'
  AND b.column_name = 'price'
  AND b.row_id = p.id
  AND b.old_value IS NOT NULL;


-- ── Prove it landed ─────────────────────────────────────────────────────────
-- Every backed-up price must now equal its recorded old value again. A row
-- that doesn't means the restore missed it, and the transaction is discarded
-- rather than leaving pricing half-restored.

DO $$
DECLARE stragglers int;
BEGIN
  SELECT count(*) INTO stragglers
  FROM public.price_rounding_backup b
  WHERE b.old_value IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.product_variations   v WHERE b.table_name = 'product_variations'   AND v.id = b.row_id AND v.base_price = b.old_value
      UNION ALL
      SELECT 1 FROM public.product_addons       a WHERE b.table_name = 'product_addons'       AND a.id = b.row_id AND a.base_price = b.old_value
      UNION ALL
      SELECT 1 FROM public.product_addon_prices p WHERE b.table_name = 'product_addon_prices' AND p.id = b.row_id AND p.price = b.old_value
      UNION ALL
      SELECT 1 FROM public.product_size_prices  s WHERE b.table_name = 'product_size_prices'  AND s.id = b.row_id AND s.price = b.old_value
    );

  IF stragglers > 0 THEN
    RAISE EXCEPTION '% backed-up prices did not restore — rolling back the rollback', stragglers;
  END IF;

  RAISE NOTICE 'catalog prices restored from backup';
END $$;

COMMIT;
