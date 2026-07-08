-- The quote form has carried a "בקשות מיוחדות" (special_requests) field, but the
-- column was never added to the quotes table, so every save that included it
-- failed with: PGRST204 — Could not find the 'special_requests' column of
-- 'quotes'. Same class of bug as 20260625000001 (payment_terms_selection).

BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS special_requests text;

NOTIFY pgrst, 'reload schema';

COMMIT;
