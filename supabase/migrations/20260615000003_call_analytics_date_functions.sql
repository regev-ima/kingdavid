-- Call Analytics date filtering: turn the aggregate VIEWS into functions that
-- accept an optional [p_start, p_end) window, so the KPIs and charts can be
-- scoped to today / yesterday / this week / a custom range — server-side, same
-- as the table (which filters call_started_at directly).
--
-- NULL bounds mean "no limit" → whole table (matches the previous all-time
-- views, including rows with a NULL call_started_at). A concrete range filters
-- on call_started_at. The call_logs_detailed and call_analytics_reps views
-- from 20260615000002 stay as-is.

DROP VIEW IF EXISTS public.call_analytics_kpis;
DROP VIEW IF EXISTS public.call_analytics_by_result;
DROP VIEW IF EXISTS public.call_analytics_by_hour;

-- Overall KPIs for the window
CREATE OR REPLACE FUNCTION public.call_analytics_kpis(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
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
    AND (p_end   IS NULL OR cl.call_started_at <  p_end);
$$;

-- Result distribution for the window. OUT name is result_code (not
-- call_result) to avoid a parameter/column name clash inside the function.
CREATE OR REPLACE FUNCTION public.call_analytics_by_result(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
)
RETURNS TABLE(result_code text, cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT cl.call_result, COUNT(*)::bigint
  FROM public.call_logs cl
  WHERE (p_start IS NULL OR cl.call_started_at >= p_start)
    AND (p_end   IS NULL OR cl.call_started_at <  p_end)
  GROUP BY cl.call_result;
$$;

-- Hour-of-day distribution (Israel local time) for the window
CREATE OR REPLACE FUNCTION public.call_analytics_by_hour(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
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
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.call_analytics_kpis(timestamptz, timestamptz)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_result(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.call_analytics_by_hour(timestamptz, timestamptz)   TO authenticated;

NOTIFY pgrst, 'reload schema';
