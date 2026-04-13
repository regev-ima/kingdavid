-- =============================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- =============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_addon_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE extra_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activity_logs ENABLE ROW LEVEL SECURITY;
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

-- =============================================
-- HELPER: get current user's email from JWT
-- =============================================

CREATE OR REPLACE FUNCTION auth.user_email()
RETURNS TEXT AS $$
  SELECT email FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================
-- USERS POLICIES
-- =============================================

-- All authenticated users can read user list
CREATE POLICY "users_select" ON users
  FOR SELECT TO authenticated
  USING (true);

-- Users can update their own profile
CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid());

-- Only admins can insert/delete users
CREATE POLICY "users_admin_insert" ON users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "users_admin_delete" ON users
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- LEADS POLICIES
-- Admins see all, reps see their assigned leads
-- =============================================

CREATE POLICY "leads_select" ON leads
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "leads_insert" ON leads
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "leads_update" ON leads
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "leads_delete" ON leads
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- =============================================
-- CUSTOMERS - same pattern as leads
-- =============================================

CREATE POLICY "customers_select" ON customers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "customers_insert" ON customers
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "customers_update" ON customers
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "customers_delete" ON customers
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- SALES TASKS
-- =============================================

CREATE POLICY "sales_tasks_select" ON sales_tasks
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "sales_tasks_insert" ON sales_tasks
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "sales_tasks_update" ON sales_tasks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "sales_tasks_delete" ON sales_tasks
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- PRODUCTS, VARIATIONS, ADDONS - readable by all, writable by admin
-- =============================================

CREATE POLICY "products_select" ON products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_modify" ON products
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "product_variations_select" ON product_variations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_variations_modify" ON product_variations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "product_addons_select" ON product_addons
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_addons_modify" ON product_addons
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "product_addon_prices_select" ON product_addon_prices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_addon_prices_modify" ON product_addon_prices
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "extra_charges_select" ON extra_charges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "extra_charges_modify" ON extra_charges
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- QUOTES - reps see their own, admins see all
-- =============================================

CREATE POLICY "quotes_select" ON quotes
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR created_by_rep = auth.user_email()
  );

CREATE POLICY "quotes_insert" ON quotes
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "quotes_update" ON quotes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR created_by_rep = auth.user_email()
  );

CREATE POLICY "quotes_delete" ON quotes
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- ORDERS - reps see their own, admins see all
-- =============================================

CREATE POLICY "orders_select" ON orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "orders_insert" ON orders
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "orders_update" ON orders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "orders_delete" ON orders
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- DELIVERIES - readable by all authenticated, writable by admin
-- =============================================

CREATE POLICY "delivery_routes_select" ON delivery_routes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "delivery_routes_modify" ON delivery_routes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "delivery_shipments_select" ON delivery_shipments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "delivery_shipments_insert" ON delivery_shipments
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "delivery_shipments_update" ON delivery_shipments
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "delivery_shipments_delete" ON delivery_shipments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- COMMISSIONS - reps see their own, admins see all
-- =============================================

CREATE POLICY "commissions_select" ON commissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    OR rep1 = auth.user_email()
    OR rep2 = auth.user_email()
  );

CREATE POLICY "commissions_modify" ON commissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- MARKETING COSTS - admin only
-- =============================================

CREATE POLICY "marketing_costs_select" ON marketing_costs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "marketing_costs_modify" ON marketing_costs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- SUPPORT & RETURNS - readable by all, writable by admin/support
-- =============================================

CREATE POLICY "support_tickets_select" ON support_tickets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "support_tickets_insert" ON support_tickets
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "support_tickets_update" ON support_tickets
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "support_tickets_delete" ON support_tickets
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "return_requests_select" ON return_requests
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "return_requests_insert" ON return_requests
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "return_requests_update" ON return_requests
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "return_requests_delete" ON return_requests
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- INVENTORY - readable by all, writable by admin/factory
-- =============================================

CREATE POLICY "inventory_items_select" ON inventory_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_items_modify" ON inventory_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role IN ('admin', 'factory_user')));

CREATE POLICY "inventory_movements_select" ON inventory_movements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_movements_insert" ON inventory_movements
  FOR INSERT TO authenticated WITH CHECK (true);

-- =============================================
-- LOGS - readable by admin, insertable by all
-- =============================================

CREATE POLICY "lead_activity_logs_select" ON lead_activity_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "lead_activity_logs_insert" ON lead_activity_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "call_logs_select" ON call_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "call_logs_insert" ON call_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "communication_logs_select" ON communication_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "communication_logs_insert" ON communication_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "whatsapp_message_logs_select" ON whatsapp_message_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "whatsapp_message_logs_insert" ON whatsapp_message_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- =============================================
-- NOTIFICATIONS - users see their own
-- =============================================

CREATE POLICY "notifications_select" ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.user_email());

CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.user_email());

CREATE POLICY "notification_prefs_select" ON notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.user_email());

CREATE POLICY "notification_prefs_modify" ON notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.user_email());

-- =============================================
-- COUNTERS & SYNC - readable by all, writable by service
-- =============================================

CREATE POLICY "lead_counters_select" ON lead_counters
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "lead_counters_modify" ON lead_counters
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "task_counters_select" ON task_counters
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_counters_modify" ON task_counters
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "dashboard_counters_select" ON dashboard_counters
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "dashboard_counters_modify" ON dashboard_counters
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "sync_progress_select" ON sync_progress
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_progress_modify" ON sync_progress
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

-- =============================================
-- UPSELLS - readable by all, writable by admin
-- =============================================

CREATE POLICY "upsell_rules_select" ON upsell_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "upsell_rules_modify" ON upsell_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));

CREATE POLICY "upsell_suggestions_select" ON upsell_suggestions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "upsell_suggestions_modify" ON upsell_suggestions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin'));
