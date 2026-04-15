-- Seed: 23 single-bed products (category='bed', bed_type=['single']) with their size variations.
-- Data source: Excel export provided 2026-04-15.
-- Safety: Single transaction (DO block). Either everything is created or nothing.
-- Re-run protection: if you want to avoid duplicates on re-run, run this ONCE only.

DO $$
DECLARE pid uuid;
BEGIN

-- 1. עדן + בסיס רויאל
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('עדן + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'EDN80190',  80, 190, 2480, 2480, 0, 0, true),
  (pid, 'EDN80200',  80, 200, 2780, 2780, 0, 0, true),
  (pid, 'EDN90190',  90, 190, 2780, 2780, 0, 0, true),
  (pid, 'EDN90200',  90, 200, 2970, 2970, 0, 0, true),
  (pid, 'EDN100190', 100, 190, 2970, 2970, 0, 0, true),
  (pid, 'EDN100200', 100, 200, 2970, 2970, 0, 0, true),
  (pid, 'EDN120190', 120, 190, 3470, 3470, 0, 0, true),
  (pid, 'EDN120200', 120, 200, 3870, 3870, 0, 0, true);

-- 2. קפריס + בסיס רויאל
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('קפריס + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'KPR80190',  80, 190, 2480, 2480, 0, 0, true),
  (pid, 'KPR80200',  80, 200, 2780, 2780, 0, 0, true),
  (pid, 'KPR90190',  90, 190, 2780, 2780, 0, 0, true),
  (pid, 'KPR90200',  90, 200, 2970, 2970, 0, 0, true),
  (pid, 'KPR100190', 100, 190, 2970, 2970, 0, 0, true),
  (pid, 'KPR100200', 100, 200, 2970, 2970, 0, 0, true),
  (pid, 'KPR120190', 120, 190, 3470, 3470, 0, 0, true),
  (pid, 'KPR120200', 120, 200, 3870, 3870, 0, 0, true);

-- 3. KD + בסיס רויאל
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('KD + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'KD80190',  80, 190, 2480, 2480, 0, 0, true),
  (pid, 'KD80200',  80, 200, 2780, 2780, 0, 0, true),
  (pid, 'KD90190',  90, 190, 2780, 2780, 0, 0, true),
  (pid, 'KD90200',  90, 200, 2970, 2970, 0, 0, true),
  (pid, 'KD100190', 100, 190, 2970, 2970, 0, 0, true),
  (pid, 'KD100200', 100, 200, 2970, 2970, 0, 0, true),
  (pid, 'KD120190', 120, 190, 3470, 3470, 0, 0, true),
  (pid, 'KD120200', 120, 200, 3870, 3870, 0, 0, true);

-- 4. יהלום + בסיס רויאל (row 31 had typo: SKU YHL120200 but price matched 120/190 — fixed to YHL120190)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('יהלום + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'YHL80190',  80, 190, 2480, 2480, 0, 0, true),
  (pid, 'YHL80200',  80, 200, 2780, 2780, 0, 0, true),
  (pid, 'YHL90190',  90, 190, 2780, 2780, 0, 0, true),
  (pid, 'YHL90200',  90, 200, 2970, 2970, 0, 0, true),
  (pid, 'YHL100190', 100, 190, 2970, 2970, 0, 0, true),
  (pid, 'YHL100200', 100, 200, 2970, 2970, 0, 0, true),
  (pid, 'YHL120190', 120, 190, 3470, 3470, 0, 0, true),
  (pid, 'YHL120200', 120, 200, 3870, 3870, 0, 0, true);

-- 5. קלאס קפיטונאז' + בסיס רויאל
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('קלאס קפיטונאז'' + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'KLK80190',  80, 190, 2480, 2480, 0, 0, true),
  (pid, 'KLK80200',  80, 200, 2780, 2780, 0, 0, true),
  (pid, 'KLK90190',  90, 190, 2780, 2780, 0, 0, true),
  (pid, 'KLK90200',  90, 200, 2970, 2970, 0, 0, true),
  (pid, 'KLK100190', 100, 190, 2970, 2970, 0, 0, true),
  (pid, 'KLK100200', 100, 200, 2970, 2970, 0, 0, true),
  (pid, 'KLK120190', 120, 190, 3470, 3470, 0, 0, true),
  (pid, 'KLK120200', 120, 200, 3870, 3870, 0, 0, true);

-- 6. קיוב + בסיס רויאל
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('קיוב + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'QUB80190',  80, 190, 2835, 2835, 0, 0, true),
  (pid, 'QUB80200',  80, 200, 3135, 3135, 0, 0, true),
  (pid, 'QUB90190',  90, 190, 3135, 3135, 0, 0, true),
  (pid, 'QUB90200',  90, 200, 3325, 3325, 0, 0, true),
  (pid, 'QUB100190', 100, 190, 3325, 3325, 0, 0, true),
  (pid, 'QUB100200', 100, 200, 3325, 3325, 0, 0, true),
  (pid, 'QUB120190', 120, 190, 3825, 3825, 0, 0, true),
  (pid, 'QUB120200', 120, 200, 4225, 4225, 0, 0, true);

-- 7. ליפס + בסיס רויאל
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('ליפס + בסיס רויאל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'LPS80190',  80, 190, 2835, 2835, 0, 0, true),
  (pid, 'LPS80200',  80, 200, 3135, 3135, 0, 0, true),
  (pid, 'LPS90190',  90, 190, 3135, 3135, 0, 0, true),
  (pid, 'LPS90200',  90, 200, 3325, 3325, 0, 0, true),
  (pid, 'LPS100190', 100, 190, 3325, 3325, 0, 0, true),
  (pid, 'LPS100200', 100, 200, 3325, 3325, 0, 0, true),
  (pid, 'LPS120190', 120, 190, 3825, 3825, 0, 0, true),
  (pid, 'LPS120200', 120, 200, 4225, 4225, 0, 0, true);

-- 8. סיישל (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('סיישל', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'SSH80200',  80, 200, 3135, 3135, 0, 0, true),
  (pid, 'SSH90190',  90, 190, 3135, 3135, 0, 0, true),
  (pid, 'SSH90200',  90, 200, 3325, 3325, 0, 0, true),
  (pid, 'SSH100190', 100, 190, 3325, 3325, 0, 0, true),
  (pid, 'SSH100200', 100, 200, 3325, 3325, 0, 0, true),
  (pid, 'SSH120190', 120, 190, 3825, 3825, 0, 0, true),
  (pid, 'SSH120200', 120, 200, 4225, 4225, 0, 0, true);

-- 9. ארמיטרז' P (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('ארמיטרז'' P', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'AMP80200',  80, 200, 3135, 3135, 0, 0, true),
  (pid, 'AMP90190',  90, 190, 3135, 3135, 0, 0, true),
  (pid, 'AMP90200',  90, 200, 3325, 3325, 0, 0, true),
  (pid, 'AMP100190', 100, 190, 3325, 3325, 0, 0, true),
  (pid, 'AMP100200', 100, 200, 3325, 3325, 0, 0, true),
  (pid, 'AMP120190', 120, 190, 3825, 3825, 0, 0, true),
  (pid, 'AMP120200', 120, 200, 4225, 4225, 0, 0, true);

-- 10. כרמים Q
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('כרמים Q', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'KRQ80190',  80, 190, 3280, 3280, 0, 0, true),
  (pid, 'KRQ80200',  80, 200, 3580, 3580, 0, 0, true),
  (pid, 'KRQ90190',  90, 190, 3580, 3580, 0, 0, true),
  (pid, 'KRQ90200',  90, 200, 3770, 3770, 0, 0, true),
  (pid, 'KRQ100190', 100, 190, 3770, 3770, 0, 0, true),
  (pid, 'KRQ100200', 100, 200, 3770, 3770, 0, 0, true),
  (pid, 'KRQ120190', 120, 190, 4270, 4270, 0, 0, true),
  (pid, 'KRQ120200', 120, 200, 4670, 4670, 0, 0, true);

-- 11. ווינגס
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('ווינגס', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'WNG80190',  80, 190, 3440, 3440, 0, 0, true),
  (pid, 'WNG80200',  80, 200, 3740, 3740, 0, 0, true),
  (pid, 'WNG90190',  90, 190, 3740, 3740, 0, 0, true),
  (pid, 'WNG90200',  90, 200, 3930, 3930, 0, 0, true),
  (pid, 'WNG100190', 100, 190, 3930, 3930, 0, 0, true),
  (pid, 'WNG100200', 100, 200, 3930, 3930, 0, 0, true),
  (pid, 'WNG120190', 120, 190, 4430, 4430, 0, 0, true),
  (pid, 'WNG120200', 120, 200, 4830, 4830, 0, 0, true);

-- 12. טיימס (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('טיימס', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'TMS80200',  80, 200, 3740, 3740, 0, 0, true),
  (pid, 'TMS90190',  90, 190, 3740, 3740, 0, 0, true),
  (pid, 'TMS90200',  90, 200, 3930, 3930, 0, 0, true),
  (pid, 'TMS100190', 100, 190, 3930, 3930, 0, 0, true),
  (pid, 'TMS100200', 100, 200, 3930, 3930, 0, 0, true),
  (pid, 'TMS120190', 120, 190, 4430, 4430, 0, 0, true),
  (pid, 'TMS120200', 120, 200, 4830, 4830, 0, 0, true);

-- 13. קולוני
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('קולוני', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'KLN80190',  80, 190, 3135, 3135, 0, 0, true),
  (pid, 'KLN80200',  80, 200, 3435, 3435, 0, 0, true),
  (pid, 'KLN90190',  90, 190, 3435, 3435, 0, 0, true),
  (pid, 'KLN90200',  90, 200, 3625, 3625, 0, 0, true),
  (pid, 'KLN100190', 100, 190, 3625, 3625, 0, 0, true),
  (pid, 'KLN100200', 100, 200, 3625, 3625, 0, 0, true),
  (pid, 'KLN120190', 120, 190, 4125, 4125, 0, 0, true),
  (pid, 'KLN120200', 120, 200, 4525, 4525, 0, 0, true);

-- 14. דיור
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('דיור', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'DIR80190',  80, 190, 3695, 3695, 0, 0, true),
  (pid, 'DIR80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'DIR90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'DIR90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'DIR100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'DIR100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'DIR120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'DIR120200', 120, 200, 5085, 5085, 0, 0, true);

-- 15. קאלה (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('קאלה', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'KAL80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'KAL90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'KAL90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'KAL100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'KAL100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'KAL120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'KAL120200', 120, 200, 5085, 5085, 0, 0, true);

-- 16. ווג' (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('ווג''', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'VOG80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'VOG90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'VOG90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'VOG100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'VOG100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'VOG120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'VOG120200', 120, 200, 5085, 5085, 0, 0, true);

-- 17. הרמס (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('הרמס', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'HRM80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'HRM90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'HRM90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'HRM100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'HRM100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'HRM120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'HRM120200', 120, 200, 5085, 5085, 0, 0, true);

-- 18. פנדי (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('פנדי', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'FND80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'FND90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'FND90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'FND100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'FND100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'FND120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'FND120200', 120, 200, 5085, 5085, 0, 0, true);

-- 19. איטלי (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('איטלי', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'ITL80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'ITL90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'ITL90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'ITL100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'ITL100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'ITL120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'ITL120200', 120, 200, 5085, 5085, 0, 0, true);

-- 20. ARIA (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('ARIA', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'ARI80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'ARI90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'ARI90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'ARI100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'ARI100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'ARI120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'ARI120200', 120, 200, 5085, 5085, 0, 0, true);

-- 21. ZARA (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('ZARA', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'ZAR80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'ZAR90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'ZAR90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'ZAR100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'ZAR100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'ZAR120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'ZAR120200', 120, 200, 5085, 5085, 0, 0, true);

-- 22. אואזיס (no 80/190 price provided)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('אואזיס', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'OAS80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'OAS90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'OAS90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'OAS100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'OAS100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'OAS120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'OAS120200', 120, 200, 5085, 5085, 0, 0, true);

-- 23. מיטת מתכווננת (יחיד) — named explicitly to differentiate from existing (זוגי)
INSERT INTO products (name, category, bed_type, is_active)
VALUES ('מיטת מתכווננת (יחיד)', 'bed', ARRAY['single'], true)
RETURNING id INTO pid;
INSERT INTO product_variations (product_id, sku, width_cm, length_cm, base_price, final_price, discount_percent, stock_quantity, is_active) VALUES
  (pid, 'MTK80200',  80, 200, 3995, 3995, 0, 0, true),
  (pid, 'MTK90190',  90, 190, 3995, 3995, 0, 0, true),
  (pid, 'MTK90200',  90, 200, 4185, 4185, 0, 0, true),
  (pid, 'MTK100190', 100, 190, 4185, 4185, 0, 0, true),
  (pid, 'MTK100200', 100, 200, 4185, 4185, 0, 0, true),
  (pid, 'MTK120190', 120, 190, 4685, 4685, 0, 0, true),
  (pid, 'MTK120200', 120, 200, 5085, 5085, 0, 0, true);

END $$;
