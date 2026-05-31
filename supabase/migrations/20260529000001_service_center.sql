-- Service Center — a richer customer-service workspace built ON TOP of the
-- existing support_tickets table (per product decision: extend, don't fork).
-- Everything here is ADDITIVE so the legacy /Support + /NewTicket + /TicketDetails
-- screens keep working untouched; the new /ServiceCenter area reads the same
-- table plus these new columns.
--
-- What we add:
--   1. support_tickets — service-center fields (photos, warranty classification,
--      who opened it, the public self-service token, a small internal note log).
--   2. orders — an "imported order" marker + a free-text tags array so imported
--      historical orders can be flagged "הזמנה מיובאת".
--   3. users — a grantable "manage service" permission (Netanel's role).
--   4. sales_tasks — a link back to the service ticket a task was raised for.
--   5. Two SECURITY DEFINER RPCs (granted to anon) powering the public
--      self-service form a customer opens from an SMS link — mirrors the
--      existing website_create_lead pattern (20260415000005).
--   6. A narrowly-scoped storage policy letting the anonymous public form
--      upload its problem photos under the 'service-requests/' prefix only.

-- ---------------------------------------------------------------------------
-- 1. support_tickets — service-center columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.support_tickets
  -- Who/what opened the ticket: 'agent_manual' (rep filled it in),
  -- 'customer_self' (customer filled the SMS-linked public form),
  -- 'imported' (came from the historical-data import).
  ADD COLUMN IF NOT EXISTS source              text DEFAULT 'agent_manual',
  ADD COLUMN IF NOT EXISTS opened_by_customer  boolean NOT NULL DEFAULT false,
  -- The rep who opened/initiated the ticket (distinct from assigned_to, the
  -- person currently handling it). Stored as email + a display-name snapshot.
  ADD COLUMN IF NOT EXISTS created_by_rep       text,
  ADD COLUMN IF NOT EXISTS created_by_name      text,
  -- Customer problem photos (public URLs in the 'uploads' bucket).
  ADD COLUMN IF NOT EXISTS photo_urls           text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Self-service intake fields.
  ADD COLUMN IF NOT EXISTS order_date           date,
  ADD COLUMN IF NOT EXISTS product_name         text,
  -- Warranty classification the customer/rep picks:
  --   'general'   — a general inquiry, no warranty angle
  --   'trial_30d' — inside the 30-day product trial
  --   'warranty'  — under a long product warranty (e.g. a 10-year mattress)
  ADD COLUMN IF NOT EXISTS request_type         text,
  ADD COLUMN IF NOT EXISTS warranty_years       integer,
  -- How long after purchase the complaint arrives, in months (e.g. 36 = "after
  -- 3 years"). Lets the service team see "is this a 3-year-in claim on a
  -- 10-year warranty" at a glance.
  ADD COLUMN IF NOT EXISTS complaint_age_months integer,
  -- Diagnostic Q&A captured during intake, shape: { "question_key": "answer" }.
  ADD COLUMN IF NOT EXISTS issue_answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- A lightweight internal note timeline: [{ at, by, text }].
  ADD COLUMN IF NOT EXISTS service_notes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The SalesTask raised for a rep to follow up on this ticket, if any.
  ADD COLUMN IF NOT EXISTS service_task_id      uuid,
  -- Public self-service link plumbing.
  ADD COLUMN IF NOT EXISTS public_token         uuid,
  -- 'pending'   — SMS sent, waiting for the customer to fill the form
  -- 'submitted' — the customer submitted the form
  -- NULL        — not an SMS/self-service ticket
  ADD COLUMN IF NOT EXISTS public_status        text,
  ADD COLUMN IF NOT EXISTS public_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS public_submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS contact_preference   text;

-- Fast unique lookup of the self-service link token (only where present).
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_public_token_idx
  ON public.support_tickets (public_token)
  WHERE public_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_tickets_source_idx
  ON public.support_tickets (source)
  WHERE source IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_tickets_created_by_rep_idx
  ON public.support_tickets (created_by_rep)
  WHERE created_by_rep IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. orders — imported-order marker + tags
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_imported    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_source  text,
  ADD COLUMN IF NOT EXISTS import_batch_id text,
  ADD COLUMN IF NOT EXISTS tags           text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS orders_is_imported_idx
  ON public.orders (is_imported)
  WHERE is_imported = true;

CREATE INDEX IF NOT EXISTS orders_tags_gin_idx
  ON public.orders USING gin (tags);

-- ---------------------------------------------------------------------------
-- 3. users — grantable "manage service requests" permission
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_manage_service boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4. sales_tasks — link a (service) task back to its ticket
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_tasks
  ADD COLUMN IF NOT EXISTS service_ticket_id uuid;

CREATE INDEX IF NOT EXISTS sales_tasks_service_ticket_id_idx
  ON public.sales_tasks (service_ticket_id)
  WHERE service_ticket_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Public self-service RPCs (anon-callable, SECURITY DEFINER)
--    Mirrors the website_create_lead pattern so the anonymous customer form
--    never needs broad RLS access — it can only touch the one ticket whose
--    opaque public_token it was handed in the SMS link.
-- ---------------------------------------------------------------------------

-- 5a. Read the minimal info the public form needs to greet the customer and
--     show what the ticket is about. Returns {} when the token is unknown or
--     already submitted, so the form can show a friendly "link expired" state.
CREATE OR REPLACE FUNCTION public.service_request_get(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.support_tickets%ROWTYPE;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_row
  FROM public.support_tickets
  WHERE public_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found',          true,
    'ticket_number',  v_row.ticket_number,
    'customer_name',  v_row.customer_name,
    'order_number',   (SELECT order_number FROM public.orders WHERE id = v_row.order_id),
    'product_name',   v_row.product_name,
    'public_status',  v_row.public_status,
    'already_submitted', COALESCE(v_row.public_status = 'submitted', false)
  );
END;
$$;

-- 5b. Submit the customer-filled form. Only ever updates the single ticket the
--     token points at, and only while it is still 'pending' (idempotent: a
--     second submit is rejected). Photo URLs are validated to live in our
--     own uploads bucket so the column can't be turned into an open redirect /
--     arbitrary-URL store.
CREATE OR REPLACE FUNCTION public.service_request_submit(p_token uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid;
  v_request_type text;
  v_photos      text[];
BEGIN
  IF p_token IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'token and data are required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id
  FROM public.support_tickets
  WHERE public_token = p_token
    AND COALESCE(public_status, 'pending') <> 'submitted'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_submitted');
  END IF;

  v_request_type := NULLIF(btrim(COALESCE(p_data->>'request_type', '')), '');

  -- Photos: accept only public URLs that point at our own uploads bucket.
  v_photos := ARRAY(
    SELECT x
    FROM jsonb_array_elements_text(COALESCE(p_data->'photo_urls', '[]'::jsonb)) AS x
    WHERE x LIKE '%/storage/v1/object/public/uploads/%'
  );

  UPDATE public.support_tickets SET
    description          = COALESCE(NULLIF(btrim(COALESCE(p_data->>'description', '')), ''), description),
    request_type         = COALESCE(v_request_type, request_type),
    product_name         = COALESCE(NULLIF(btrim(COALESCE(p_data->>'product_name', '')), ''), product_name),
    order_date           = COALESCE((p_data->>'order_date')::date, order_date),
    warranty_years       = COALESCE((p_data->>'warranty_years')::int, warranty_years),
    complaint_age_months = COALESCE((p_data->>'complaint_age_months')::int, complaint_age_months),
    issue_answers        = COALESCE(p_data->'issue_answers', issue_answers),
    photo_urls           = CASE WHEN array_length(v_photos, 1) IS NULL THEN photo_urls ELSE v_photos END,
    contact_preference   = COALESCE(NULLIF(btrim(COALESCE(p_data->>'contact_preference', '')), ''), contact_preference),
    opened_by_customer   = true,
    source               = 'customer_self',
    status               = CASE WHEN status IN ('resolved', 'closed') THEN status ELSE 'open' END,
    public_status        = 'submitted',
    public_submitted_at  = now(),
    updated_date         = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.service_request_get(uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.service_request_submit(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_request_get(uuid)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_request_submit(uuid, jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storage — let the anonymous public form upload its problem photos, but
--    ONLY under the 'service-requests/' prefix (everything else stays
--    authenticated-only as before).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public service-request photo upload'
  ) THEN
    CREATE POLICY "Public service-request photo upload" ON storage.objects
      FOR INSERT TO anon
      WITH CHECK (bucket_id = 'uploads' AND name LIKE 'service-requests/%');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
