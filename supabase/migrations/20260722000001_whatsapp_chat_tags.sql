-- WhatsApp chat tags (sales status labels).
--
-- Adds a per-conversation `tag` to whatsapp_chats so a rep/manager can label a
-- customer in the WhatsApp chat (ממתין לתשלום / שולם / מעקב / …) and filter the
-- list by it. Stored as a stable English key; the UI maps it to the Hebrew
-- label. Client writes stay column-scoped: the existing UPDATE RLS policy
-- (own-chats / admin) already applies, we just widen the column-level GRANT to
-- include `tag` (alongside status / unread_count).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT before ADD, guarded
-- index, re-grantable GRANT — safe to re-run.

BEGIN;

ALTER TABLE public.whatsapp_chats
  ADD COLUMN IF NOT EXISTS tag text;

ALTER TABLE public.whatsapp_chats
  DROP CONSTRAINT IF EXISTS whatsapp_chats_tag_check;
ALTER TABLE public.whatsapp_chats
  ADD CONSTRAINT whatsapp_chats_tag_check
  CHECK (tag IS NULL OR tag IN (
    'awaiting_payment','paid','follow_up','not_relevant','closing_soon','hot','not_serious'
  ));

CREATE INDEX IF NOT EXISTS whatsapp_chats_tag_idx
  ON public.whatsapp_chats (tag) WHERE tag IS NOT NULL;

-- Let a rep tag their own chats (admin any) from the chat screen. Combined with
-- the existing whatsapp_chats_update_own_or_admin policy, `tag` is the only
-- extra column a client can now write.
GRANT UPDATE (status, unread_count, tag) ON public.whatsapp_chats TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
