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
