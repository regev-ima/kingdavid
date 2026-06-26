-- The payment-method chip selection ("אמצעי תשלום") was wired into the quote
-- and order forms and into the quote_defaults config table, but the
-- `payment_terms_selection` column was never added to the quotes and orders
-- tables themselves. So saving a quote/order with a selection fails with
--   PGRST204 — Could not find the 'payment_terms_selection' column of 'quotes'.
--
-- Add it to both tables with the same jsonb-array shape used on quote_defaults,
-- then reload the PostgREST schema cache so the new column is visible to the
-- API immediately (PGRST204 is a stale-schema-cache error).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, so re-runs are safe.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS payment_terms_selection jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_terms_selection jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
