-- ============================================================================
-- Who closed this task, and when
-- ============================================================================
-- A closed task on a lead said "בוצע" and showed a date. It never said by
-- whom, because nobody was writing it down: `sales_tasks` has no such column,
-- closeSalesTask stamps only updated_date, and no trigger logs a task closing.
-- "מי סגר את המשימה הזאת" had no answer anywhere in the database.
--
-- ── WHY A TRIGGER AND NOT A FIELD IN THE UPDATE ────────────────────────────
-- Tasks close from several places — the complete-task dialog, the lead screen's
-- inline check, the deal-close sweep — and the next one added would have to
-- remember to stamp the rep. A BEFORE trigger records the actor no matter which
-- path did the closing, and takes the identity from the JWT rather than from a
-- value the client chose, so the row cannot claim someone else did the work.
--
-- ── HISTORY IS NOT INVENTED ────────────────────────────────────────────────
-- completed_at is backfilled from updated_date, which is what closeSalesTask
-- has been stamping at closing time all along and what the lead screen already
-- displays as the closing date — the same number, moved into a column that says
-- what it means.
--
-- completed_by is left NULL for everything closed before today. The task's rep1
-- was available and would have filled the screen nicely, but rep1 is who the
-- task belonged to, not who closed it — a manager closing a rep's task is
-- exactly the case this feature exists to show. A blank is the honest answer.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP
-- TRIGGER IF EXISTS before CREATE, and the backfill only touches rows still
-- NULL.
-- ============================================================================

BEGIN;

ALTER TABLE public.sales_tasks
  ADD COLUMN IF NOT EXISTS completed_by text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.sales_tasks.completed_by IS
  $c$Email of whoever moved this task out of not_completed, from their JWT. NULL for tasks closed before 20260820000002, and for closures with no authenticated user.$c$;
COMMENT ON COLUMN public.sales_tasks.completed_at IS
  $c$When the task left not_completed. Backfilled from updated_date for older rows.$c$;


-- Actor identity. Deliberately self-contained rather than calling
-- _lead_activity_actor_email(): that helper lives in the lead-activity-log
-- migration, which has no workflow of its own and so cannot be assumed to have
-- run. Same three-step fallback — JWT, session var, nobody.
CREATE OR REPLACE FUNCTION public._sales_task_actor_email()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  e text;
BEGIN
  BEGIN
    e := auth.jwt() ->> 'email';
    IF e IS NOT NULL AND e <> '' THEN RETURN e; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    e := current_setting('app.current_user_email', true);
    IF e IS NOT NULL AND e <> '' THEN RETURN e; END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- No authenticated user: an import, a backfill, a cron. Better a blank than
  -- a name that didn't do it.
  RETURN NULL;
END;
$$;


-- 'not_completed' (and NULL, for rows written before the column had a default)
-- is the only open state; completed / not_done / cancelled are all closings.
CREATE OR REPLACE FUNCTION public.trg_sales_task_stamp_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  was_open boolean := coalesce(OLD.task_status, 'not_completed') = 'not_completed';
  is_open  boolean := coalesce(NEW.task_status, 'not_completed') = 'not_completed';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.task_status, 'not_completed') <> 'not_completed'
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
      NEW.completed_by := public._sales_task_actor_email();
    END IF;
    RETURN NEW;
  END IF;

  IF was_open AND NOT is_open THEN
    NEW.completed_at := now();
    NEW.completed_by := public._sales_task_actor_email();
  ELSIF NOT was_open AND is_open THEN
    -- Reopened. The stamp described a closing that no longer happened; leaving
    -- it would show a rep who closed a task that is currently open.
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_tasks_stamp_completion ON public.sales_tasks;
CREATE TRIGGER sales_tasks_stamp_completion
  BEFORE INSERT OR UPDATE OF task_status ON public.sales_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sales_task_stamp_completion();


-- Backfill: the closing date the screen is already showing.
UPDATE public.sales_tasks
SET completed_at = updated_date
WHERE completed_at IS NULL
  AND coalesce(task_status, 'not_completed') <> 'not_completed'
  AND updated_date IS NOT NULL;


DO $$
DECLARE
  closed     int;
  with_when  int;
BEGIN
  SELECT count(*), count(completed_at)
    INTO closed, with_when
  FROM public.sales_tasks
  WHERE coalesce(task_status, 'not_completed') <> 'not_completed';

  RAISE NOTICE 'closed tasks: %, of which % now carry a closing time', closed, with_when;
END $$;

COMMIT;
