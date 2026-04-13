-- =============================================
-- LEADS TABLE
-- =============================================

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  address TEXT,
  source lead_source,
  status lead_status NOT NULL DEFAULT 'new_lead',

  -- Rep assignment
  rep1 TEXT REFERENCES users(email),
  rep2 TEXT REFERENCES users(email),
  pending_rep_email TEXT,
  owner TEXT,
  created_by TEXT,

  -- Customer link
  customer_id UUID,

  -- Lead deduplication
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  unique_id TEXT UNIQUE,

  -- Product interest
  preferred_product TEXT,
  budget NUMERIC(12,2),
  notes TEXT,

  -- Timestamps
  last_api_update TIMESTAMPTZ,
  first_action_at TIMESTAMPTZ,
  effective_sort_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Assignment history (JSONB array)
  assignment_history JSONB DEFAULT '[]'::jsonb,

  -- Marketing / UTM fields
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  click_id TEXT,
  landing_page TEXT,

  -- Facebook Lead Ad fields
  facebook_lead_id TEXT,
  facebook_form_id TEXT,
  facebook_created_time TIMESTAMPTZ,
  facebook_ad_id TEXT,
  facebook_page_id TEXT,
  facebook_ad_group_id TEXT,
  facebook_requested_size TEXT,
  facebook_try_at_home TEXT,
  facebook_inbox_url TEXT,
  facebook_is_organic BOOLEAN,
  facebook_ad_name TEXT,
  facebook_adset_id TEXT,
  facebook_adset_name TEXT,
  facebook_campaign_id TEXT,
  facebook_campaign_name TEXT,
  facebook_custom_disclaimer_responses JSONB,
  facebook_home_listing TEXT,
  facebook_partner_name TEXT,
  facebook_platform TEXT,
  facebook_retailer_item_id TEXT,
  facebook_vehicle TEXT
);

-- Indexes
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_rep1 ON leads(rep1);
CREATE INDEX idx_leads_rep2 ON leads(rep2);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_effective_sort_date ON leads(effective_sort_date);
CREATE INDEX idx_leads_created_at ON leads(created_at);
CREATE INDEX idx_leads_unique_id ON leads(unique_id);
CREATE INDEX idx_leads_customer_id ON leads(customer_id);

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
