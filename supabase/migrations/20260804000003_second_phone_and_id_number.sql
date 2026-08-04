-- A second contact number, and the customer's ת.ז. — both needed on the
-- printed order, neither of which the schema ever carried.
--
-- SECOND PHONE (`phone_2` / `customer_phone_2`)
-- The rep types it on the lead, and it has to survive every conversion the
-- lead goes through — lead → quote → order, and lead → customer — because the
-- number that matters at delivery time ("תתקשרו לאשתי") is usually collected
-- long before the order exists. That's why the column lands on all four
-- tables: a value that stops at one of them is a value the delivery crew
-- doesn't have. Named `phone_2` where the table's primary column is `phone`
-- (leads, customers) and `customer_phone_2` where it is `customer_phone`
-- (quotes, orders), matching each table's existing convention.
--
-- Plain text, deliberately: it is printed and dialled by a human, never
-- matched against — unlike `phone`, which the lookup indexes.
--
-- ID NUMBER (`orders.customer_id_number`)
-- Two ways in, and the order of precedence matters. The rep can type it in the
-- order form (a cash sale never touches Hyp, and the ת.ז. is still needed), and
-- Hyp returns it with a card charge — hyp-verify / hyp-notify write it only
-- when the field is still empty, so an automatic value never overwrites what a
-- human entered. Optional in the form: an order must never be blocked on it.
--
-- The third field from the same request — מספר תשלומים — needs no column: it
-- arrives per transaction and lives on the payment record inside the existing
-- orders.payments jsonb array, as hyp_payments_count.
--
-- NOTIFY reloads the PostgREST schema cache so the new columns are visible to
-- the API immediately; without it the first writes fail with PGRST204.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, so re-runs are safe.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_2 text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_2 text;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS customer_phone_2 text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_phone_2 text,
  ADD COLUMN IF NOT EXISTS customer_id_number text;

NOTIFY pgrst, 'reload schema';
