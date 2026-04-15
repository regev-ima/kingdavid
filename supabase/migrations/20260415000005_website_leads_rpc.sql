-- Website contact-form leads.
--
-- The storefront (regev-ima/kingdavidwebsite, PR #17) submits "צור קשר"
-- inquiries through the RPC public.website_create_lead(jsonb). They land
-- in the EXISTING public.leads table — we do NOT create a new table.
--
-- What we add:
--   • Three nullable columns (subject, source_form, tags text[])
--     that the existing leads UI does not yet use, but the website
--     payload provides.
--   • Indexes for the common filter fields.
--   • The SECURITY DEFINER RPC the storefront calls.
--
-- Mapping notes:
--   • source values already in use: store/callcenter/digital/whatsapp/referral.
--     We allow a sixth literal 'website' (no enum/check constraint today — free
--     text column — so nothing to alter).
--   • The website sends status='new'; leads.status uses 'new_lead'. The RPC
--     normalizes and stores 'new_lead' so the existing Leads UI handles it
--     uniformly.
--   • leads uses `created_date`/`updated_date`, NOT `created_at`. Match that.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS subject     text,
  ADD COLUMN IF NOT EXISTS source_form text,
  ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT ARRAY[]::text[];

-- ---------------------------------------------------------------------------
-- 2. Indexes on the new filter dimensions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS leads_source_form_idx
  ON public.leads (source_form)
  WHERE source_form IS NOT NULL;

-- GIN index so WHERE 'אתר' = ANY(tags) / WHERE tags @> ARRAY['אתר'] is fast.
CREATE INDEX IF NOT EXISTS leads_tags_gin_idx
  ON public.leads USING gin (tags);

-- ---------------------------------------------------------------------------
-- 3. RPC: public.website_create_lead(jsonb) RETURNS uuid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_create_lead(lead_data jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name  text;
  v_phone      text;
  v_email      text;
  v_subject    text;
  v_message    text;
  v_source     text;
  v_source_form text;
  v_tags_in    text[];
  v_tags_out   text[];
  v_id         uuid;
BEGIN
  IF lead_data IS NULL THEN
    RAISE EXCEPTION 'lead_data is required' USING ERRCODE = '22023';
  END IF;

  -- Normalize inputs: trim whitespace, lowercase email, NULL-on-empty.
  v_full_name   := btrim(COALESCE(lead_data->>'full_name', ''));
  v_phone       := btrim(COALESCE(lead_data->>'phone', ''));
  v_email       := lower(btrim(COALESCE(lead_data->>'email', '')));
  v_subject     := NULLIF(btrim(COALESCE(lead_data->>'subject', '')), '');
  v_message     := NULLIF(btrim(COALESCE(lead_data->>'message', '')), '');
  v_source      := NULLIF(btrim(COALESCE(lead_data->>'source', 'website')), '');
  v_source_form := NULLIF(btrim(COALESCE(lead_data->>'source_form', '')), '');

  -- Validation --------------------------------------------------------------
  IF char_length(v_full_name) < 2 THEN
    RAISE EXCEPTION 'full_name must be at least 2 characters' USING ERRCODE = '22023';
  END IF;

  -- Accept Israeli mobile (05X-XXXXXXX, with/without hyphen) OR a 9-10 digit
  -- landline. We're lenient on formatting — the CRM team will normalize later.
  IF v_phone !~ '^0\d{1,2}[-]?\d{6,8}$' THEN
    RAISE EXCEPTION 'phone must be a valid Israeli mobile or landline number' USING ERRCODE = '22023';
  END IF;

  IF v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;

  -- Tags: accept jsonb array, coerce to text[], and GUARANTEE 'אתר' is present.
  BEGIN
    v_tags_in := ARRAY(
      SELECT btrim(x)
      FROM jsonb_array_elements_text(COALESCE(lead_data->'tags', '[]'::jsonb)) AS x
      WHERE btrim(x) <> ''
    );
  EXCEPTION WHEN others THEN
    v_tags_in := ARRAY[]::text[];
  END;

  IF NOT ('אתר' = ANY(v_tags_in)) THEN
    v_tags_out := array_append(v_tags_in, 'אתר');
  ELSE
    v_tags_out := v_tags_in;
  END IF;

  -- Insert ------------------------------------------------------------------
  INSERT INTO public.leads (
    full_name, phone, email, notes,
    subject, source, source_form, tags, status,
    created_date, updated_date
  )
  VALUES (
    v_full_name,
    v_phone,
    NULLIF(v_email, ''),
    v_message,           -- website `message` stored in existing `notes` column
    v_subject,
    v_source,            -- 'website' by default
    v_source_form,       -- e.g. 'contact_page'
    v_tags_out,          -- always includes 'אתר'
    'new_lead',          -- matches the existing status vocabulary
    now(),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.website_create_lead(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_create_lead(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.website_create_lead(jsonb) TO authenticated;

-- Reload PostgREST schema cache so new columns + RPC are visible immediately.
NOTIFY pgrst, 'reload schema';
