-- Shift scheduling ("שיבוץ משמרות") — replaces the manager's weekly Excel.
-- One row per (work_date, shift) cell, holding the list of assigned rep emails,
-- so the React grid reads/writes a cell directly (mirrors the spreadsheet).
--
-- RLS: every authenticated user may READ the schedule (reps see where they're
-- placed); only admins, or reps granted the `edit_schedule` extra permission,
-- may write. Same permission pattern as bulk_update / view_finance
-- (users.extra_permissions jsonb).

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date     date NOT NULL,
  shift         text NOT NULL CHECK (shift IN ('morning', 'evening', 'off')),
  rep_emails    jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_date  timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  UNIQUE (work_date, shift)
);

CREATE INDEX IF NOT EXISTS shift_assignments_work_date_idx
  ON public.shift_assignments (work_date);

-- Keep updated_date fresh on every edit without trusting the client.
CREATE OR REPLACE FUNCTION public.trg_shift_assignments_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_date := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shift_assignments_touch ON public.shift_assignments;
CREATE TRIGGER shift_assignments_touch
BEFORE UPDATE ON public.shift_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_shift_assignments_touch();

ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated reads.
DROP POLICY IF EXISTS "shift_assignments_select" ON public.shift_assignments;
CREATE POLICY "shift_assignments_select"
  ON public.shift_assignments FOR SELECT
  TO authenticated USING (true);

-- Admins OR reps with the edit_schedule permission may insert/update/delete.
DROP POLICY IF EXISTS "shift_assignments_insert" ON public.shift_assignments;
CREATE POLICY "shift_assignments_insert"
  ON public.shift_assignments FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = (auth.jwt() ->> 'email')
      AND (u.role = 'admin' OR (u.extra_permissions ->> 'edit_schedule') = 'true')
  ));

DROP POLICY IF EXISTS "shift_assignments_update" ON public.shift_assignments;
CREATE POLICY "shift_assignments_update"
  ON public.shift_assignments FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = (auth.jwt() ->> 'email')
      AND (u.role = 'admin' OR (u.extra_permissions ->> 'edit_schedule') = 'true')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = (auth.jwt() ->> 'email')
      AND (u.role = 'admin' OR (u.extra_permissions ->> 'edit_schedule') = 'true')
  ));

DROP POLICY IF EXISTS "shift_assignments_delete" ON public.shift_assignments;
CREATE POLICY "shift_assignments_delete"
  ON public.shift_assignments FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.email = (auth.jwt() ->> 'email')
      AND (u.role = 'admin' OR (u.extra_permissions ->> 'edit_schedule') = 'true')
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
