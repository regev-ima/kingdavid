-- Repair whatsapp_chats rows whose contact identity was taken from the wrong
-- side of the conversation.
--
-- Every Green API webhook carries two identities: senderData describes who
-- WROTE the message, and the chat id describes who the conversation is WITH.
-- On an OUTGOING webhook those are not the same — senderData is the rep's own
-- WhatsApp profile. greenApiWebhook used to seed contact_name / contact_phone
-- from senderData on whichever webhook first created the row, so any
-- conversation the CRM met through an outgoing message (the rep answering from
-- their own phone, which is most of them) was filed under the rep's own name
-- and number.
--
-- What that broke, all from the same field:
--   * the conversation list and thread header showed the rep's own WhatsApp
--     name on every row instead of the customer's name or number;
--   * the CRM context panel looked up the REP's phone, so "לקוח קיים / לקוח
--     חדש" and the linked lead/orders were resolved against the wrong person;
--   * {{שם}} in a message template resolved to the rep's own name;
--   * a service ticket opened from the chat was created with the rep's phone.
--
-- The code fix (_shared/greenApi.ts + greenApiWebhook) stops new rows going
-- wrong and heals a chat the next time it sees traffic. This repairs the rows
-- already stored, including quiet chats that may never get another message.
-- Idempotent: re-running it changes nothing further.

-- 1. contact_phone is the chat itself. For a 1:1 chat the chat id IS the other
--    side's number, so it is authoritative and needs no guesswork.
UPDATE public.whatsapp_chats
SET contact_phone = regexp_replace(chat_id, '@[cg]\.us$', '')
WHERE is_group = false
  AND regexp_replace(chat_id, '@[cg]\.us$', '') <> ''
  AND contact_phone IS DISTINCT FROM regexp_replace(chat_id, '@[cg]\.us$', '');

-- 1b. A group has no single contact number — the chat id IS the group. A rep's
--     number left here surfaced under the group's name in the thread header.
UPDATE public.whatsapp_chats
SET contact_phone = NULL
WHERE is_group = true AND contact_phone IS NOT NULL;

-- 2. Clear a contact_name that is really the account owner's own profile name.
--    Outgoing messages are where Green reports our own name, so the set of
--    sender_name values on this account's outgoing rows is exactly the set of
--    strings that can never identify a customer. (greenApiSend also writes the
--    rep's CRM full_name there, which this catches too.)
WITH own_names AS (
  SELECT DISTINCT m.account_id, btrim(m.sender_name) AS name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'outgoing'
    AND m.sender_name IS NOT NULL
    AND btrim(m.sender_name) <> ''
)
UPDATE public.whatsapp_chats c
SET contact_name = NULL
FROM own_names o
WHERE o.account_id = c.account_id
  AND c.contact_name IS NOT NULL
  AND btrim(c.contact_name) = o.name;

-- 3. Drop bare-number "names" — Green reports one whenever the contact isn't
--    in the account's phone book — so the UI formats the phone itself
--    (972501234567 → 050-123-4567) instead of showing raw digits. Same rule as
--    contactLabel() in supabase/functions/_shared/greenApi.ts; keep them in step.
UPDATE public.whatsapp_chats
SET contact_name = NULL
WHERE contact_name IS NOT NULL
  AND btrim(contact_name) ~ '^\+?[0-9][-0-9 ().]*$';

-- 4. Put the real name back where we have one. An INCOMING message's
--    sender_name is the customer by definition, so the most recent one is the
--    best name we hold. Groups are excluded: there the sender is a member, not
--    the chat.
WITH best AS (
  SELECT DISTINCT ON (m.chat_ref)
         m.chat_ref,
         btrim(m.sender_name) AS name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'incoming'
    AND m.chat_ref IS NOT NULL
    AND m.sender_name IS NOT NULL
    AND btrim(m.sender_name) <> ''
    AND btrim(m.sender_name) !~ '^\+?[0-9][-0-9 ().]*$'
  ORDER BY m.chat_ref, m.msg_timestamp DESC NULLS LAST
)
UPDATE public.whatsapp_chats c
SET contact_name = best.name
FROM best
WHERE best.chat_ref = c.id
  AND c.is_group = false
  AND c.contact_name IS NULL;
