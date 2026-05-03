-- Adds production_scheduled_date to orders so the factory calendar board
-- can place each order on a specific production day. Distinct from
-- delivery_shipments.scheduled_date (delivery date set by logistics) —
-- production scheduling and delivery scheduling are owned by different
-- people and may land on different days for the same order.
--
-- Nullable: orders that haven't been placed on the calendar yet sit in
-- the "חדש" (inbox) column.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS production_scheduled_date timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_production_scheduled_date
  ON public.orders (production_scheduled_date)
  WHERE production_scheduled_date IS NOT NULL;

NOTIFY pgrst, 'reload schema';
