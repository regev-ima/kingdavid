-- Arrivals cube in ניהול לידים: count leads that ENTERED within an arbitrary
-- date range, split by work shift (day 08:00–20:00 vs night 20:00–08:00 Israel
-- time), so day + night always == total and the cube reconciles with the list
-- for ANY range. The old client did a single fixed 20:00→20:00 window regardless
-- of the picker, so a week showed one day's cycle (173) while the list showed the
-- whole week (463). Doing the time-of-day split in SQL is the only way to sum
-- shifts across many days without shipping every lead row to the browser.

BEGIN;

CREATE OR REPLACE FUNCTION public.lead_arrivals_by_shift(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (total bigint, day_count bigint, night_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::bigint AS total,
    count(*) FILTER (
      WHERE extract(hour FROM (effective_sort_date AT TIME ZONE 'Asia/Jerusalem')) >= 8
        AND extract(hour FROM (effective_sort_date AT TIME ZONE 'Asia/Jerusalem')) < 20
    )::bigint AS day_count,
    count(*) FILTER (
      WHERE NOT (
        extract(hour FROM (effective_sort_date AT TIME ZONE 'Asia/Jerusalem')) >= 8
        AND extract(hour FROM (effective_sort_date AT TIME ZONE 'Asia/Jerusalem')) < 20
      )
    )::bigint AS night_count
  FROM public.leads
  WHERE effective_sort_date >= p_start AND effective_sort_date <= p_end;
$$;

GRANT EXECUTE ON FUNCTION public.lead_arrivals_by_shift(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
