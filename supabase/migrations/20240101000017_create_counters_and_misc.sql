-- =============================================
-- LEAD COUNTERS (cached aggregations)
-- =============================================

CREATE TABLE lead_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_email TEXT NOT NULL,
  status TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rep_email, status)
);

CREATE INDEX idx_lead_counters_rep ON lead_counters(rep_email);

-- =============================================
-- TASK COUNTERS (cached aggregations)
-- =============================================

CREATE TABLE task_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_email TEXT NOT NULL,
  task_status TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rep_email, task_status)
);

CREATE INDEX idx_task_counters_rep ON task_counters(rep_email);

-- =============================================
-- DASHBOARD COUNTERS (cached KPIs)
-- =============================================

CREATE TABLE dashboard_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_type TEXT NOT NULL,
  label TEXT,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  rep_email TEXT,
  date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboard_counters_type ON dashboard_counters(counter_type);
CREATE INDEX idx_dashboard_counters_rep ON dashboard_counters(rep_email);
CREATE INDEX idx_dashboard_counters_date ON dashboard_counters(date);

-- =============================================
-- SYNC PROGRESS TABLE
-- =============================================

CREATE TABLE sync_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,
  status sync_status NOT NULL DEFAULT 'pending',
  progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_sync_progress_type ON sync_progress(sync_type);
CREATE INDEX idx_sync_progress_status ON sync_progress(status);

-- =============================================
-- UPSELL RULES TABLE
-- =============================================

CREATE TABLE upsell_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  upsell_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_upsell_rules_trigger ON upsell_rules(trigger_product_id);

-- =============================================
-- UPSELL SUGGESTIONS TABLE
-- =============================================

CREATE TABLE upsell_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  suggested_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_upsell_suggestions_quote ON upsell_suggestions(quote_id);
