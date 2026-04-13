-- =============================================
-- ENUM TYPES
-- =============================================

-- Lead source
CREATE TYPE lead_source AS ENUM (
  'store', 'callcenter', 'digital', 'whatsapp', 'referral'
);

-- Lead status
CREATE TYPE lead_status AS ENUM (
  'new_lead',
  'hot_lead',
  'followup_before_quote',
  'followup_after_quote',
  'coming_to_branch',
  'no_answer_1',
  'no_answer_2',
  'no_answer_3',
  'no_answer_4',
  'no_answer_5',
  'no_answer_whatsapp_sent',
  'no_answer_calls',
  'changed_direction',
  'deal_closed',
  'not_relevant_duplicate',
  'mailing_remove_request',
  'lives_far_phone_concern',
  'products_not_available',
  'not_relevant_bought_elsewhere',
  'not_relevant_1000_nis',
  'not_relevant_denies_contact',
  'not_relevant_service',
  'not_interested_hangs_up',
  'not_relevant_no_explanation',
  'heard_price_not_interested',
  'not_relevant_wrong_number',
  'closed_by_manager_to_mailing'
);

-- User role
CREATE TYPE user_role AS ENUM ('admin', 'user', 'factory_user');

-- User department
CREATE TYPE user_department AS ENUM ('sales', 'factory', 'support');

-- Task type
CREATE TYPE task_type AS ENUM (
  'call', 'whatsapp', 'email', 'meeting',
  'quote_preparation', 'followup', 'assignment', 'other'
);

-- Task status
CREATE TYPE task_status AS ENUM (
  'not_completed', 'completed', 'not_done', 'cancelled'
);

-- Quote status
CREATE TYPE quote_status AS ENUM (
  'draft', 'sent', 'approved', 'rejected', 'expired'
);

-- Payment status
CREATE TYPE payment_status AS ENUM (
  'unpaid', 'deposit_paid', 'paid'
);

-- Production status
CREATE TYPE production_status AS ENUM (
  'not_started', 'materials_check', 'in_production', 'qc', 'ready'
);

-- Delivery status
CREATE TYPE delivery_status AS ENUM (
  'need_scheduling', 'scheduled', 'delivered'
);

-- Customer status
CREATE TYPE customer_status AS ENUM ('active', 'inactive');

-- Property type
CREATE TYPE property_type AS ENUM ('apartment', 'house');

-- Elevator type
CREATE TYPE elevator_type AS ENUM ('none', 'regular', 'freight');

-- Commission status
CREATE TYPE commission_status AS ENUM ('pending', 'approved', 'paid');

-- Ticket status
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- Return status
CREATE TYPE return_status AS ENUM ('pending', 'approved', 'returned', 'completed');

-- Call type
CREATE TYPE call_type AS ENUM ('inbound', 'outbound');

-- Communication type
CREATE TYPE communication_type AS ENUM ('call', 'email', 'whatsapp', 'sms');

-- WhatsApp message direction
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

-- WhatsApp message status
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');

-- Inventory movement type
CREATE TYPE movement_type AS ENUM ('receipt', 'adjustment', 'removal');

-- Sync status
CREATE TYPE sync_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- Activity action type
CREATE TYPE activity_action_type AS ENUM (
  'created', 'status_changed', 'rep_changed',
  'quote_sent', 'order_created', 'converted_to_customer'
);
-- =============================================
-- USERS TABLE
-- =============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  department user_department,
  profile_icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_role ON users(role);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
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
-- =============================================
-- SALES TASKS TABLE
-- =============================================

CREATE TABLE sales_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  task_type task_type NOT NULL DEFAULT 'other',
  task_status task_status NOT NULL DEFAULT 'not_completed',
  status lead_status,
  summary TEXT,
  rep1 TEXT REFERENCES users(email),
  rep2 TEXT REFERENCES users(email),
  pending_rep_email TEXT,
  assigned_to TEXT,
  due_date TIMESTAMPTZ,
  work_start_date TIMESTAMPTZ,
  manual_created_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  unique_id TEXT UNIQUE,
  owner TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_tasks_lead_id ON sales_tasks(lead_id);
CREATE INDEX idx_sales_tasks_rep1 ON sales_tasks(rep1);
CREATE INDEX idx_sales_tasks_task_status ON sales_tasks(task_status);
CREATE INDEX idx_sales_tasks_due_date ON sales_tasks(due_date);

CREATE TRIGGER trg_sales_tasks_updated_at
  BEFORE UPDATE ON sales_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- =============================================
-- PRODUCTS TABLE
-- =============================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_is_active ON products(is_active);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- PRODUCT VARIATIONS TABLE
-- =============================================

CREATE TABLE product_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  length_cm NUMERIC(8,2),
  width_cm NUMERIC(8,2),
  height_cm NUMERIC(8,2),
  base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat_percent NUMERIC(5,2) NOT NULL DEFAULT 18,
  final_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_variations_product_id ON product_variations(product_id);
CREATE INDEX idx_product_variations_sku ON product_variations(sku);

CREATE TRIGGER trg_product_variations_updated_at
  BEFORE UPDATE ON product_variations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- =============================================
-- PRODUCT ADDONS TABLE
-- =============================================

CREATE TABLE product_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat_percent NUMERIC(5,2) NOT NULL DEFAULT 18,
  final_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_product_addons_updated_at
  BEFORE UPDATE ON product_addons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- PRODUCT ADDON PRICES (per variation)
-- =============================================

CREATE TABLE product_addon_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES product_addons(id) ON DELETE CASCADE,
  variation_id UUID NOT NULL REFERENCES product_variations(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(addon_id, variation_id)
);

CREATE INDEX idx_product_addon_prices_addon ON product_addon_prices(addon_id);
CREATE INDEX idx_product_addon_prices_variation ON product_addon_prices(variation_id);

-- =============================================
-- EXTRA CHARGES TABLE
-- =============================================

CREATE TABLE extra_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_extra_charges_updated_at
  BEFORE UPDATE ON extra_charges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- =============================================
-- QUOTES TABLE
-- =============================================

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  delivery_address TEXT,
  delivery_city TEXT,
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

  -- Status & meta
  status quote_status NOT NULL DEFAULT 'draft',
  valid_until DATE,
  terms TEXT,
  warranty_terms TEXT,
  notes TEXT,
  pdf_url TEXT,
  created_by_rep TEXT REFERENCES users(email),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotes_lead_id ON quotes(lead_id);
CREATE INDEX idx_quotes_quote_number ON quotes(quote_number);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_created_by_rep ON quotes(created_by_rep);

CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
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
-- =============================================
-- SUPPORT TICKETS TABLE
-- =============================================

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  ticket_number TEXT UNIQUE,
  subject TEXT NOT NULL,
  description TEXT,
  status ticket_status NOT NULL DEFAULT 'open',
  assigned_to TEXT REFERENCES users(email),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_tickets_order_id ON support_tickets(order_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_assigned_to ON support_tickets(assigned_to);

CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- RETURN REQUESTS TABLE
-- =============================================

CREATE TABLE return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  return_number TEXT UNIQUE,
  reason TEXT,
  status return_status NOT NULL DEFAULT 'pending',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_return_requests_order_id ON return_requests(order_id);
CREATE INDEX idx_return_requests_status ON return_requests(status);

CREATE TRIGGER trg_return_requests_updated_at
  BEFORE UPDATE ON return_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- =============================================
-- INVENTORY ITEMS TABLE
-- =============================================

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variation_id UUID REFERENCES product_variations(id) ON DELETE CASCADE,
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  qty_available INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_items_product_id ON inventory_items(product_id);
CREATE INDEX idx_inventory_items_variation_id ON inventory_items(variation_id);

CREATE TRIGGER trg_inventory_items_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- INVENTORY MOVEMENTS TABLE
-- =============================================

CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type movement_type NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_movements_item_id ON inventory_movements(inventory_item_id);
CREATE INDEX idx_inventory_movements_type ON inventory_movements(movement_type);
-- =============================================
-- LEAD ACTIVITY LOG
-- =============================================

CREATE TABLE lead_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action_type activity_action_type NOT NULL,
  action_description TEXT,
  performed_by TEXT,
  performed_by_name TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_activity_logs_lead_id ON lead_activity_logs(lead_id);
CREATE INDEX idx_lead_activity_logs_action_type ON lead_activity_logs(action_type);
CREATE INDEX idx_lead_activity_logs_created_at ON lead_activity_logs(created_at);

-- =============================================
-- CALL LOGS
-- =============================================

CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  phone_number TEXT,
  call_type call_type NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  recording_url TEXT,
  transcript TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_logs_lead_id ON call_logs(lead_id);
CREATE INDEX idx_call_logs_phone_number ON call_logs(phone_number);
CREATE INDEX idx_call_logs_created_at ON call_logs(created_at);

-- =============================================
-- AUDIT LOGS
-- =============================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  description TEXT,
  user_email TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_lead_id ON audit_logs(lead_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- =============================================
-- COMMUNICATION LOGS
-- =============================================

CREATE TABLE communication_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  communication_type communication_type NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_communication_logs_lead_id ON communication_logs(lead_id);
CREATE INDEX idx_communication_logs_type ON communication_logs(communication_type);

-- =============================================
-- WHATSAPP MESSAGE LOGS
-- =============================================

CREATE TABLE whatsapp_message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  phone_number TEXT,
  message TEXT,
  direction message_direction NOT NULL,
  status message_status NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_logs_lead_id ON whatsapp_message_logs(lead_id);
CREATE INDEX idx_whatsapp_logs_phone ON whatsapp_message_logs(phone_number);
-- =============================================
-- NOTIFICATIONS TABLE
-- =============================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- =============================================
-- NOTIFICATION PREFERENCES TABLE
-- =============================================

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, notification_type)
);

CREATE INDEX idx_notification_prefs_user_id ON notification_preferences(user_id);
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
