-- Bookkeeping workflow: the bookkeeper issues invoices via an external
-- system (Sigma) and needs to track, per-order, whether the invoice has
-- already been issued and under what number. Three columns, all nullable:
--
--   invoice_issued     — bool toggle, false / NULL means "still pending".
--                        Drives the bookkeeper's three tabs (ממתינות /
--                        הוצאה / הכל).
--   invoice_number     — free-text, the number assigned in Sigma. Stored
--                        rather than synced, since there's no automated
--                        integration with Sigma in this iteration.
--   invoice_issued_at  — timestamp of the toggle flip, so we have an
--                        audit trail of when each invoice was issued.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_issued boolean,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_issued_at timestamptz;

-- Partial index so the bookkeeper's "ממתינות" tab (the hot path) doesn't
-- have to seq-scan the full orders table.
CREATE INDEX IF NOT EXISTS idx_orders_invoice_pending
  ON public.orders (created_date DESC)
  WHERE invoice_issued IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
