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
