-- Performance indexes for the lead screens.
--
-- WHY: the lead-management dashboard fans out ~50 `count(*)` queries per load
-- (6 KPI tiles + 4 counts × every rep for the workload panel + the handling
-- status breakdown + the filtered count), and the main list sorts by
-- effective_sort_date. The lead modal additionally fires per-lead lookups
-- against sales_tasks. None of the columns these queries filter or sort on were
-- indexed, so every one of them was a sequential scan over the whole table.
-- With the browser capping ~6 concurrent connections, the actual list request
-- also queued behind the count fan-out — which is what made "everything" feel
-- slow.
--
-- NOTE: the dashboard_stats_fn migration (same date) already added
--   leads(effective_sort_date), leads(status), orders(lead_id), quotes(lead_id)
-- so those are intentionally omitted here to avoid duplicate indexes. This file
-- only adds what's still missing — most importantly the per-rep leads index and
-- the sales_tasks indexes, which nothing else covers.
--
-- These indexes are purely additive (CREATE INDEX IF NOT EXISTS) and change no
-- behaviour — only speed. Composite indexes lead with the equality column and
-- trail with the sort/range column so a single index serves both the
-- "WHERE col = x" and the "WHERE col = x ... ORDER BY/BETWEEN" shapes.

-- Give index builds room on larger tables (a single statement; applies for the
-- duration of this migration request).
SET statement_timeout TO '600s';

-- ── leads ────────────────────────────────────────────────────────────────
-- Dashboard widgets that bucket/sort by creation time (today's leads, etc.).
-- (dashboard_stats_fn already covers effective_sort_date and status.)
CREATE INDEX IF NOT EXISTS leads_created_date_idx
  ON public.leads (created_date DESC);

-- Per-rep workload counts: WHERE rep1 = … [AND effective_sort_date BETWEEN …].
-- This is the key one for the workload-panel fan-out — nothing else indexes
-- rep1. Leading rep1 also serves plain "WHERE rep1 = …" filters.
CREATE INDEX IF NOT EXISTS leads_rep1_effective_sort_date_idx
  ON public.leads (rep1, effective_sort_date DESC);

-- KPI + status-breakdown counts that combine status with the date range:
-- WHERE status = … AND effective_sort_date BETWEEN …. The trailing sort column
-- lets one index satisfy the whole predicate (vs. the plain status index).
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

-- Refresh planner statistics so the new indexes are considered immediately
-- instead of after the next autovacuum cycle.
ANALYZE public.leads;
ANALYZE public.sales_tasks;
