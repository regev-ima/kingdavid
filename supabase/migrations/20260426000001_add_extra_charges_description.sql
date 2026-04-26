-- The CRM's "תוספות להזמנות" (/ExtraCharges) page exposes a "תיאור"
-- (description) field on every extra-charge row, both in the create
-- dialog and in the list view. The deployed schema is missing the
-- column, so creating any new extra failed with:
--
--   PGRST204: Could not find the 'description' column of 'extra_charges'
--             in the schema cache
--
-- Add the column as nullable text (no default — descriptions are
-- optional and existing rows should stay NULL until edited).

ALTER TABLE public.extra_charges
  ADD COLUMN IF NOT EXISTS description text;

-- Reload PostgREST schema cache so the new column is visible immediately
-- without redeploying the API container.
NOTIFY pgrst, 'reload schema';
