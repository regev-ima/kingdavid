-- Lead activity log: table + triggers + RLS policy + backfill.
--
-- Until this migration the `lead_activity_logs` table didn't actually exist
-- in the database. The React app's `createAuditLog()` helper has been
-- writing to it from day one, but the call always fell into the helper's
-- silent try/catch and produced no rows. Reps opening a lead saw an empty
-- timeline even when there had been multiple touches on the record.
--
-- This migration:
--   0. Creates the `lead_activity_logs` table with the columns the React
--      `createAuditLog()` writer and `LeadActivityTimeline` reader both
--      expect.
--   1. Adds a trigger on `leads` that writes a `created` entry on every
--      INSERT (with source / utm / landing_page / facebook_* / rep
--      metadata captured into a JSON `metadata` column), and writes
--      `status_changed` / `rep_assigned` / `rep_changed` entries on
--      UPDATEs of the relevant columns.
--   2. Actor attribution falls back through three sources: the JWT
--      claim `email` (when the change comes from an authenticated user),
--      the `app.current_user_email` session var (so future server-side
--      code can attribute when needed), and finally `'system'`. For
--      INSERTs the row's own `created_by` column is preferred when set,
--      so webhooks that already record who created the lead get
--      attributed correctly.
--   3. RLS on `lead_activity_logs` is enabled with a permissive policy
--      for authenticated users (read + insert).
--   4. A one-shot, idempotent backfill writes a `created` entry for every
--      existing lead lacking one, so historical leads aren't blank in
--      the timeline.
--
-- Quotes / orders / call_logs / sales_tasks will get their own triggers
-- in follow-up migrations once this one's verified.

BEGIN;

-- 0. Create the table.
CREATE TABLE IF NOT EXISTS public.lead_activity_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action_type        text NOT NULL,
  action_description text,
  performed_by       text,
  performed_by_name  text,
  field_name         text,
  old_value          text,
  new_value          text,
  metadata           jsonb,
  created_date       timestamptz NOT NULL DEFAULT now(),
  updated_date       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_activity_logs_lead_id_idx       ON public.lead_activity_logs (lead_id);
CREATE INDEX IF NOT EXISTS lead_activity_logs_created_date_idx  ON public.lead_activity_logs (created_date DESC);
CREATE INDEX IF NOT EXISTS lead_activity_logs_action_type_idx   ON public.lead_activity_logs (action_type);

-- 1. Helper: actor email from JWT, then session var, then 'system'.
CREATE OR REPLACE FUNCTION public._lead_activity_actor_email()
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

  RETURN 'system';
END;
$$;

-- 2. Helper: actor display name.
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

-- 3. Trigger function on `leads`.
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
      'source',                NEW.source,
      'utm_source',            NEW.utm_source,
      'utm_medium',            NEW.utm_medium,
      'utm_campaign',          NEW.utm_campaign,
      'utm_content',           NEW.utm_content,
      'utm_term',              NEW.utm_term,
      'click_id',              NEW.click_id,
      'landing_page',          NEW.landing_page,
      'facebook_ad_name',      NEW.facebook_ad_name,
      'facebook_adset_name',   NEW.facebook_adset_name,
      'facebook_campaign_name',NEW.facebook_campaign_name,
      'rep1',                  NEW.rep1,
      'rep2',                  NEW.rep2,
      'pending_rep_email',     NEW.pending_rep_email,
      'phone',                 NEW.phone,
      'email',                 NEW.email,
      'city',                  NEW.city,
      'status',                NEW.status,
      'unique_id',             NEW.unique_id,
      'created_by',            NEW.created_by
    ));

    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, metadata)
    VALUES
      (NEW.id, 'created',
       format('ליד חדש נוצר: %s', COALESCE(NULLIF(NEW.full_name, ''), '(ללא שם)')),
       COALESCE(NULLIF(NEW.created_by, ''), actor_email),
       public._lead_activity_actor_name(COALESCE(NULLIF(NEW.created_by, ''), actor_email)),
       meta);

    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_activity_logs
      (lead_id, action_type, action_description, performed_by, performed_by_name, field_name, old_value, new_value)
    VALUES
      (NEW.id, 'status_changed',
       format('שינוי סטטוס: %s → %s', COALESCE(NULLIF(OLD.status, ''), '(ריק)'), COALESCE(NULLIF(NEW.status, ''), '(ריק)')),
       actor_email, actor_name, 'status', OLD.status, NEW.status);
  END IF;

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

-- 4. Triggers (drop+recreate for idempotency).
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

-- 5. RLS for lead_activity_logs.
ALTER TABLE public.lead_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_lead_activity_logs" ON public.lead_activity_logs;
CREATE POLICY "auth_select_lead_activity_logs"
  ON public.lead_activity_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_lead_activity_logs" ON public.lead_activity_logs;
CREATE POLICY "auth_insert_lead_activity_logs"
  ON public.lead_activity_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- 6. Backfill `created` for every existing lead that doesn't already have one.
INSERT INTO public.lead_activity_logs
  (lead_id, action_type, action_description, performed_by, performed_by_name, metadata, created_date)
SELECT
  l.id,
  'created',
  format('ליד נוצר: %s', COALESCE(NULLIF(l.full_name, ''), '(ללא שם)')),
  COALESCE(NULLIF(l.created_by, ''), 'system'),
  public._lead_activity_actor_name(COALESCE(NULLIF(l.created_by, ''), 'system')),
  jsonb_strip_nulls(jsonb_build_object(
    'source',                l.source,
    'utm_source',            l.utm_source,
    'utm_medium',            l.utm_medium,
    'utm_campaign',          l.utm_campaign,
    'utm_content',           l.utm_content,
    'utm_term',              l.utm_term,
    'click_id',              l.click_id,
    'landing_page',          l.landing_page,
    'facebook_ad_name',      l.facebook_ad_name,
    'facebook_adset_name',   l.facebook_adset_name,
    'facebook_campaign_name',l.facebook_campaign_name,
    'rep1',                  l.rep1,
    'rep2',                  l.rep2,
    'pending_rep_email',     l.pending_rep_email,
    'phone',                 l.phone,
    'email',                 l.email,
    'unique_id',             l.unique_id,
    'created_by',            l.created_by,
    'backfilled',            true
  )),
  l.created_date
FROM public.leads l
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_activity_logs lal
  WHERE lal.lead_id = l.id AND lal.action_type = 'created'
);

COMMIT;
