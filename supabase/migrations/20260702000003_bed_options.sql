-- Bed configurator: the priced option groups a rep steps through when adding a
-- bed to a quote/order (storage box, frame, legs, …). Defined once (global to
-- all beds); the wizard reads them and each chosen value becomes a quote line
-- linked to its bed. Managed from קטלוג מוצרים → "תצורת מיטות".
--
--   bed_option_groups  — the questions (single-choice), ordered, skippable,
--                        optionally conditional on another group's chosen value.
--   bed_option_values  — the choices per group: label + flat price + image.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bed_option_groups (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   text UNIQUE,
  label                 text NOT NULL,
  sort_order            integer NOT NULL DEFAULT 0,
  skippable             boolean NOT NULL DEFAULT true,
  depends_on_group_key  text,
  depends_on_value_key  text,
  is_active             boolean NOT NULL DEFAULT true,
  created_date          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bed_option_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.bed_option_groups(id) ON DELETE CASCADE,
  key           text,
  label         text NOT NULL,
  price         numeric NOT NULL DEFAULT 0,
  image_url     text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_date  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bed_option_values_group_idx ON public.bed_option_values (group_id);

-- Seed the 6 groups from the spec (idempotent on key).
INSERT INTO public.bed_option_groups (key, label, sort_order, skippable, depends_on_group_key, depends_on_value_key) VALUES
  ('storage_box',     'ארגז מצעים', 1, true, NULL,          NULL),
  ('storage_type',    'סוג ארגז',   2, true, 'storage_box', 'with'),
  ('frame_type',      'סוג מסגרת',  3, true, NULL,          NULL),
  ('frame_thickness', 'עובי מסגרת', 4, true, NULL,          NULL),
  ('leg_color',       'צבע רגל',    5, true, NULL,          NULL),
  ('leg_height',      'גובה רגל',   6, true, NULL,          NULL)
ON CONFLICT (key) DO NOTHING;

-- Seed the choices with a placeholder price of ₪1 each (the admin edits real
-- prices + images later from "תצורת מיטות").
INSERT INTO public.bed_option_values (group_id, key, label, price, sort_order)
SELECT g.id, v.vkey, v.label, 1, v.sort_order
FROM (VALUES
  ('storage_box',     'without',   'בלי ארגז',            1),
  ('storage_box',     'with',      'עם ארגז',             2),
  ('storage_type',    'full',      'ארגז מלא',            1),
  ('storage_type',    'split',     'ארגז בהפרדה',         2),
  ('frame_type',      'knockdown', 'מסגרת מפורקת',        1),
  ('frame_type',      'whole',     'מסגרת שלמה',          2),
  ('frame_thickness', '4cm',       '4 ס״מ',               1),
  ('frame_thickness', '8cm',       '8 ס״מ',               2),
  ('leg_color',       'black',     'שחור',                1),
  ('leg_color',       'nickel',    'ניקל',                2),
  ('leg_height',      '5cm',       '5 ס״מ (מרובע)',       1),
  ('leg_height',      '12cm',      '12 ס״מ (מודרנית)',    2)
) AS v(group_key, vkey, label, sort_order)
JOIN public.bed_option_groups g ON g.key = v.group_key
WHERE NOT EXISTS (
  SELECT 1 FROM public.bed_option_values ev WHERE ev.group_id = g.id AND ev.key = v.vkey
);

-- RLS: everyone authenticated reads (reps need them in the quote wizard);
-- only admins write. Robust admin check (auth_id OR email), as elsewhere.
ALTER TABLE public.bed_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bed_option_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bog_select" ON public.bed_option_groups;
CREATE POLICY "bog_select" ON public.bed_option_groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bog_write" ON public.bed_option_groups;
CREATE POLICY "bog_write" ON public.bed_option_groups FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email')) AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email')) AND u.role = 'admin'));

DROP POLICY IF EXISTS "bov_select" ON public.bed_option_values;
CREATE POLICY "bov_select" ON public.bed_option_values FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bov_write" ON public.bed_option_values;
CREATE POLICY "bov_write" ON public.bed_option_values FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email')) AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email')) AND u.role = 'admin'));

NOTIFY pgrst, 'reload schema';

COMMIT;
