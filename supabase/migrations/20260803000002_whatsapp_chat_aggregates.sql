-- WhatsApp chat screen — move the counting to the server.
--
-- The page fetched the 500 most recent conversations and derived EVERYTHING
-- from that array: the rep dropdown, the red "N ממתינים לתשובה" banner, and
-- every number on the manager overview cards. With 830 conversations in the
-- table that is not a display limit, it is a wrong-answer generator:
--
--   • the "כל הצוות" card read exactly 500, because that was the fetch size
--   • two reps (44 and 6 conversations, both last active in July) fell outside
--     the newest 500 and vanished from the dropdown and the cards entirely
--   • the waiting banner counted only what happened to be in the window
--
-- Raising the limit postpones the problem; the table only grows. Same shape as
-- the call_analytics_* functions: the aggregates run in SQL over the whole
-- table, and the browser only ever holds the page of rows it is showing.
--
-- Both objects are security_invoker / SECURITY INVOKER, so the existing RLS on
-- whatsapp_chats still decides who sees what — a rep gets their own numbers,
-- an admin gets the floor. Without that a rep would see team-wide totals.

-- Which reps have conversations at all. Drives the rep filter, independent of
-- any page size, so a rep with old-but-real history stays selectable.
CREATE OR REPLACE VIEW public.whatsapp_chat_reps
WITH (security_invoker = true) AS
SELECT DISTINCT user_id
FROM public.whatsapp_chats
WHERE user_id IS NOT NULL;

-- One row per rep, matching exactly what WhatsAppManagerOverview used to
-- compute in the browser:
--   total            – every conversation the rep owns
--   waiting          – status = 'waiting'
--   active_period    – last message inside the selected period
--   answered_period  – …and already answered
--   oldest_waiting_at – drives the live "waiting for…" timer
-- p_start NULL = all time, mirroring the "כל הזמנים" option.
CREATE OR REPLACE FUNCTION public.whatsapp_chat_overview(
  p_start timestamptz DEFAULT NULL
)
RETURNS TABLE(
  user_id           uuid,
  total             bigint,
  waiting           bigint,
  active_period     bigint,
  answered_period   bigint,
  oldest_waiting_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    c.user_id,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE c.status = 'waiting')::bigint,
    COUNT(*) FILTER (WHERE p_start IS NULL OR c.last_message_at >= p_start)::bigint,
    COUNT(*) FILTER (
      WHERE (p_start IS NULL OR c.last_message_at >= p_start) AND c.status = 'answered'
    )::bigint,
    MIN(c.last_message_at) FILTER (WHERE c.status = 'waiting')
  FROM public.whatsapp_chats c
  WHERE c.user_id IS NOT NULL
  GROUP BY c.user_id;
$$;

-- Ordering + the status/rep filters now run in SQL, so they need indexes.
CREATE INDEX IF NOT EXISTS whatsapp_chats_last_message_at_idx
  ON public.whatsapp_chats (last_message_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_chats_status_idx
  ON public.whatsapp_chats (status);

GRANT SELECT  ON public.whatsapp_chat_reps                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_chat_overview(timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
