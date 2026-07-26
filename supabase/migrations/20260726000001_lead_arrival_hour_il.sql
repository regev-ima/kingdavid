-- Hour-of-day filtering on the leads list (ניהול לידים).
--
-- The page used to split intake into two fixed shifts (20:00–08:00 / 08:00–20:00).
-- What a manager actually wants is "how many came in today" over the full 24
-- hours, plus the freedom to slice by an arbitrary hour window ("09:00–12:00").
--
-- The arrival hour has to be derived from effective_sort_date in Israel local
-- time, and `timestamptz AT TIME ZONE <zone>` is STABLE (not IMMUTABLE), so it
-- can't live in a generated column. A PostgREST *computed column* — a STABLE
-- function taking the table row — gives the same thing: the client can filter
-- and count on `arrival_hour_il` like any other column, so the list, the counts
-- and the KPI tiles all stay server-side and consistent for any date range.
--
--   GET /leads?arrival_hour_il=gte.9&arrival_hour_il=lt.12
--
-- Being a plain SQL function it is inlined by the planner, so the filter is
-- evaluated as a bare expression over the rows the (indexed) date range already
-- narrowed down.

BEGIN;

CREATE OR REPLACE FUNCTION public.arrival_hour_il(public.leads)
RETURNS smallint
LANGUAGE sql
STABLE
AS $$
  SELECT extract(hour FROM ($1.effective_sort_date AT TIME ZONE 'Asia/Jerusalem'))::smallint;
$$;

COMMENT ON FUNCTION public.arrival_hour_il(public.leads) IS
  'PostgREST computed column: hour (0-23) the lead arrived, in Israel local time. Used by the leads-page hour filter.';

GRANT EXECUTE ON FUNCTION public.arrival_hour_il(public.leads) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
