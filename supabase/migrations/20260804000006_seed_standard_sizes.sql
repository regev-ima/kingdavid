-- The fixed size list, seeded once.
--
-- The "tick the sizes this product comes in" screen reads public.global_sizes,
-- and the catalog is empty — which is exactly why sizes have been typed in by
-- hand, product by product, all along: there was no shared list to tick.
--
-- The sizes and their surcharges are the ones printed on the showroom card:
-- a double is priced at 140/190 and every larger size adds a fixed amount
-- (+₪390 for 140/200 and 150/190, +₪490 for 150/200 / 160/190 / 160/200,
-- +₪990 for 180/200, +₪1,290 for 200/200), and the same table applies to every
-- double mattress. Singles are priced from 80/190; the card doesn't publish
-- their surcharges, so they seed at 0 for someone to fill in — a wrong number
-- would be worse than an obvious blank.
--
-- SAFE TO RE-RUN, AND SAFE ON A NON-EMPTY CATALOG: each row is inserted only
-- when no size with those dimensions exists yet, so an existing catalog is
-- left alone and nothing is ever duplicated. Prices and labels of existing
-- rows are never touched.

INSERT INTO public.global_sizes (label, dimensions, width_cm, length_cm, size_surcharge, is_active, sort_order)
SELECT s.label, s.dimensions, s.width_cm, s.length_cm, s.size_surcharge, true, s.sort_order
  FROM (VALUES
    -- Singles, exactly the list the size picker offers today. Base is 80/190.
    ('80/190',   '80/190',   80, 190,    0::numeric, 10),
    ('90/190',   '90/190',   90, 190,    0::numeric, 20),
    ('100/190', '100/190',  100, 190,    0::numeric, 30),
    ('120/190', '120/190',  120, 190,    0::numeric, 40),
    ('80/200',   '80/200',   80, 200,    0::numeric, 50),
    ('90/200',   '90/200',   90, 200,    0::numeric, 60),
    ('100/200', '100/200',  100, 200,    0::numeric, 70),
    ('120/200', '120/200',  120, 200,    0::numeric, 80),
    -- Doubles. Base is 140/190; the surcharges are the card's.
    ('140/190', '140/190',  140, 190,    0::numeric, 90),
    ('140/200', '140/200',  140, 200,  390::numeric, 100),
    ('150/190', '150/190',  150, 190,  390::numeric, 110),
    ('150/200', '150/200',  150, 200,  490::numeric, 120),
    ('160/190', '160/190',  160, 190,  490::numeric, 130),
    ('160/200', '160/200',  160, 200,  490::numeric, 140),
    ('180/200', '180/200',  180, 200,  990::numeric, 150),
    ('200/200', '200/200',  200, 200, 1290::numeric, 160)
  ) AS s(label, dimensions, width_cm, length_cm, size_surcharge, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.global_sizes g
    WHERE g.width_cm = s.width_cm
      AND g.length_cm = s.length_cm
 );

NOTIFY pgrst, 'reload schema';
