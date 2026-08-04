-- Two things the WhatsApp chat screen needed: a customer panel that answers
-- instantly, and reactions that aren't blank bubbles.
--
-- ── 1. "פרטי לקוח" sat on a spinner ─────────────────────────────────────────
-- Opening a conversation looked the contact up with
--   phone ILIKE '%<last 9 digits>%'
-- across leads, customers, orders and support_tickets. A LEADING wildcard makes
-- every index unusable, so each of those four queries was a full sequential
-- scan with row security evaluated per row — on every click.
--
-- leads and customers already have `phone_normalized` (GENERATED STORED from
-- public.normalize_il_phone, indexed) from 20260726000001, which is what the
-- database itself treats as contact identity. orders and support_tickets never
-- got one, so this adds it: same function, same shape, so a lookup by phone is
-- one index probe on all four tables and matches the DB's own dedupe rule.
--
-- ── 2. A reaction rendered as an empty bubble ───────────────────────────────
-- Green API sends a 👍 on one of our messages as typeMessage 'reactionMessage'.
-- The webhook had no case for it, so it stored message_type 'reactionMessage'
-- with an empty body and the UI drew a bubble with nothing in it — which reads
-- as a lost message. The code fix handles new ones; this recovers the emoji for
-- the ones already stored, from the raw payload we kept.
--
-- Idempotent throughout.

-- ── Normalized phone on orders + support_tickets ────────────────────────────
-- Guarded: these are base44-era tables with no CREATE TABLE in this repo, and
-- the generated column can only exist where the source column does.
DO $ctx$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'support_tickets'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'public.% is absent — skipping', t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=t AND column_name='customer_phone') THEN
      RAISE NOTICE 'public.%.customer_phone is absent — skipping', t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=t
                     AND column_name='customer_phone_normalized') THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN customer_phone_normalized text '
        'GENERATED ALWAYS AS (public.normalize_il_phone(customer_phone)) STORED', t);
      RAISE NOTICE 'added public.%.customer_phone_normalized', t;
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (customer_phone_normalized)',
      t || '_customer_phone_normalized_idx', t);
  END LOOP;
END
$ctx$;

-- Quotes are reached through the matched leads (lead_id IN (…)), so that column
-- needs an index too or the panel trades one scan for another.
DO $q$
BEGIN
  IF to_regclass('public.quotes') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='quotes' AND column_name='lead_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS quotes_lead_id_idx ON public.quotes (lead_id)';
  END IF;
END
$q$;

-- ── Recover the reactions already stored as blank ───────────────────────────
-- whatsapp_messages.raw holds the webhook payload verbatim, so the emoji is
-- still there — it was only never extracted. Green puts it in
-- extendedTextMessageData.text, older builds in reactionMessageData.text.
UPDATE public.whatsapp_messages
SET message_type = 'reaction',
    body = NULLIF(BTRIM(COALESCE(
      raw -> 'messageData' -> 'reactionMessageData'     ->> 'text',
      raw -> 'messageData' -> 'extendedTextMessageData' ->> 'text',
      ''
    )), '')
WHERE message_type = 'reactionMessage';

-- Same for the two other types that had no case and drew blank.
UPDATE public.whatsapp_messages
SET message_type = 'deleted'
WHERE message_type = 'deletedMessage';

UPDATE public.whatsapp_messages
SET message_type = 'text',
    body = NULLIF(BTRIM(COALESCE(
      raw -> 'messageData' -> 'editedMessageData' ->> 'textMessage',
      raw -> 'messageData' -> 'editedMessageData' ->> 'text',
      ''
    )), '')
WHERE message_type = 'editedMessage';

-- The conversation list preview shows the same blank for those rows. Rebuild it
-- from the message that is actually newest in each affected chat.
WITH newest AS (
  SELECT DISTINCT ON (m.chat_ref)
         m.chat_ref, m.message_type, m.body
  FROM public.whatsapp_messages m
  WHERE m.chat_ref IS NOT NULL
    AND m.message_type IN ('reaction', 'deleted', 'sticker')
  ORDER BY m.chat_ref, m.msg_timestamp DESC NULLS LAST
)
UPDATE public.whatsapp_chats c
SET last_message_text = CASE
      WHEN newest.message_type = 'reaction' AND newest.body IS NOT NULL THEN 'הגיב/ה ' || newest.body
      WHEN newest.message_type = 'reaction' THEN 'הסיר/ה תגובה'
      WHEN newest.message_type = 'deleted'  THEN 'הודעה נמחקה'
      ELSE 'מדבקה'
    END
FROM newest
WHERE newest.chat_ref = c.id
  AND COALESCE(c.last_message_text, '') = '';
