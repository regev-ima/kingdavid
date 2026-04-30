-- Lead activity log: triggers + RLS policy + backfill.
--
-- Until this migration the `lead_activity_logs` table was populated only by
-- in-app `createAuditLog()` calls in the React layer. Anything that bypassed
-- the UI — webhooks (`upsertLead`), bulk imports, automation, status changes
-- triggered by background jobs — left no trace. Reps opening a lead saw an
-- empty activity log even when there had been multiple touches on the
-- record.
--
-- This migration moves the source of truth into the database itself:
--   1. A trigger on `leads` writes a `created` entry on every INSERT (with
--      source / utm / rep metadata captured into the JSON `metadata`
--      column), and writes `status_changed` / `rep_assigned` / `rep_changed`
--      entries on UPDATEs of the relevant columns.
--   2. Actor attribution falls back through three sources: the JWT
--      claim `email` (when the change comes from an authenticated user),
--      the `app.current_user_email` session var (so future server-side code
--      can attribute when needed), and finally `'system'` (webhooks, cron).
--   3. RLS on `lead_activity_logs` is enabled with a permissive policy for
--      authenticated users — the table was previously absent from the
--      enable_rls migration, so depending on environment it was either
--      wide-open or silently blocking inserts. This makes the behaviour
--      explicit and consistent across environments.
--   4. A one-shot backfill writes a `created` entry for every existing lead
--      that doesn't already have one, so the timeline isn't empty for
--      historical records.
--
-- Quotes, orders, call_logs and sales_tasks will get their own triggers in
-- follow-up migrations — kept out of this one so we can verify the leads
-- side first.

BEGIN;

-- 1. Helper: resolve the actor's email from JWT, then session var, then 'system'.
CREATE OR REPLACE FUNCTION public._lead_activity_actor_email()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  e text;
BEGIN
  -- Authenticated user via Supabase JWT
  BEGIN
    e := auth.jwt() ->> 'email';
    IF e IS NOT NULL AND e <> '' THEN
      RETURN e;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- no auth context (service role, cron); fall through
    NULL;
  END;

  -- Optional override set by app code via SET LOCAL
  BEGIN
    e := current_setting('app.current_user_email', true);
    IF e IS NOT NULL AND e <> '' THEN
      RETURN e;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN 'system';
END;
$$;

-- 2. Helper: human-readable name for the actor.
CREATE OR REPLACE FUNCTION public._lead_activity_actor_name(actor_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  n text;
BEGIN
  IF actor_email IS NULL OR actor_email = '' OR actor_email = 'system' THEN
    RETURN 'מערכת';
  END IF;

  SELECT full_name INTO n FROM public.users WHERE email = actor_email LIMIT 1;
  RETURN COALESCE(NULLIF(n, ''), actor_email);
END;
$$;

-- 3. Main trigger function on `leads`.
CREATE OR REPLACE FUNCTION public.trg_log_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_email text := public._lead_activity_actor_email();
  actor_name  text := public._lead_activity_actor_name(actor_email);
  meta        jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    meta := jsonb_strip_nulls(jsonb_build_object(
      'source',           NEW.source,
      'utm_source',       NEW.utm_source,
      'utm_medium',       NEW.utm_medium,
      'utm_campaign',     NEW.utm_campaign,
      'utm_content',      NEW.utm_content,
      'source_form',      NEW.source_form,
      'facebook_ad_name', NEW.facebook_ad_name,
      'rep1',             NEW.rep1,
      'rep2',             NEW.rep2,
      'pending_rep_email',NEW.pending_rep_email,
      'phone',            NEW.phone,
      'email',            NEW.email,
      'city',             NEW.city,
      'status',           NEW.status
    ));

    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, metadata)
    VALUES
      (NEW.id, 'created',
       format('ליד חדש נוצר: %s', COALESCE(NULLIF(NEW.full_name, ''), '(ללא שם)')),
       actor_email, actor_name, meta);

    RETURN NEW;
  END IF;

  -- UPDATE
  -- status change
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, field_name, old_value, new_value)
    VALUES
      (NEW.id, 'status_changed',
       format('שינוי סטטוס: %s → %s', COALESCE(NULLIF(OLD.status, ''), '(ריק)'), COALESCE(NULLIF(NEW.status, ''), '(ריק)')),
       actor_email, actor_name, 'status', OLD.status, NEW.status);
  END IF;

  -- rep1 change
  IF NEW.rep1 IS DISTINCT FROM OLD.rep1 THEN
    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, field_name, old_value, new_value)
    VALUES
      (NEW.id,
       CASE WHEN COALESCE(OLD.rep1, '') = '' THEN 'rep_assigned' ELSE 'rep_changed' END,
       format('שינוי נציג ראשי: %s → %s',
              COALESCE(NULLIF(OLD.rep1, ''), 'לא משויך'),
              COALESCE(NULLIF(NEW.rep1, ''), 'לא משויך')),
       actor_email, actor_name, 'rep1', OLD.rep1, NEW.rep1);
  END IF;

  -- rep2 change
  IF NEW.rep2 IS DISTINCT FROM OLD.rep2 THEN
    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, field_name, old_value, new_value)
    VALUES
      (NEW.id,
       CASE WHEN COALESCE(OLD.rep2, '') = '' THEN 'rep_assigned' ELSE 'rep_changed' END,
       format('שינוי נציג משני: %s → %s',
              COALESCE(NULLIF(OLD.rep2, ''), 'לא משויך'),
              COALESCE(NULLIF(NEW.rep2, ''), 'לא משויך')),
       actor_email, actor_name, 'rep2', OLD.rep2, NEW.rep2);
  END IF;

  -- pending_rep_email change
  IF NEW.pending_rep_email IS DISTINCT FROM OLD.pending_rep_email THEN
    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, field_name, old_value, new_value)
    VALUES
      (NEW.id, 'rep_changed',
       format('שינוי נציג ממתין: %s → %s',
              COALESCE(NULLIF(OLD.pending_rep_email, ''), 'לא הוגדר'),
              COALESCE(NULLIF(NEW.pending_rep_email, ''), 'לא הוגדר')),
       actor_email, actor_name, 'pending_rep_email', OLD.pending_rep_email, NEW.pending_rep_email);
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Attach the triggers (drop+recreate keeps the migration idempotent).
DROP TRIGGER IF EXISTS leads_activity_log_insert ON public.leads;
CREATE TRIGGER leads_activity_log_insert
AFTER INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_lead_activity();

DROP TRIGGER IF EXISTS leads_activity_log_update ON public.leads;
CREATE TRIGGER leads_activity_log_update
AFTER UPDATE OF status, rep1, rep2, pending_rep_email ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_lead_activity();

-- 5. RLS for `lead_activity_logs` — table was missing from
--    20240202000001_enable_rls_all_tables.sql. Make the access model explicit:
--    authenticated users can read and insert; only the trigger (SECURITY
--    DEFINER) writes from server-side flows.
ALTER TABLE public.lead_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_lead_activity_logs" ON public.lead_activity_logs;
CREATE POLICY "auth_select_lead_activity_logs"
  ON public.lead_activity_logs FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth_insert_lead_activity_logs" ON public.lead_activity_logs;
CREATE POLICY "auth_insert_lead_activity_logs"
  ON public.lead_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. Backfill: every existing lead that doesn't already have a `created`
--    activity log gets one synthesised from the row itself. Idempotent —
--    safe to re-run.
INSERT INTO public.lead_activity_logs
  (lead_id, action_type, action_description, performed_by, performed_by_name, metadata, created_date)
SELECT
  l.id,
  'created',
  format('ליד נוצר: %s', COALESCE(NULLIF(l.full_name, ''), '(ללא שם)')),
  'system',
  'מערכת',
  jsonb_strip_nulls(jsonb_build_object(
    'source',           l.source,
    'utm_source',       l.utm_source,
    'utm_medium',       l.utm_medium,
    'utm_campaign',     l.utm_campaign,
    'utm_content',      l.utm_content,
    'source_form',      l.source_form,
    'facebook_ad_name', l.facebook_ad_name,
    'rep1',             l.rep1,
    'rep2',             l.rep2,
    'pending_rep_email',l.pending_rep_email,
    'phone',            l.phone,
    'email',            l.email,
    'backfilled',       true
  )),
  l.created_date
FROM public.leads l
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_activity_logs lal
  WHERE lal.lead_id = l.id AND lal.action_type = 'created'
);

COMMIT;
