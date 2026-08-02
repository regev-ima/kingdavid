-- Call Analytics — inbound vs. outbound.
--
-- call_logs already carries call_direction: syncVoicenterCalls writes
-- 'inbound'/'outbound' per call and CallLogger stamps 'outbound' on a
-- click-to-call. Nothing in the analytics layer ever looked at it, so the whole
-- screen silently reported "all calls" as if they were one thing.
--
-- Three changes here:
--   1. Every windowed aggregate takes an optional p_direction, so the direction
--      filter scopes the KPIs and charts too — not just the table. NULL = all.
--   2. A new call_analytics_by_direction for the summary cards, and a direction
--      breakdown on call_analytics_by_rep for the per-rep cards and the stacked
--      chart.
--   3. call_logs_detailed exposes the direction so the table can show a column
--      and filter on it.
--
-- Unclassified rows are a real population (imported/legacy calls with no
-- direction), and dropping them would make the numbers stop adding up to the
-- total. They are normalised to 'unknown' everywhere and reported as their own
-- bucket rather than discarded.

-- The column has no CREATE TABLE in this repo (call_logs was created straight
-- against the database), so make sure it exists before anything reads it.
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS call_direction text;

CREATE INDEX IF NOT EXISTS idx_call_logs_direction ON public.call_logs (call_direction);

-- One definition of "which bucket is this call in", used by every function
-- below so a NULL and an empty string can't land in different buckets.
CREATE OR REPLACE FUNCTION public.call_direction_bucket(p_direction text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(COALESCE(p_direction, '')))
    WHEN 'inbound'  THEN 'inbound'
    WHEN 'outbound' THEN 'outbound'
    ELSE 'unknown'
  END;
$$;

-- The 3-arg versions have to go: PostgREST resolves an RPC by its named
-- arguments, and leaving both would make a (p_start, p_end, p_rep) call
-- ambiguous. p_direction defaults to NULL, so existing 3-arg callers keep
-- working against the new signatures.
DROP FUNCTION IF EXISTS public.call_analytics_kpis(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.call_analytics_by_result(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.call_analytics_by_hour(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.call_analytics_by_rep(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.call_analytics_kpis(
  p_start     timestamptz DEFAULT NULL,
  p_end       timestamptz DEFAULT NULL,
  p_rep       text        DEFAULT NULL,
  p_direction text        DEFAULT NULL
)
RETURNS TABLE(total_calls bigint, answered_calls bigint, positive_calls bigint, avg_duration bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint,
    COUNT(*) FILTER (WHERE cl.call_result = 'answered_positive')::bigint,
    COALESCE(ROUND(SUM(COALESCE(cl.call_duration_seconds, 0))::numeric / NULLIF(COUNT(*), 0)), 0)::bigint
  FROM public.call_logs cl
  WHERE (p_start     IS NULL OR cl.call_started_at >= p_start)
    AND (p_end       IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep       IS NULL OR cl.rep_id = p_rep)
    AND (p_direction IS NULL OR public.call_direction_bucket(cl.call_direction) = p_direction);
$$;

CREATE OR REPLACE FUNCTION public.call_analytics_by_result(
  p_start     timestamptz DEFAULT NULL,
  p_end       timestamptz DEFAULT NULL,
  p_rep       text        DEFAULT NULL,
  p_direction text        DEFAULT NULL
)
RETURNS TABLE(result_code text, cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT cl.call_result, COUNT(*)::bigint
  FROM public.call_logs cl
  WHERE (p_start     IS NULL OR cl.call_started_at >= p_start)
    AND (p_end       IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep       IS NULL OR cl.rep_id = p_rep)
    AND (p_direction IS NULL OR public.call_direction_bucket(cl.call_direction) = p_direction)
  GROUP BY cl.call_result;
$$;

CREATE OR REPLACE FUNCTION public.call_analytics_by_hour(
  p_start     timestamptz DEFAULT NULL,
  p_end       timestamptz DEFAULT NULL,
  p_rep       text        DEFAULT NULL,
  p_direction text        DEFAULT NULL
)
RETURNS TABLE(hour int, calls bigint, answered bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(HOUR FROM (cl.call_started_at AT TIME ZONE 'Asia/Jerusalem'))::int,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint
  FROM public.call_logs cl
  WHERE cl.call_started_at IS NOT NULL
    AND (p_start     IS NULL OR cl.call_started_at >= p_start)
    AND (p_end       IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep       IS NULL OR cl.rep_id = p_rep)
    AND (p_direction IS NULL OR public.call_direction_bucket(cl.call_direction) = p_direction)
  GROUP BY 1;
$$;

-- Summary cards: one row per direction bucket for the window. Answered is
-- carried alongside the total so the card can show an answer rate per
-- direction without a second round trip.
CREATE OR REPLACE FUNCTION public.call_analytics_by_direction(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL,
  p_rep   text        DEFAULT NULL
)
RETURNS TABLE(direction text, total bigint, answered bigint, total_duration bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    public.call_direction_bucket(cl.call_direction),
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint,
    COALESCE(SUM(COALESCE(cl.call_duration_seconds, 0)), 0)::bigint
  FROM public.call_logs cl
  WHERE (p_start IS NULL OR cl.call_started_at >= p_start)
    AND (p_end   IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep   IS NULL OR cl.rep_id = p_rep)
  GROUP BY 1;
$$;

-- Per-rep, now split by direction. The four existing columns keep their names
-- and meaning so nothing that already reads them has to change.
CREATE OR REPLACE FUNCTION public.call_analytics_by_rep(
  p_start     timestamptz DEFAULT NULL,
  p_end       timestamptz DEFAULT NULL,
  p_direction text        DEFAULT NULL
)
RETURNS TABLE(
  rep_id             text,
  total              bigint,
  answered           bigint,
  positive           bigint,
  total_duration     bigint,
  inbound            bigint,
  outbound           bigint,
  no_direction       bigint,
  inbound_answered   bigint,
  outbound_answered  bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    cl.rep_id,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint,
    COUNT(*) FILTER (WHERE cl.call_result = 'answered_positive')::bigint,
    COALESCE(SUM(COALESCE(cl.call_duration_seconds, 0)), 0)::bigint,
    COUNT(*) FILTER (WHERE public.call_direction_bucket(cl.call_direction) = 'inbound')::bigint,
    COUNT(*) FILTER (WHERE public.call_direction_bucket(cl.call_direction) = 'outbound')::bigint,
    COUNT(*) FILTER (WHERE public.call_direction_bucket(cl.call_direction) = 'unknown')::bigint,
    COUNT(*) FILTER (WHERE public.call_direction_bucket(cl.call_direction) = 'inbound'
                       AND cl.call_result LIKE 'answered%')::bigint,
    COUNT(*) FILTER (WHERE public.call_direction_bucket(cl.call_direction) = 'outbound'
                       AND cl.call_result LIKE 'answered%')::bigint
  FROM public.call_logs cl
  WHERE cl.rep_id IS NOT NULL AND cl.rep_id <> ''
    AND (p_start     IS NULL OR cl.call_started_at >= p_start)
    AND (p_end       IS NULL OR cl.call_started_at <  p_end)
    AND (p_direction IS NULL OR public.call_direction_bucket(cl.call_direction) = p_direction)
  GROUP BY cl.rep_id;
$$;

-- Detail rows: expose the direction already bucketed, so the table can filter
-- with a plain .eq('call_direction', 'unknown') instead of an is-null-or-empty
-- dance on the client.
--
-- call_direction is APPENDED, not slotted in next to the other call_* columns:
-- CREATE OR REPLACE VIEW may only add columns at the END of the list, and
-- inserting one mid-list fails with 42P16 "cannot change name of view column".
-- The client reads by name, so the position is immaterial — and appending
-- avoids a DROP that would take the grants (and any future dependent view)
-- with it.
CREATE OR REPLACE VIEW public.call_logs_detailed AS
SELECT
  cl.id,
  cl.created_date,
  cl.call_started_at,
  cl.call_duration_seconds,
  cl.call_result,
  cl.recording_url,
  cl.rep_id,
  cl.lead_id,
  cl.phone_number,
  l.full_name AS lead_full_name,
  l.phone     AS lead_phone,
  public.call_direction_bucket(cl.call_direction) AS call_direction
FROM public.call_logs cl
LEFT JOIN public.leads l ON l.id = cl.lead_id;

GRANT EXECUTE ON FUNCTION public.call_direction_bucket(text)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_kpis(timestamptz, timestamptz, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_result(timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_hour(timestamptz, timestamptz, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_direction(timestamptz, timestamptz, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_rep(timestamptz, timestamptz, text)          TO authenticated;
GRANT SELECT ON public.call_logs_detailed TO authenticated;

NOTIFY pgrst, 'reload schema';
