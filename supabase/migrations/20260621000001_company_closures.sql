-- Company-wide "closed days" policy. Single-row config (id clamped to 1) that
-- drives which dates a rep is allowed to pick when scheduling a task / follow-
-- up. Same singleton + RLS shape as quote_defaults (20260531000001).
--
-- Layers (collapsed client-side in src/lib/companyClosures.js):
--   weekly_closed_days : recurring weekdays, 0=Sun … 6=Sat. Default [6] (שבת).
--   close_on_holidays  : closed on a יום טוב (default true).
--   erev_half_day      : ערב חג is a half day, open until `erev_until`.
--   holiday_overrides  : { 'yyyy-MM-dd': { status:'open'|'closed'|'half_day',
--                          until?:'HH:mm' } } — per-holiday-instance override.
--   custom_closures    : [ { date:'yyyy-MM-dd', reason, type:'closed'|'half_day',
--                          until?:'HH:mm' } ] — ad-hoc closures (reason required
--                          in the UI, e.g. יום כיף חברה).

BEGIN;

CREATE TABLE IF NOT EXISTS public.company_closures (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  weekly_closed_days  jsonb       NOT NULL DEFAULT '[6]'::jsonb,
  close_on_holidays   boolean     NOT NULL DEFAULT true,
  erev_half_day       boolean     NOT NULL DEFAULT true,
  erev_until          text        NOT NULL DEFAULT '13:00',
  holiday_overrides   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  custom_closures     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_date        timestamptz NOT NULL DEFAULT now(),
  updated_by          text
);

-- Seed the singleton with the historical hard-coded behavior (closed שבת,
-- closed on חגים, half-day ערב חג until 13:00) so day-one behavior is unchanged.
INSERT INTO public.company_closures (id, weekly_closed_days, close_on_holidays, erev_half_day, erev_until)
VALUES (1, '[6]'::jsonb, true, true, '13:00')
ON CONFLICT (id) DO NOTHING;

-- Touch updated_date on every UPDATE so the Settings UI can show "last edited"
-- without the client having to set it.
CREATE OR REPLACE FUNCTION public.trg_company_closures_touch_updated_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_closures_touch_updated_date ON public.company_closures;
CREATE TRIGGER company_closures_touch_updated_date
BEFORE UPDATE ON public.company_closures
FOR EACH ROW
EXECUTE FUNCTION public.trg_company_closures_touch_updated_date();

-- RLS:
--   * Every authenticated user reads (every task date picker needs the row).
--   * Only admins update — this is company-wide policy.
--   * Nobody inserts/deletes — the singleton is created by this migration.
ALTER TABLE public.company_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_company_closures" ON public.company_closures;
CREATE POLICY "auth_select_company_closures"
  ON public.company_closures FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_update_company_closures" ON public.company_closures;
CREATE POLICY "admin_update_company_closures"
  ON public.company_closures FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = (auth.jwt() ->> 'email')
        AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.email = (auth.jwt() ->> 'email')
        AND u.role = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
