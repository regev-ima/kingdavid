-- =============================================
-- DELIVERY ROUTES TABLE
-- =============================================

CREATE TABLE delivery_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_delivery_routes_updated_at
  BEFORE UPDATE ON delivery_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- DELIVERY SHIPMENTS TABLE
-- =============================================

CREATE TABLE delivery_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number TEXT UNIQUE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone TEXT,
  address TEXT,
  city TEXT,
  status delivery_status NOT NULL DEFAULT 'need_scheduling',
  scheduled_date TIMESTAMPTZ,
  delivered_date TIMESTAMPTZ,
  route_id UUID REFERENCES delivery_routes(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_shipments_order_id ON delivery_shipments(order_id);
CREATE INDEX idx_delivery_shipments_route_id ON delivery_shipments(route_id);
CREATE INDEX idx_delivery_shipments_status ON delivery_shipments(status);
CREATE INDEX idx_delivery_shipments_scheduled_date ON delivery_shipments(scheduled_date);

CREATE TRIGGER trg_delivery_shipments_updated_at
  BEFORE UPDATE ON delivery_shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
