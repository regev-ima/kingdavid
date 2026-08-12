-- ============================================================================
-- What would happen if catalog prices were snapped to a round customer price?
-- ============================================================================
-- Catalog prices are stored PRE-VAT and the customer's price is derived as
-- ×1.18, so a round ₪6,390 in the table bills the customer ₪7,540.20. The
-- product screen hid those twenty agorot behind a whole-shekel Math.round, so
-- the catalog said ₪7,540 while the order said ₪7,540.20.
--
-- The fix inverts the direction: the round number is the CUSTOMER's price, and
-- the stored pre-VAT figure is derived from it (₪7,540 ÷ 1.18 = ₪6,389.83).
-- Doing that to existing rows means rewriting prices, which is why this script
-- exists first.
--
-- Rounding is DOWN — floor() on the customer's price. No price can rise; the
-- most any can fall is 99 agorot. Query 2 proves it rather than promising it:
-- `biggest_rise` must come back 0.00 or null on every table.
--
-- extra_charges (הובלה/הרכבה) is deliberately absent: those are already stored
-- VAT-inclusive, so they are the customer's price already and dividing them
-- would be wrong.
--
-- READ-ONLY. There is no UPDATE, INSERT or DELETE in this file. Run it in the
-- Supabase SQL editor, one query at a time, and paste the results back.
-- ============================================================================


-- ── 0. Which of these tables and price columns actually exist? ───────────────
-- Run this FIRST. The product tables came from base44 and are not created by a
-- migration in this repo, so the column names below are what the client code
-- reads — not something anyone has verified against the database. Whatever
-- this query does NOT return, skip in the queries that follow.

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
        'product_variations', 'products', 'product_addons',
        'product_addon_prices', 'product_size_prices', 'extra_charges')
  AND column_name IN ('base_price', 'final_price', 'price', 'cost', 'price_delta')
ORDER BY table_name, column_name;


-- ── 1. Scale: how many priced rows are there at all? ────────────────────────

SELECT 'product_variations' AS table_name, count(*) AS priced_rows FROM public.product_variations WHERE base_price > 0
UNION ALL SELECT 'products',             count(*) FROM public.products             WHERE base_price > 0
UNION ALL SELECT 'product_addons',       count(*) FROM public.product_addons       WHERE base_price > 0
UNION ALL SELECT 'product_addon_prices', count(*) FROM public.product_addon_prices WHERE price > 0
UNION ALL SELECT 'product_size_prices',  count(*) FROM public.product_size_prices  WHERE price > 0
ORDER BY 1;


-- ── 2. The impact, per table ────────────────────────────────────────────────
-- `rows_that_change` is how many prices the migration would rewrite.
-- `biggest_drop` is the largest fall in a customer's price, in shekels.
-- `biggest_rise` MUST be 0.00 — if any table reports a positive number here,
-- do not run the migration and tell me.

WITH v AS (
  SELECT base_price AS p, round(base_price * 1.18, 2) AS incl_now,
         floor(base_price * 1.18) AS incl_new
  FROM public.product_variations WHERE base_price > 0
), pr AS (
  SELECT base_price AS p, round(base_price * 1.18, 2), floor(base_price * 1.18)
  FROM public.products WHERE base_price > 0
), ad AS (
  SELECT base_price AS p, round(base_price * 1.18, 2), floor(base_price * 1.18)
  FROM public.product_addons WHERE base_price > 0
), ap AS (
  SELECT price AS p, round(price * 1.18, 2), floor(price * 1.18)
  FROM public.product_addon_prices WHERE price > 0
), sp AS (
  SELECT price AS p, round(price * 1.18, 2), floor(price * 1.18)
  FROM public.product_size_prices WHERE price > 0
), all_rows AS (
  SELECT 'product_variations' AS table_name, * FROM v
  UNION ALL SELECT 'products',             * FROM pr
  UNION ALL SELECT 'product_addons',       * FROM ad
  UNION ALL SELECT 'product_addon_prices', * FROM ap
  UNION ALL SELECT 'product_size_prices',  * FROM sp
)
SELECT table_name,
       count(*)                                                   AS priced_rows,
       count(*) FILTER (WHERE incl_new <> incl_now)                AS rows_that_change,
       round(min(incl_new - incl_now), 2)                          AS biggest_drop,
       round(max(incl_new - incl_now), 2)                          AS biggest_rise,
       round(sum(incl_now - incl_new), 2)                          AS total_shekels_given_up
FROM all_rows
GROUP BY table_name
ORDER BY table_name;


-- ── 3. The 20 biggest changes, so the numbers have names on them ────────────

SELECT v.sku,
       p.name                                AS product,
       v.base_price                          AS stored_now,
       round(v.base_price * 1.18, 2)         AS customer_pays_now,
       floor(v.base_price * 1.18)            AS customer_would_pay,
       round(floor(v.base_price * 1.18) / 1.18, 2) AS stored_after,
       round(floor(v.base_price * 1.18) - round(v.base_price * 1.18, 2), 2) AS change
FROM public.product_variations v
LEFT JOIN public.products p ON p.id = v.product_id
WHERE v.base_price > 0
  AND floor(v.base_price * 1.18) <> round(v.base_price * 1.18, 2)
ORDER BY change ASC
LIMIT 20;


-- ── 4. Do any sizes carry their own discount? ───────────────────────────────
-- A variation-level discount_percent locks base_price to final_price, so the
-- migration has to recompute final_price rather than snap it. Agorot produced
-- by a percentage discount are expected and stay — this is only about knowing
-- how many rows need that second step.

SELECT count(*) FILTER (WHERE coalesce(discount_percent, 0) > 0) AS with_discount,
       count(*) FILTER (WHERE coalesce(discount_percent, 0) = 0) AS without_discount,
       count(*) FILTER (WHERE final_price IS DISTINCT FROM base_price
                          AND coalesce(discount_percent, 0) = 0)  AS mismatched_no_discount
FROM public.product_variations
WHERE base_price > 0;
