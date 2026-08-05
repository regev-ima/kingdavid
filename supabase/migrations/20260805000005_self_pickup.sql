-- Self pickup (איסוף עצמי)
--
-- An order the customer collects from the factory instead of having it
-- delivered. It changes three things: no delivery address is required, no
-- delivery/assembly extras are charged, and the order must say so in writing
-- ("איסוף עצמי - בתיאום") so nobody schedules a truck for it.
--
-- The flag lives on quotes too, because delivery is priced at the quote stage:
-- a self-pickup quote must not carry a delivery charge, and the flag has to
-- survive the quote → order conversion.
--
-- `delivery_shipments.status` has no CHECK constraint, so the new
-- 'awaiting_pickup' value needs no schema change — only the UI enumerates it.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_self_pickup boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_self_pickup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.is_self_pickup IS
  'Customer collects from the factory: no delivery address, no delivery/assembly extras.';

COMMENT ON COLUMN public.orders.is_self_pickup IS
  'Customer collects from the factory: no delivery address, no delivery/assembly extras, shipment waits as awaiting_pickup.';

-- The logistics list filters by status; self-pickup orders sit in their own
-- bucket rather than in the "needs scheduling" queue.
CREATE INDEX IF NOT EXISTS idx_orders_self_pickup
  ON public.orders (is_self_pickup)
  WHERE is_self_pickup;
