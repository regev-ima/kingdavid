-- Let the Call Analytics aggregates be scoped to a single rep, so clicking a
-- rep card filters the KPIs and charts (not just the table). Adds an optional
-- p_rep argument to the three windowed functions (NULL = all reps).
--
-- We DROP the 2-arg versions and recreate them with the extra defaulted
-- argument. Existing 2-arg-style calls (p_start, p_end) still resolve to the
-- new functions because p_rep has a default. Idempotent (DROP IF EXISTS +
-- CREATE OR REPLACE).

DROP FUNCTION IF EXISTS public.call_analytics_kpis(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.call_analytics_by_result(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.call_analytics_by_hour(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.call_analytics_kpis(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL,
  p_rep   text        DEFAULT NULL
)
RETURNS TABLE(total_calls bigint, answered_calls bigint, positive_calls bigint, avg_duration bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint,
    COUNT(*) FILTER (WHERE cl.call_result = 'answered_positive')::bigint,
    COALESCE(ROUND(SUM(COALESCE(cl.call_duration_seconds, 0))::numeric / NULLIF(COUNT(*), 0)), 0)::bigint
  FROM public.call_logs cl
  WHERE (p_start IS NULL OR cl.call_started_at >= p_start)
    AND (p_end   IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep   IS NULL OR cl.rep_id = p_rep);
$$;

CREATE OR REPLACE FUNCTION public.call_analytics_by_result(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL,
  p_rep   text        DEFAULT NULL
)
RETURNS TABLE(result_code text, cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT cl.call_result, COUNT(*)::bigint
  FROM public.call_logs cl
  WHERE (p_start IS NULL OR cl.call_started_at >= p_start)
    AND (p_end   IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep   IS NULL OR cl.rep_id = p_rep)
  GROUP BY cl.call_result;
$$;

CREATE OR REPLACE FUNCTION public.call_analytics_by_hour(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL,
  p_rep   text        DEFAULT NULL
)
RETURNS TABLE(hour int, calls bigint, answered bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(HOUR FROM (cl.call_started_at AT TIME ZONE 'Asia/Jerusalem'))::int,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint
  FROM public.call_logs cl
  WHERE cl.call_started_at IS NOT NULL
    AND (p_start IS NULL OR cl.call_started_at >= p_start)
    AND (p_end   IS NULL OR cl.call_started_at <  p_end)
    AND (p_rep   IS NULL OR cl.rep_id = p_rep)
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.call_analytics_kpis(timestamptz, timestamptz, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_result(timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_hour(timestamptz, timestamptz, text)   TO authenticated;

NOTIFY pgrst, 'reload schema';
