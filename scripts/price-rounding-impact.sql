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
-- most any can fall is 99 agorot. Every impact query below returns
-- `biggest_rise`, which must come back 0.00. It proves the rule rather than
-- promising it.
--
-- extra_charges (הובלה/הרכבה) is deliberately absent: those are already stored
-- VAT-inclusive, so they ARE the customer's price and dividing them would be
-- wrong.
--
-- READ-ONLY. There is no UPDATE, INSERT or DELETE in this file.
--
-- HOW TO RUN: query 0 first, then only the impact queries whose table and
-- column it actually listed. Each is independent — one that errors with
-- "column does not exist" just means that table isn't priced the way the
-- client code suggested, and the rest still run. The column names here were
-- read out of the app, not out of the database, because the product tables
-- came from base44 and no migration in this repo defines them.
-- ============================================================================


-- ── 0. Which tables and price columns actually exist? ───────────────────────
-- Run this FIRST and paste the result. Everything below is written against a
-- guess; this is the only query here that cannot be wrong.

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name LIKE '%price%' OR column_name IN ('cost', 'price_delta'))
  AND table_name NOT IN ('orders', 'quotes', 'order_items', 'quote_items')
ORDER BY table_name, column_name;


-- ── 1. product_variations — the main one ────────────────────────────────────
-- `rows_that_change` is how many prices the migration would rewrite.
-- `biggest_drop` is the largest fall in a customer's price, in shekels.
-- `biggest_rise` MUST be 0.00. Anything positive: stop and tell me.

SELECT count(*)                                                        AS priced_rows,
       count(*) FILTER (WHERE floor(round(base_price * 1.18, 2)) <> round(base_price * 1.18, 2))
                                                                       AS rows_that_change,
       round(min(floor(round(base_price * 1.18, 2)) - round(base_price * 1.18, 2)), 2) AS biggest_drop,
       round(max(floor(round(base_price * 1.18, 2)) - round(base_price * 1.18, 2)), 2) AS biggest_rise,
       round(sum(round(base_price * 1.18, 2) - floor(round(base_price * 1.18, 2))), 2) AS total_shekels_given_up
FROM public.product_variations
WHERE base_price > 0;


-- ── 2. The 20 biggest changes, so the numbers have names on them ────────────

SELECT v.sku,
       p.name                                       AS product,
       v.base_price                                 AS stored_now,
       round(v.base_price * 1.18, 2)                AS customer_pays_now,
       floor(round(v.base_price * 1.18, 2))                   AS customer_would_pay,
       round(floor(round(v.base_price * 1.18, 2)) / 1.18, 2)  AS stored_after,
       round(floor(round(v.base_price * 1.18, 2)) - round(v.base_price * 1.18, 2), 2) AS change
FROM public.product_variations v
LEFT JOIN public.products p ON p.id = v.product_id
WHERE v.base_price > 0
  AND floor(round(v.base_price * 1.18, 2)) <> round(v.base_price * 1.18, 2)
ORDER BY change ASC
LIMIT 20;


-- ── 3. Do any sizes carry their own discount? ───────────────────────────────
-- A variation-level discount_percent locks base_price to final_price, so the
-- migration has to recompute final_price rather than snap it. Agorot produced
-- by a percentage discount are expected and stay — this only decides whether
-- the migration needs that second step.

SELECT count(*) FILTER (WHERE coalesce(discount_percent, 0) > 0)       AS with_discount,
       count(*) FILTER (WHERE coalesce(discount_percent, 0) = 0)       AS without_discount,
       count(*) FILTER (WHERE final_price IS DISTINCT FROM base_price
                          AND coalesce(discount_percent, 0) = 0)       AS mismatched_no_discount
FROM public.product_variations
WHERE base_price > 0;


-- ── 4. product_addons ───────────────────────────────────────────────────────

SELECT count(*)                                                        AS priced_rows,
       count(*) FILTER (WHERE floor(round(base_price * 1.18, 2)) <> round(base_price * 1.18, 2))
                                                                       AS rows_that_change,
       round(min(floor(round(base_price * 1.18, 2)) - round(base_price * 1.18, 2)), 2) AS biggest_drop,
       round(max(floor(round(base_price * 1.18, 2)) - round(base_price * 1.18, 2)), 2) AS biggest_rise
FROM public.product_addons
WHERE base_price > 0;


-- ── 5. product_addon_prices ─────────────────────────────────────────────────

SELECT count(*)                                                        AS priced_rows,
       count(*) FILTER (WHERE floor(round(price * 1.18, 2)) <> round(price * 1.18, 2))
                                                                       AS rows_that_change,
       round(min(floor(round(price * 1.18, 2)) - round(price * 1.18, 2)), 2)     AS biggest_drop,
       round(max(floor(round(price * 1.18, 2)) - round(price * 1.18, 2)), 2)     AS biggest_rise
FROM public.product_addon_prices
WHERE price > 0;


-- ── 6. product_size_prices ──────────────────────────────────────────────────

SELECT count(*)                                                        AS priced_rows,
       count(*) FILTER (WHERE floor(round(price * 1.18, 2)) <> round(price * 1.18, 2))
                                                                       AS rows_that_change,
       round(min(floor(round(price * 1.18, 2)) - round(price * 1.18, 2)), 2)     AS biggest_drop,
       round(max(floor(round(price * 1.18, 2)) - round(price * 1.18, 2)), 2)     AS biggest_rise
FROM public.product_size_prices
WHERE price > 0;
