-- =============================================
-- CUSTOMERS TABLE
-- =============================================

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  source TEXT,
  original_source TEXT,
  first_order_date TIMESTAMPTZ,
  last_order_date TIMESTAMPTZ,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  status customer_status NOT NULL DEFAULT 'active',
  vip_status BOOLEAN NOT NULL DEFAULT false,
  account_manager TEXT REFERENCES users(email),
  pending_rep_email TEXT,
  unique_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK from leads to customers now that both tables exist
ALTER TABLE leads
  ADD CONSTRAINT fk_leads_customer
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_lead_id ON customers(lead_id);
CREATE INDEX idx_customers_status ON customers(status);

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
