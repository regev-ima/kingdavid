-- WhatsApp chat mirror via Green API.
--
-- WHY: reps chat with customers on their personal WhatsApp. After a sale they
-- often drop the ball on service, which drives cancellations. To give the
-- manager (and each rep) visibility, we mirror every WhatsApp conversation
-- into the CRM through Green API webhooks. This is READ-ONLY documentation:
-- we never send a message from the platform — we only record what already
-- happens on the rep's phone.
--
-- Three tables:
--   whatsapp_accounts  — one row per rep: their Green API instance id + token
--                        (token is a SECRET). The webhook endpoint matches an
--                        inbound payload to a row by instance_id and verifies
--                        webhook_token.
--   whatsapp_chats     — one row per (account, chat_id) conversation. `status`
--                        is derived from the last message direction:
--                        'waiting'  → last message INCOMING (customer waiting
--                                     for a reply — surfaced in red/amber),
--                        'answered' → last message OUTGOING (we replied —
--                                     surfaced in green, "got service").
--   whatsapp_messages  — append-only message log (incoming + outgoing).
--
-- SECURITY model:
--   * whatsapp_accounts holds the Green API token, so NO client may read it
--     directly — all access goes through the greenApiSettings / greenApiWebhook
--     Edge Functions (service role). RLS is enabled with no client policies.
--   * whatsapp_chats / whatsapp_messages are read-only to clients: a rep sees
--     only their own rows, an admin sees everything. Writes happen only from
--     the webhook (service role, bypasses RLS) — there are deliberately no
--     INSERT/UPDATE/DELETE policies, matching the "reflect only, never send"
--     requirement.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF EXISTS before
-- CREATE, and a guarded ALTER PUBLICATION, so re-runs are safe.

BEGIN;

-- ── whatsapp_accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instance_id     text        NOT NULL DEFAULT '',
  api_token       text        NOT NULL DEFAULT '',
  api_url         text        NOT NULL DEFAULT 'https://api.green-api.com',
  media_url       text        NOT NULL DEFAULT 'https://media.green-api.com',
  webhook_token   text        NOT NULL DEFAULT '',
  phone           text,                    -- the connected WhatsApp number (wid)
  state           text,                    -- last known stateInstance (authorized, …)
  is_active       boolean     NOT NULL DEFAULT true,
  last_webhook_at timestamptz,
  last_state_at   timestamptz,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

-- One WhatsApp per rep; one Green API instance maps to exactly one account.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_user_id_key   ON public.whatsapp_accounts (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_instance_key  ON public.whatsapp_accounts (instance_id)
  WHERE instance_id <> '';

-- ── whatsapp_chats ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_chats (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid        NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  user_id                 uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_id                 text        NOT NULL,         -- Green API chatId (…@c.us / …@g.us)
  contact_name            text,
  contact_phone           text,
  is_group                boolean     NOT NULL DEFAULT false,
  last_message_text       text,
  last_message_at         timestamptz,
  last_message_direction  text,                         -- 'incoming' | 'outgoing'
  status                  text        NOT NULL DEFAULT 'idle',  -- 'waiting' | 'answered' | 'idle'
  unread_count            integer     NOT NULL DEFAULT 0,
  created_date            timestamptz NOT NULL DEFAULT now(),
  updated_date            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_chats_account_chat_key ON public.whatsapp_chats (account_id, chat_id);
CREATE INDEX IF NOT EXISTS whatsapp_chats_user_id_idx     ON public.whatsapp_chats (user_id);
CREATE INDEX IF NOT EXISTS whatsapp_chats_last_msg_idx    ON public.whatsapp_chats (last_message_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_chats_status_idx      ON public.whatsapp_chats (status);

-- ── whatsapp_messages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_ref          uuid        REFERENCES public.whatsapp_chats(id) ON DELETE CASCADE,
  account_id        uuid        NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  green_message_id  text,                               -- idMessage (dedupe key)
  chat_id           text        NOT NULL,
  direction         text        NOT NULL,               -- 'incoming' | 'outgoing'
  sender_name       text,
  sender_phone      text,
  message_type      text        NOT NULL DEFAULT 'text',
  body              text,
  media_url         text,
  file_name         text,
  msg_timestamp     timestamptz,
  raw               jsonb,
  created_date      timestamptz NOT NULL DEFAULT now()
);

-- Dedupe the same Green API message id within an account (webhooks can repeat).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_account_msg_key
  ON public.whatsapp_messages (account_id, green_message_id)
  WHERE green_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_chat_ref_idx ON public.whatsapp_messages (chat_ref, msg_timestamp);
CREATE INDEX IF NOT EXISTS whatsapp_messages_user_id_idx  ON public.whatsapp_messages (user_id);

-- ── updated_date touch trigger (shared by accounts + chats) ─────────────────
CREATE OR REPLACE FUNCTION public.trg_whatsapp_touch_updated_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_accounts_touch_updated_date ON public.whatsapp_accounts;
CREATE TRIGGER whatsapp_accounts_touch_updated_date
  BEFORE UPDATE ON public.whatsapp_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_whatsapp_touch_updated_date();

DROP TRIGGER IF EXISTS whatsapp_chats_touch_updated_date ON public.whatsapp_chats;
CREATE TRIGGER whatsapp_chats_touch_updated_date
  BEFORE UPDATE ON public.whatsapp_chats
  FOR EACH ROW EXECUTE FUNCTION public.trg_whatsapp_touch_updated_date();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- accounts: locked down entirely (token is a secret). Service role only.
ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;

-- chats + messages: read-only for clients. A rep sees only rows they own; an
-- admin sees everything. The single SELECT policy covers both. No write
-- policies → clients can never INSERT/UPDATE/DELETE (the webhook uses the
-- service role, which bypasses RLS).
ALTER TABLE public.whatsapp_chats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_chats_select_own_or_admin" ON public.whatsapp_chats;
CREATE POLICY "whatsapp_chats_select_own_or_admin"
  ON public.whatsapp_chats FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = (auth.jwt() ->> 'email')
        AND (u.role = 'admin' OR u.id = whatsapp_chats.user_id)
    )
  );

DROP POLICY IF EXISTS "whatsapp_messages_select_own_or_admin" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_select_own_or_admin"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = (auth.jwt() ->> 'email')
        AND (u.role = 'admin' OR u.id = whatsapp_messages.user_id)
    )
  );

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Add the read-only tables to the supabase_realtime publication so the chat
-- screen updates live as the webhook writes rows. Guarded so re-runs don't
-- error on "relation is already member of publication".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_chats;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
