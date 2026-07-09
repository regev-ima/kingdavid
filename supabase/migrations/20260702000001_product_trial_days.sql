-- Per-product trial period in days (30 / 60 / 90 / 180), set once on the product
-- and applied to all its sizes. Replaces the previously fixed 30-day assumption
-- in the catalog. Additive column; the allowed values are enforced in the UI.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS trial_period_days integer;

-- Products already flagged with a trial keep the historical 30-day default.
UPDATE public.products
  SET trial_period_days = 30
  WHERE has_trial_period = true AND trial_period_days IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
