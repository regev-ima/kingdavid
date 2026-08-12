-- Pin a rep to a specific avatar identity (colour + icon).
--
-- Every rep is shown with a colour and an icon nobody else on the team has, so
-- a manager recognises who owns a lead before reading the name. The assignment
-- is computed from the whole roster (src/lib/repIdentity.js) — uniqueness is a
-- property of the team, not of one row, which is why it can't simply be stored
-- per user and left at that.
--
-- This column is the OVERRIDE: an admin picking an identity from the rep dialog
-- writes the palette slot here, and the automatic assignment then works around
-- the pinned slots rather than over them. NULL — the default, and where every
-- existing rep starts — means "assign me one", which is what the app has been
-- doing since the identity landed. So this migration changes nobody's avatar.
--
-- Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_slot smallint;

COMMENT ON COLUMN public.users.avatar_slot IS
  'Pinned index into REP_PALETTE (src/lib/repIdentity.js) — the rep''s colour + icon. NULL = assigned automatically from the free slots, in join order.';

-- Two reps must never point at the same slot; that is the whole guarantee.
-- Partial, so the many NULLs (everyone auto-assigned) don''t collide with each
-- other. The picker in the rep dialog greys out taken slots, so a user should
-- never reach this — it is here so a bad write fails loudly instead of quietly
-- giving two people the same face.
CREATE UNIQUE INDEX IF NOT EXISTS users_avatar_slot_unique
  ON public.users (avatar_slot)
  WHERE avatar_slot IS NOT NULL;
