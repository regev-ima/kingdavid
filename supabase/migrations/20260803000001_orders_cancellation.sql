-- ביטול הזמנה — an order that did not happen, without erasing that it existed.
--
-- Until now the only way to get rid of an order was the admin hard-delete
-- (lib/deleteOrder.js), which also takes the shipment, the commission, the
-- return requests and the service tickets with it. That is the right tool for
-- test data and the wrong one for a customer who cancelled: the record has to
-- survive for history and reporting, the commission has to stop counting, and
-- the customer's rollup has to give the money back.
--
-- Modelled as a nullable timestamp rather than a status enum on purpose. An
-- order already carries THREE status columns (payment / production / delivery)
-- and cancellation is orthogonal to all of them — a cancelled order can be
-- paid-and-refunded, or never paid, or already in production. NULL = live.
--
-- Every aggregation that counts money has to learn to skip these rows. The
-- ones updated alongside this migration:
--   • src/pages/Orders.jsx        — snapshot cubes (count / revenue / average)
--   • src/pages/Finance.jsx       — paid revenue
--   • functions/getDashboardStats — the control-centre figures
--   • functions/updateDashboardCounters — the cached counters
-- The order LIST still shows them, tagged "בוטל", which is the whole point of
-- cancelling instead of deleting.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by    text,
  ADD COLUMN IF NOT EXISTS cancel_reason   text;

-- Partial index: the common query is "the live ones", and cancellations are
-- expected to be a small minority, so only the cancelled rows need indexing.
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at
  ON public.orders (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
