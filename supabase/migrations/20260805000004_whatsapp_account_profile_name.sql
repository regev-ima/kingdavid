-- Remember each WhatsApp account's OWN profile name, and stop it being used as
-- a customer's name.
--
-- 20260805000001 cleared contact_name wherever it matched a `sender_name` on
-- one of that account's outgoing messages. That rule was too narrow, and rows
-- survived it:
--
--   * A message the CRM sends is written by greenApiSend with sender_name =
--     the rep's CRM full_name, and Green's echo of it is DEDUPED — so on an
--     account whose rep only sends from the CRM, no row anywhere carries the
--     WhatsApp profile string ("מתן ישראל 👑King David"), and nothing matched.
--   * Green has been seen putting that same profile string in senderContactName
--     / chatName on INCOMING payloads too, so once a row was cleared the next
--     incoming message wrote it straight back.
--
-- The fix is to stop inferring per-message and give the account a memory:
-- whatsapp_accounts.profile_name. The webhook learns it from any outgoing
-- payload and then rejects it in BOTH directions. This migration seeds that
-- column from the payloads already stored, and clears what it can prove is not
-- a customer's name.
--
-- Idempotent.

ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS profile_name text;

COMMENT ON COLUMN public.whatsapp_accounts.profile_name IS
  'The account''s own WhatsApp display name, learned from outgoing webhooks. Never a valid contact_name — greenApiWebhook rejects it in both directions.';

-- ── 1. Seed profile_name from the raw payloads we kept ──────────────────────
-- whatsapp_messages.raw is the webhook verbatim, so an outgoing row still holds
-- senderData.senderName: our own profile at the time it was sent. Newest wins.
WITH own AS (
  SELECT DISTINCT ON (m.account_id)
         m.account_id,
         BTRIM(COALESCE(
           m.raw -> 'senderData' ->> 'senderName',
           m.raw -> 'senderData' ->> 'senderContactName'
         )) AS name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'outgoing'
    AND m.raw IS NOT NULL
    AND BTRIM(COALESCE(m.raw -> 'senderData' ->> 'senderName', '')) <> ''
  ORDER BY m.account_id, m.msg_timestamp DESC NULLS LAST
)
UPDATE public.whatsapp_accounts a
SET profile_name = own.name
FROM own
WHERE own.account_id = a.id
  AND own.name <> ''
  AND a.profile_name IS DISTINCT FROM own.name;

-- ── 2. Fall back to the frequency rule where no payload proved it ───────────
-- A real contact name identifies ONE conversation. A name sitting on three or
-- more distinct 1:1 chats of the same account is, by definition, not naming the
-- contact — it is the account's own display name leaking in. This needs no
-- payload evidence at all, which is the point: it catches the accounts whose
-- outgoing messages were all deduped away.
WITH repeated AS (
  SELECT account_id, BTRIM(contact_name) AS name, COUNT(*) AS n
  FROM public.whatsapp_chats
  WHERE is_group = false
    AND contact_name IS NOT NULL
    AND BTRIM(contact_name) <> ''
  GROUP BY account_id, BTRIM(contact_name)
  HAVING COUNT(*) >= 3
)
UPDATE public.whatsapp_accounts a
SET profile_name = repeated.name
FROM repeated
WHERE repeated.account_id = a.id
  AND a.profile_name IS NULL;

-- ── 3. Clear it wherever it is sitting in contact_name ──────────────────────
UPDATE public.whatsapp_chats c
SET contact_name = NULL
FROM public.whatsapp_accounts a
WHERE a.id = c.account_id
  AND a.profile_name IS NOT NULL
  AND c.contact_name IS NOT NULL
  AND BTRIM(c.contact_name) = BTRIM(a.profile_name);

-- Belt and braces: any remaining name repeated across 3+ of an account's 1:1
-- chats cannot be identifying the contact either, whoever it belongs to.
WITH repeated AS (
  SELECT account_id, BTRIM(contact_name) AS name
  FROM public.whatsapp_chats
  WHERE is_group = false
    AND contact_name IS NOT NULL
    AND BTRIM(contact_name) <> ''
  GROUP BY account_id, BTRIM(contact_name)
  HAVING COUNT(*) >= 3
)
UPDATE public.whatsapp_chats c
SET contact_name = NULL
FROM repeated
WHERE repeated.account_id = c.account_id
  AND BTRIM(c.contact_name) = repeated.name;

-- ── 4. Put the real name back where an incoming message proves one ──────────
-- An incoming sender_name is the customer by definition — but only if it isn't
-- the account's own name, which is exactly the string we just spent three steps
-- removing.
WITH best AS (
  SELECT DISTINCT ON (m.chat_ref)
         m.chat_ref, BTRIM(m.sender_name) AS name
  FROM public.whatsapp_messages m
  WHERE m.direction = 'incoming'
    AND m.chat_ref IS NOT NULL
    AND m.sender_name IS NOT NULL
    AND BTRIM(m.sender_name) <> ''
    AND BTRIM(m.sender_name) !~ '^\+?[0-9][-0-9 ().]*$'
  ORDER BY m.chat_ref, m.msg_timestamp DESC NULLS LAST
)
UPDATE public.whatsapp_chats c
SET contact_name = best.name
FROM best
WHERE best.chat_ref = c.id
  AND c.is_group = false
  AND c.contact_name IS NULL
  AND best.name IS DISTINCT FROM (
    SELECT BTRIM(a.profile_name) FROM public.whatsapp_accounts a WHERE a.id = c.account_id
  );
