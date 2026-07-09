-- Performance indexes, round 2 (improvement-plan A1).
--
-- Every Dashboard2 live/range count, the SalesTasks cube filters, TeamTab's
-- range scans and getDashboardStats' sentQuotes scan filter on the columns
-- below — all previously unindexed, i.e. sequential scans on every dashboard
-- paint. See docs/improvement-plan.md §A1/§5 for the exact call sites.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status    ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_production_status ON public.orders (production_status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status   ON public.orders (delivery_status);
CREATE INDEX IF NOT EXISTS idx_tickets_status           ON public.support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_status_priority  ON public.support_tickets (status, priority);
CREATE INDEX IF NOT EXISTS idx_tickets_status_sla       ON public.support_tickets (status, sla_due_date);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_created      ON public.sales_tasks (created_date);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_open_status  ON public.sales_tasks (task_status, status);
CREATE INDEX IF NOT EXISTS idx_quotes_status            ON public.quotes (status);
CREATE INDEX IF NOT EXISTS idx_shipments_status         ON public.delivery_shipments (status);

COMMIT;
