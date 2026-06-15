-- Performance indexes for the lead screens.
--
-- WHY: the lead-management dashboard fans out ~50 `count(*)` queries per load
-- (6 KPI tiles + 4 counts × every rep for the workload panel + the handling
-- status breakdown + the filtered count), and the main list sorts by
-- effective_sort_date. The lead modal additionally fires per-lead lookups
-- against sales_tasks / quotes / orders. None of the columns these queries
-- filter or sort on were indexed, so every one of them was a sequential scan
-- over the whole table. With the browser capping ~6 concurrent connections,
-- the actual list request also queued behind the count fan-out — which is what
-- made "everything" feel slow.
--
-- These indexes are purely additive (CREATE INDEX IF NOT EXISTS) and change no
-- behaviour — only speed. Composite indexes lead with the equality column and
-- trail with the sort/range column so a single index serves both the
-- "WHERE col = x" and the "WHERE col = x ... ORDER BY effective_sort_date" /
-- "BETWEEN" shapes.

-- Give index builds room on larger tables (a single statement; applies for the
-- duration of this migration request).
SET statement_timeout TO '600s';

-- ── leads ────────────────────────────────────────────────────────────────
-- Main list ordering + the date-range (effective_sort_date BETWEEN …) that
-- nearly every dashboard count applies.
CREATE INDEX IF NOT EXISTS leads_effective_sort_date_idx
  ON public.leads (effective_sort_date DESC);

-- Dashboard widgets that bucket/sort by creation time (today's leads, etc.).
CREATE INDEX IF NOT EXISTS leads_created_date_idx
  ON public.leads (created_date DESC);

-- Per-rep workload counts: WHERE rep1 = … [AND effective_sort_date BETWEEN …].
-- Leading rep1 also serves plain "WHERE rep1 = …" filters.
CREATE INDEX IF NOT EXISTS leads_rep1_effective_sort_date_idx
  ON public.leads (rep1, effective_sort_date DESC);

-- KPI + status-breakdown counts: WHERE status = … [AND effective_sort_date
-- BETWEEN …]. Leading status also serves plain "WHERE status = …" filters.
CREATE INDEX IF NOT EXISTS leads_status_effective_sort_date_idx
  ON public.leads (status, effective_sort_date DESC);

-- ── sales_tasks ──────────────────────────────────────────────────────────
-- Lead modal ("tasks for this lead") and the list's active-tasks lookup
-- (lead_id IN (…)). lead_id is highly selective, so this is the single biggest
-- win for opening a lead.
CREATE INDEX IF NOT EXISTS sales_tasks_lead_id_idx
  ON public.sales_tasks (lead_id);

-- The tasks page fires a wall of head-counts shaped as
-- "task_status = 'not_completed' AND due_date <op> …" and orders open tabs by
-- due_date.
CREATE INDEX IF NOT EXISTS sales_tasks_status_due_date_idx
  ON public.sales_tasks (task_status, due_date);

-- "My tasks" — a rep's own open queue ordered by due date.
CREATE INDEX IF NOT EXISTS sales_tasks_rep1_status_due_date_idx
  ON public.sales_tasks (rep1, task_status, due_date);

-- ── quotes ───────────────────────────────────────────────────────────────
-- Lead modal: quotes for this lead.
CREATE INDEX IF NOT EXISTS quotes_lead_id_idx
  ON public.quotes (lead_id);

-- ── orders ───────────────────────────────────────────────────────────────
-- Lead modal: orders for this lead (also feeds the service-ticket lookup).
CREATE INDEX IF NOT EXISTS orders_lead_id_idx
  ON public.orders (lead_id);

-- Refresh planner statistics so the new indexes are considered immediately
-- instead of after the next autovacuum cycle.
ANALYZE public.leads;
ANALYZE public.sales_tasks;
ANALYZE public.quotes;
ANALYZE public.orders;
