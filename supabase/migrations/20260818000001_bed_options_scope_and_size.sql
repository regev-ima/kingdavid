-- Bed configurator: per-product scoping, a website exposure mode, and
-- size-driven auto-answers.
--
-- Three additions, all additive and idempotent. Nothing existing reads the new
-- columns until the new screens do, so applying this changes no behaviour.
--
--   products.bed_options            — which bed questions THIS bed offers.
--   bed_option_groups.website_mode  — whether/how a question reaches the site.
--   bed_option_values.min/max_width_cm — the size band a choice belongs to.
--
-- WHY EACH ONE
--
-- 1. Until now the configurator was global: every bed got every question. A
--    model that has no storage box, or that is never sold with Jewish
--    separation, still had to be asked. `products.bed_options` turns a question
--    off for one bed:
--
--      {"storage_box": false}
--
--    A key that is ABSENT means enabled. That default matters: it is what makes
--    this migration a no-op for the ~100 beds already in the catalog. Disabling
--    is opt-in, per bed, from the product card.
--
-- 2. The storefront must not show the whole configurator — frames, legs and the
--    fabric catalog are a rep's conversation, not a customer's. `website_mode`
--    says what each question is to the website:
--
--      'hidden' — never leaves the CRM (the DEFAULT, so nothing leaks by
--                 accident; a question added later stays internal until said
--                 otherwise)
--      'ask'    — shown to the customer as a question
--      'auto'   — sent for PRICING only and never rendered; the site answers it
--                 itself (see 3)
--
-- 3. "סוג ארגז" is the 'auto' case. The customer already chose a bed size, so
--    asking again which box size they want is a question they have answered —
--    and a chance to answer it wrong. min_width_cm / max_width_cm let a choice
--    declare the band it covers (standard ≤160, king ≥180), so the site picks
--    the matching choice from the width of the variation in the cart. The rep's
--    wizard is untouched: it keeps asking, exactly as today.
--
-- The seeds below are best-effort and only fill values that are still NULL /
-- default. `storage_box` and `storage_type` are matched on their seeded keys;
-- the Jewish-separation question was created through the UI and carries a
-- generated key, so it is matched on its label. Anything the match misses is
-- set from "קטלוג מוצרים → תצורת מיטות", which stays the source of truth.

BEGIN;

-- 1. Per-product scoping. {} means "every question applies", which is the
--    behaviour every existing bed already has.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS bed_options jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Website exposure. 'hidden' by default — opt IN, never opt out.
ALTER TABLE public.bed_option_groups
  ADD COLUMN IF NOT EXISTS website_mode text NOT NULL DEFAULT 'hidden';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bed_option_groups_website_mode_check'
  ) THEN
    ALTER TABLE public.bed_option_groups
      ADD CONSTRAINT bed_option_groups_website_mode_check
      CHECK (website_mode IN ('hidden', 'ask', 'auto'));
  END IF;
END $$;

-- 3. The size band a choice covers. NULL on both ends = "any size", which is
--    every choice that exists today.
ALTER TABLE public.bed_option_values
  ADD COLUMN IF NOT EXISTS min_width_cm integer,
  ADD COLUMN IF NOT EXISTS max_width_cm integer;

-- ---------------------------------------------------------------------------
-- Seeds (best-effort, only where the value is still the default)
-- ---------------------------------------------------------------------------

-- "ארגז מצעים" — asked on the site.
UPDATE public.bed_option_groups
SET website_mode = 'ask'
WHERE key = 'storage_box' AND website_mode = 'hidden';

-- "סוג ארגז" — priced on the site, never asked.
UPDATE public.bed_option_groups
SET website_mode = 'auto'
WHERE key = 'storage_type' AND website_mode = 'hidden';

-- The Jewish-separation question. Created through the UI, so it has a generated
-- key ('g_bc_…') and can only be found by its label.
UPDATE public.bed_option_groups
SET website_mode = 'ask'
WHERE website_mode = 'hidden'
  AND input_type = 'choice'
  AND label LIKE '%הפרדה יהודית%';

-- Size bands for the box choices: standard up to 160 wide, king from 180 up.
UPDATE public.bed_option_values v
SET max_width_cm = 160
FROM public.bed_option_groups g
WHERE v.group_id = g.id
  AND g.key = 'storage_type'
  AND v.min_width_cm IS NULL AND v.max_width_cm IS NULL
  AND v.label NOT LIKE '%קינג%';

UPDATE public.bed_option_values v
SET min_width_cm = 180
FROM public.bed_option_groups g
WHERE v.group_id = g.id
  AND g.key = 'storage_type'
  AND v.min_width_cm IS NULL AND v.max_width_cm IS NULL
  AND v.label LIKE '%קינג%';

NOTIFY pgrst, 'reload schema';

COMMIT;
