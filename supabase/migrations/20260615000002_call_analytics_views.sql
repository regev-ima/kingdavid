-- Call Analytics performance: move all the heavy lifting server-side.
--
-- /CallAnalytics used to pull the ENTIRE call_logs table into the browser
-- via fetchAllList (500-row pages, 150ms apart) PLUS every lead, then compute
-- KPIs, charts and a thousand-row table client-side (with an O(n^2)
-- leads.find() per row). On a large call_logs table that meant many seconds
-- before anything rendered.
--
-- This migration adds small read-only views — same pattern as
-- public.rep_stats / public.customers_stats — so the page fetches:
--   • one KPI row,
--   • a short result-distribution list,
--   • a 24-row hourly-distribution list,
--   • the distinct reps for the filter,
--   • and a server-paginated detail list with the lead name/phone joined in.
-- Nothing else is shipped to the client.

-- ── Indexes for the ordered/filtered detail query + the aggregates ──────────
CREATE INDEX IF NOT EXISTS idx_call_logs_created_date ON public.call_logs (created_date DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_started_at   ON public.call_logs (call_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_rep_id       ON public.call_logs (rep_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_result       ON public.call_logs (call_result);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id      ON public.call_logs (lead_id);

-- ── 1. Overall KPIs (single row) ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.call_analytics_kpis AS
SELECT
  COUNT(*)::bigint                                                  AS total_calls,
  COUNT(*) FILTER (WHERE call_result LIKE 'answered%')::bigint      AS answered_calls,
  COUNT(*) FILTER (WHERE call_result = 'answered_positive')::bigint AS positive_calls,
  COALESCE(
    ROUND(SUM(COALESCE(call_duration_seconds, 0))::numeric / NULLIF(COUNT(*), 0)),
    0
  )::bigint                                                         AS avg_duration
FROM public.call_logs;

-- ── 2. Distribution by result ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.call_analytics_by_result AS
SELECT call_result, COUNT(*)::bigint AS count
FROM public.call_logs
GROUP BY call_result;

-- ── 3. Distribution by hour-of-day (Israel local time, to match old client) ─
CREATE OR REPLACE VIEW public.call_analytics_by_hour AS
SELECT
  EXTRACT(HOUR FROM (call_started_at AT TIME ZONE 'Asia/Jerusalem'))::int AS hour,
  COUNT(*)::bigint                                                        AS calls,
  COUNT(*) FILTER (WHERE call_result LIKE 'answered%')::bigint            AS answered
FROM public.call_logs
WHERE call_started_at IS NOT NULL
GROUP BY 1;

-- ── 4. Distinct reps that have calls (for the filter dropdown) ──────────────
CREATE OR REPLACE VIEW public.call_analytics_reps AS
SELECT DISTINCT rep_id
FROM public.call_logs
WHERE rep_id IS NOT NULL AND rep_id <> '';

-- ── 5. Detail rows with lead name/phone joined, for the paginated table ─────
CREATE OR REPLACE VIEW public.call_logs_detailed AS
SELECT
  cl.id,
  cl.created_date,
  cl.call_started_at,
  cl.call_duration_seconds,
  cl.call_result,
  cl.call_notes,
  cl.recording_url,
  cl.rep_id,
  cl.lead_id,
  cl.phone_number,
  l.full_name AS lead_full_name,
  l.phone     AS lead_phone
FROM public.call_logs cl
LEFT JOIN public.leads l ON l.id = cl.lead_id;

GRANT SELECT ON public.call_analytics_kpis      TO authenticated;
GRANT SELECT ON public.call_analytics_by_result TO authenticated;
GRANT SELECT ON public.call_analytics_by_hour   TO authenticated;
GRANT SELECT ON public.call_analytics_reps      TO authenticated;
GRANT SELECT ON public.call_logs_detailed       TO authenticated;

NOTIFY pgrst, 'reload schema';
