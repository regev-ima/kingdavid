-- ============================================================================
-- Close the assignment tasks of leads that already have an owner
-- ============================================================================
-- An unassigned lead gets an open `assignment` task — "יש לשייך את הליד לנציג"
-- (createSalesTaskForNewLead). It is the admin's to-do item on /SalesTasks ←
-- "להקצות", and it is what the lead screen puts in the lead's work queue.
-- Assigning the lead is what closes it.
--
-- The bulk assignment bar on /LeadManagement wrote leads.rep1 and nothing else,
-- so every lead assigned that way kept its assignment task open: the lead reads
-- as assigned in every list, yet opening it asks a manager to assign it all
-- over again, and the task keeps sitting in the assignment queue for a lead
-- that already has a rep. That path now performs the same handover the
-- single-lead paths always did (src/lib/leadAssignment.js); this clears what it
-- left behind.
--
-- The rule applied here is the same one the app enforces from now on, and it
-- needs no judgement: an assignment task asks for an owner, and these leads
-- have one. Nothing else about the task changes — it is marked completed, and
-- attributed to the lead's rep where the task itself never recorded one.
--
-- Deliberately NOT touched: the call-back task the assignment should have
-- created alongside. Manufacturing one per lead here would drop a wave of
-- overdue "יש להתקשר ללקוח" tasks — some of them months old — into the reps'
-- queues in a single morning. The leads are all still there under their rep,
-- and the fix only concerns the ones assigned from now on.
--
-- Guarded on the columns existing: the base44-era tables have no CREATE TABLE
-- in this repo (see scripts/fixtures/schema-approximation.sql), so a column
-- this migration reads is an assumption until it is checked.
--
-- Idempotent: a second run matches nothing.
-- ============================================================================

DO $$
DECLARE
  updated bigint;
BEGIN
  IF to_regclass('public.sales_tasks') IS NULL OR to_regclass('public.leads') IS NULL THEN
    RAISE NOTICE 'sales_tasks/leads not present — nothing to repair';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sales_tasks'
       AND column_name = 'task_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sales_tasks'
       AND column_name = 'task_status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads'
       AND column_name = 'rep1'
  ) THEN
    RAISE NOTICE 'sales_tasks/leads lack the expected columns — nothing to repair';
    RETURN;
  END IF;

  -- rep1 on the task is optional here. It exists in production, but the
  -- fixture leaves it out on purpose, and the repair stands without it: the
  -- attribution is a nicety, closing the task is the point.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sales_tasks'
       AND column_name = 'rep1'
  ) THEN
    UPDATE public.sales_tasks t
       SET task_status = 'completed',
           rep1 = COALESCE(NULLIF(btrim(t.rep1), ''), l.rep1)
      FROM public.leads l
     WHERE l.id = t.lead_id
       AND t.task_type = 'assignment'
       AND t.task_status = 'not_completed'
       AND COALESCE(btrim(l.rep1), '') <> '';
  ELSE
    UPDATE public.sales_tasks t
       SET task_status = 'completed'
      FROM public.leads l
     WHERE l.id = t.lead_id
       AND t.task_type = 'assignment'
       AND t.task_status = 'not_completed'
       AND COALESCE(btrim(l.rep1), '') <> '';
  END IF;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RAISE NOTICE 'closed % assignment task(s) on leads that already have a rep', updated;
END $$;
