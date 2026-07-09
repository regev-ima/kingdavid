-- Leads with a NULL effective_sort_date are invisible to every date-range
-- filter and count in ניהול לידים (the range condition {$gte,$lte} excludes
-- NULLs), which silently under-counts arrivals — part of the "נכנסו מעל 200
-- אבל המסך מציג פחות" report. effective_sort_date is "when the lead (re)entered
-- the queue": created_date for regular leads, the return date for returning
-- ones — so created_date is the correct backfill for rows that never had it.

BEGIN;

UPDATE public.leads
SET effective_sort_date = created_date
WHERE effective_sort_date IS NULL AND created_date IS NOT NULL;

-- Keep future inserts covered even if a creation path forgets the field.
CREATE OR REPLACE FUNCTION public.leads_effective_sort_date_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.effective_sort_date IS NULL THEN
    NEW.effective_sort_date := COALESCE(NEW.created_date, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_effective_sort_date_default ON public.leads;
CREATE TRIGGER trg_leads_effective_sort_date_default
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.leads_effective_sort_date_default();

COMMIT;
