-- Per-rep call breakdown for the Call Analytics screen (the "ניתוח לפי נציג"
-- cards). One windowed aggregate row per rep — same date-window contract as the
-- other call_analytics_* functions (NULL bounds = whole table).

CREATE OR REPLACE FUNCTION public.call_analytics_by_rep(
  p_start timestamptz DEFAULT NULL,
  p_end   timestamptz DEFAULT NULL
)
RETURNS TABLE(rep_id text, total bigint, answered bigint, positive bigint, total_duration bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    cl.rep_id,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE cl.call_result LIKE 'answered%')::bigint,
    COUNT(*) FILTER (WHERE cl.call_result = 'answered_positive')::bigint,
    COALESCE(SUM(COALESCE(cl.call_duration_seconds, 0)), 0)::bigint
  FROM public.call_logs cl
  WHERE cl.rep_id IS NOT NULL AND cl.rep_id <> ''
    AND (p_start IS NULL OR cl.call_started_at >= p_start)
    AND (p_end   IS NULL OR cl.call_started_at <  p_end)
  GROUP BY cl.rep_id;
$$;

GRANT EXECUTE ON FUNCTION public.call_analytics_by_rep(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
