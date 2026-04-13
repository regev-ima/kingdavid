-- Enable RLS on ALL remaining tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_addon_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_size_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE extra_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsell_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE upsell_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE representatives ENABLE ROW LEVEL SECURITY;

-- Default policy: authenticated users can do everything (basic protection)
-- This prevents unauthenticated access while keeping app functional
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'users','products','product_variations','product_addons','product_addon_prices',
    'product_catalogs','product_sizes','product_size_prices','global_sizes',
    'extra_charges','inventory_items','inventory_movements','delivery_routes',
    'delivery_shipments','commissions','marketing_costs','support_tickets',
    'return_requests','call_logs','audit_logs','communication_logs',
    'whatsapp_message_logs','notifications','notification_preferences',
    'lead_counters','task_counters','dashboard_counters','sync_progress',
    'upsell_rules','upsell_suggestions','representatives'
  ])
  LOOP
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_select_%s" ON %I FOR SELECT TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_update_%s" ON %I FOR UPDATE TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_delete_%s" ON %I FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = ''admin''))', tbl, tbl);
  END LOOP;
END $$;
