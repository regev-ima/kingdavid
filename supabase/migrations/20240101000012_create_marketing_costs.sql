-- =============================================
-- MARKETING COSTS TABLE
-- =============================================

CREATE TABLE marketing_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  source TEXT,
  utm_source TEXT,
  channel TEXT,
  platform TEXT,
  campaign_name TEXT,
  campaign TEXT,
  utm_campaign TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_costs_date ON marketing_costs(date);
CREATE INDEX idx_marketing_costs_source ON marketing_costs(source);
CREATE INDEX idx_marketing_costs_utm_source ON marketing_costs(utm_source);
