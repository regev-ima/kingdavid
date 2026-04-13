-- =============================================
-- ORDERS TABLE
-- =============================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  delivery_address TEXT,
  delivery_city TEXT,
  source TEXT,
  property_type property_type,
  floor INTEGER,
  apartment_number TEXT,
  elevator_type elevator_type,

  -- Line items (JSONB arrays)
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  extras JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Totals
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Statuses
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  production_status production_status NOT NULL DEFAULT 'not_started',
  delivery_status delivery_status NOT NULL DEFAULT 'need_scheduling',

  trial_30d_enabled BOOLEAN NOT NULL DEFAULT false,
  notes_sales TEXT,
  rep1 TEXT REFERENCES users(email),
  rep2 TEXT REFERENCES users(email),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_lead_id ON orders(lead_id);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_quote_id ON orders(quote_id);
CREATE INDEX idx_orders_rep1 ON orders(rep1);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_production_status ON orders(production_status);
CREATE INDEX idx_orders_delivery_status ON orders(delivery_status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
