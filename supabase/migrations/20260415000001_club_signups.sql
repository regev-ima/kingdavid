-- KING DAVID CLUB signups
-- Mirrors supabase/migrations/012_club_signups.sql in regev-ima/kingdavidwebsite
-- (branch claude/dim-stars-homepage-UlIxO, PR #13).
-- The storefront submits via the RPC public.website_create_club_signup(jsonb).
-- Keep the function signature and table/column names identical.

-- Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_signups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text NOT NULL,
  email      text NOT NULL,
  city       text,
  notes      text,
  source     text NOT NULL DEFAULT 'website',
  status     text NOT NULL DEFAULT 'new'
             CHECK (status IN ('new', 'contacted', 'member', 'unsubscribed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS club_signups_created_at_idx
  ON public.club_signups (created_at DESC);

CREATE INDEX IF NOT EXISTS club_signups_email_lower_idx
  ON public.club_signups (lower(email));

CREATE INDEX IF NOT EXISTS club_signups_phone_idx
  ON public.club_signups (phone);

-- updated_at trigger -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_signups_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_signups_set_updated_at ON public.club_signups;
CREATE TRIGGER club_signups_set_updated_at
  BEFORE UPDATE ON public.club_signups
  FOR EACH ROW
  EXECUTE FUNCTION public.club_signups_set_updated_at();

-- Row Level Security -----------------------------------------------------
-- No public policies: anon writes ONLY through the SECURITY DEFINER RPC,
-- authenticated CRM users read/write via the default authenticated policy
-- shared across the CRM.
ALTER TABLE public.club_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_club_signups" ON public.club_signups;
CREATE POLICY "auth_select_club_signups"
  ON public.club_signups
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth_insert_club_signups" ON public.club_signups;
CREATE POLICY "auth_insert_club_signups"
  ON public.club_signups
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_club_signups" ON public.club_signups;
CREATE POLICY "auth_update_club_signups"
  ON public.club_signups
  FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth_delete_club_signups" ON public.club_signups;
CREATE POLICY "auth_delete_club_signups"
  ON public.club_signups
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_id = auth.uid() AND role = 'admin'
  ));

-- RPC --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.website_create_club_signup(signup_data jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_phone     text;
  v_email     text;
  v_city      text;
  v_notes     text;
  v_source    text;
  v_id        uuid;
BEGIN
  IF signup_data IS NULL THEN
    RAISE EXCEPTION 'signup_data is required' USING ERRCODE = '22023';
  END IF;

  v_full_name := btrim(COALESCE(signup_data->>'full_name', ''));
  v_phone     := btrim(COALESCE(signup_data->>'phone', ''));
  v_email     := lower(btrim(COALESCE(signup_data->>'email', '')));
  v_city      := NULLIF(btrim(COALESCE(signup_data->>'city', '')), '');
  v_notes     := NULLIF(btrim(COALESCE(signup_data->>'notes', '')), '');
  v_source    := NULLIF(btrim(COALESCE(signup_data->>'source', '')), '');

  IF char_length(v_full_name) < 2 THEN
    RAISE EXCEPTION 'full_name must be at least 2 characters' USING ERRCODE = '22023';
  END IF;

  IF v_phone !~ '^05\d-?\d{7}$' THEN
    RAISE EXCEPTION 'phone must match Israeli mobile format' USING ERRCODE = '22023';
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email is not valid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_signups (full_name, phone, email, city, notes, source)
  VALUES (
    v_full_name,
    v_phone,
    v_email,
    v_city,
    v_notes,
    COALESCE(v_source, 'website')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.website_create_club_signup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.website_create_club_signup(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.website_create_club_signup(jsonb) TO authenticated;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
