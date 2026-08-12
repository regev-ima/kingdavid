-- Colour and icon become two independent choices.
--
-- 20260812000002 stored one `avatar_slot`: a palette index that fixed a colour
-- and an icon together. Picking a rep's icon therefore also decided their
-- colour, which is not how anyone wants to choose. So the identity splits:
--
--   * `avatar_color` — a hue id from REP_COLORS (src/lib/repIdentity.js).
--   * `profile_icon` — the icon id, the column the profile picker in Settings
--     has always written. One vocabulary, one column; the rep dialog and the
--     Settings picker now write the same field.
--
-- NULL / empty means "assign me one", which is where every existing rep is and
-- what the app has been doing all along — so this changes nobody's avatar.
--
-- avatar_slot is dropped rather than kept: it was added earlier today, nothing
-- has been pinned with it, and leaving a dead column that silently disagrees
-- with the live one is how the next person gets confused.
--
-- Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_color text;

COMMENT ON COLUMN public.users.avatar_color IS
  'Pinned hue id from REP_COLORS (src/lib/repIdentity.js), e.g. ''emerald''. NULL = assigned automatically from the free colours, in join order.';

-- Two reps must never hold the same colour; that is the whole guarantee. The
-- picker greys out taken colours, so nobody should reach this — it is here so a
-- bad write fails loudly instead of quietly giving two people the same mark.
-- Partial, so the many NULLs (everyone automatic) don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS users_avatar_color_unique
  ON public.users (avatar_color)
  WHERE avatar_color IS NOT NULL;

-- The same guard for icons. Built NOT to fail on existing data: pre-existing
-- duplicates from the Settings picker would make a plain unique index
-- impossible to create, so any duplicates are released first, oldest account
-- keeps its pick — the same rule the client-side assignment applies.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY profile_icon
           ORDER BY created_date NULLS LAST, id
         ) AS rn
  FROM public.users
  WHERE profile_icon IS NOT NULL AND BTRIM(profile_icon) <> ''
)
UPDATE public.users u
SET profile_icon = NULL
FROM ranked
WHERE ranked.id = u.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS users_profile_icon_unique
  ON public.users (profile_icon)
  WHERE profile_icon IS NOT NULL AND BTRIM(profile_icon) <> '';

-- ── Retire the combined slot ────────────────────────────────────────────────
DROP INDEX IF EXISTS public.users_avatar_slot_unique;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS avatar_slot;
