-- ============================================================================
-- schema-approximation.sql — a LOCAL stand-in for the production schema
-- ============================================================================
-- The base44-era tables (leads, customers, sales_tasks, orders, quotes) have no
-- CREATE TABLE anywhere in this repo, so a migration cannot be tested before it
-- runs against production. This file is a best-effort reconstruction from how
-- the application reads and writes those tables.
--
-- IT IS AN APPROXIMATION, NOT THE TRUTH. A migration passing against this
-- fixture proves the SQL is well-formed and the logic behaves — it does NOT
-- prove the column set matches production. Only scripts/inspect-production-
-- schema.sql can tell you that.
--
-- Deliberately imperfect, so the guards get exercised:
--   * customers has no `status` / `vip_status`   → tests the "MISSING" report
--   * several tables are absent entirely          → tests the to_regclass guards
--   * quotes.lead_id and orders.lead_id have NO foreign key, while
--     orders.customer_id has one with default NO ACTION → the exact ambiguity
--     that decides whether DELETE FROM leads succeeds or fails
--   * seed rows cover every phone format the app produces, including the three
--     that no implementation handled before: +972…, 00972…, and a bare local
--     number with the leading zero stripped (as a spreadsheet would do)
--
-- Usage: scripts/local-test-db.sh
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase's auth schema, stubbed so RLS policies and admin checks compile and
-- can be driven from a test session (SET test.jwt = '{"email":"…"}').
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT current_setting('test.uid', true)::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(current_setting('test.jwt', true), '{}')::jsonb $$;

-- Only the three columns rep_stats reads. Without the table that migration
-- cannot be rehearsed here at all, which is how its closed-status list drifted.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  last_sign_in_at timestamptz
);

DO $$ BEGIN
  CREATE ROLE authenticated;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE anon;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid, email text, full_name text, role text,
  extra_permissions jsonb
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text, phone text, phone_2 text, email text, address text, city text,
  lead_id uuid, original_source text, source text,
  total_orders int DEFAULT 0, total_revenue numeric DEFAULT 0,
  lifetime_value numeric DEFAULT 0, account_manager text,
  created_date timestamptz DEFAULT now(), updated_date timestamptz DEFAULT now()
  -- no `status`, no `vip_status` — on purpose
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text, phone text, phone_2 text, email text, city text, address text,
  status text, source text, source_form text, subject text,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text, rep1 text, rep2 text, pending_rep_email text,
  unique_id text, owner text, budget numeric, preferred_product text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  utm_term text, click_id text, landing_page text,
  -- Marketing attribution. dashboard_stats_v1 derives 'facebook' as a source
  -- from these three, and ContactEnquiriesCard renders ad/campaign per enquiry.
  facebook_ad_name text, facebook_campaign_name text, facebook_adset_name text,
  first_action_at timestamptz, last_api_update timestamptz,
  effective_sort_date timestamptz,
  created_date timestamptz DEFAULT now(), updated_date timestamptz DEFAULT now()
);

CREATE TABLE public.sales_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid, task_type text, task_status text, status text,
  summary text, due_date timestamptz, work_start_date timestamptz,
  rep1 text,
  created_date timestamptz DEFAULT now(),
  -- closeSalesTask stamps this at closing time; the completed_by migration
  -- backfills completed_at from it.
  updated_date timestamptz DEFAULT now()
);

CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid, customer_id uuid, status text, total numeric,
  created_date timestamptz DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  customer_id uuid REFERENCES public.customers(id),   -- NO ACTION by default
  customer_phone text, customer_phone_2 text,
  payment_status text, production_status text, delivery_status text,
  total numeric, created_date timestamptz DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id     uuid REFERENCES public.leads(id)     ON DELETE SET NULL,
  status text, priority text, sla_due_date timestamptz, customer_phone text
);

CREATE TABLE public.lead_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action_type text, action_description text, performed_by text,
  created_date timestamptz DEFAULT now()
);

CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, phone_number text
);
CREATE TABLE public.communication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, content text
);
CREATE TABLE public.club_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone text, email text, status text, source text
);
-- Absent on purpose: sync_progress, marketing_costs, upsell_suggestions,
-- lead_counters, task_counters, dashboard_counters, whatsapp_*, audit_logs.

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_all ON public.leads FOR ALL TO authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT ON public.customers TO anon;
CREATE INDEX leads_phone_idx ON public.leads (phone);

-- ── Seed: one real person entered six different ways, plus edge cases ──────
INSERT INTO public.leads (full_name, phone, status, source, utm_source) VALUES
 ('דנה כהן',   '0501234567',       'new_lead',    'digital',    'facebook'),
 ('דנה כהן',   '050-1234567',      'deal_closed', 'digital',    'facebook'),
 ('דנה כהן',   '972501234567',     'hot_lead',    'website',    'instagram'),
 ('דנה כהן',   '+972-50-1234567',  'no_answer_1', 'store',      'tiktok'),
 ('דנה כהן',   '00972501234567',   'new_lead',    'callcenter', NULL),
 ('דנה כהן',   '501234567',        'new_lead',    'referral',   'youtube'),
 ('יוסי לוי',  '0521111111',       'won',         'whatsapp',   NULL),
 ('אבי לוי',   '031234567',        'qualified',   NULL,         'google'),
 ('test user', '0000000',          'system_test', 'digital',    NULL),
 ('גל ישר',    '972521111111@c.us','custom_abc',  'digital',    NULL);

INSERT INTO public.customers (full_name, phone) VALUES
 ('דנה כהן','0501234567'), ('דנה כהן','050-1234567'),
 ('דנה כהן','972501234567'), ('יוסי לוי','0521111111');

INSERT INTO public.users (email, full_name, role) VALUES ('admin@kd.co.il','Admin','admin');

INSERT INTO public.quotes (lead_id) SELECT id FROM public.leads LIMIT 3;
INSERT INTO public.quotes (lead_id) VALUES (gen_random_uuid());  -- already dangling
INSERT INTO public.orders (lead_id) SELECT id FROM public.leads LIMIT 2;
INSERT INTO public.sales_tasks (lead_id) SELECT id FROM public.leads LIMIT 4;
