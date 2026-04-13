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
  rep1 TEXT REFERENCES profiles(email),
  rep2 TEXT REFERENCES profiles(email),
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
