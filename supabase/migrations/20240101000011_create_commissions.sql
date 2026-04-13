-- =============================================
-- COMMISSIONS TABLE
-- =============================================

CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_number TEXT,
  rep1 TEXT REFERENCES users(email),
  rep2 TEXT REFERENCES users(email),
  rep1_percent NUMERIC(5,2) NOT NULL DEFAULT 100,
  rep2_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 5,
  total_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
  rep1_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  rep2_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status commission_status NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commissions_order_id ON commissions(order_id);
CREATE INDEX idx_commissions_rep1 ON commissions(rep1);
CREATE INDEX idx_commissions_rep2 ON commissions(rep2);
CREATE INDEX idx_commissions_status ON commissions(status);

CREATE TRIGGER trg_commissions_updated_at
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
