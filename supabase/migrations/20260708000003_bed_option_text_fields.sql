-- Bed configurator: free-text questions (input_type = 'text').
--
-- Until now every bed-config group was a single-CHOICE question (image cards
-- that each become a priced quote line). This adds a second kind — a "text"
-- group whose "values" are FREE-TEXT / SELECT fields the rep fills in
-- (e.g. the fabric catalog: שם קטלוג / מס׳ צבע / צבע / ספק).
--
-- Text answers are NOT priced lines. They ride on the bed item as
-- `bed_config_fields` inside the quote/order `items` jsonb and render on the
-- document — no new table column is needed for the answers themselves.
--
-- The fabric catalog — previously a hardcoded block in the quote/order forms —
-- is seeded here as the first text group (sort_order 100), so it appears as a
-- natural continuation of the wizard right after the choice questions.

BEGIN;

-- 'choice' (the existing image-card questions) | 'text' (free-text fields).
ALTER TABLE public.bed_option_groups
  ADD COLUMN IF NOT EXISTS input_type text NOT NULL DEFAULT 'choice';

-- For a TEXT group each value is a field, not a priced choice:
--   field_type  'text'   → free-text input
--               'select'  → dropdown; `options` holds the choice list
ALTER TABLE public.bed_option_values
  ADD COLUMN IF NOT EXISTS field_type text,
  ADD COLUMN IF NOT EXISTS options    jsonb;

-- Seed the fabric catalog as a text group (idempotent on key).
INSERT INTO public.bed_option_groups (key, label, sort_order, skippable, input_type)
VALUES ('fabric_catalog', 'קטלוג בד', 100, true, 'text')
ON CONFLICT (key) DO NOTHING;

-- Its four fields: three free-text + a supplier dropdown ('אחר' lets the rep
-- type a supplier not in the list). price defaults to 0 (unused for text).
INSERT INTO public.bed_option_values (group_id, key, label, field_type, options, sort_order)
SELECT g.id, v.vkey, v.label, v.ftype, v.opts, v.sort_order
FROM (VALUES
  ('fabric_catalog', 'catalog_name', 'שם קטלוג', 'text',   NULL::jsonb,                         1),
  ('fabric_catalog', 'color_number', 'מס׳ צבע',  'text',   NULL::jsonb,                         2),
  ('fabric_catalog', 'color',        'צבע',      'text',   NULL::jsonb,                         3),
  ('fabric_catalog', 'supplier',     'ספק',      'select', '["פרחי","ארוטקס","בד U","אחר"]'::jsonb, 4)
) AS v(group_key, vkey, label, ftype, opts, sort_order)
JOIN public.bed_option_groups g ON g.key = v.group_key
WHERE NOT EXISTS (
  SELECT 1 FROM public.bed_option_values ev WHERE ev.group_id = g.id AND ev.key = v.vkey
);

NOTIFY pgrst, 'reload schema';

COMMIT;
