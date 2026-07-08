-- Bed configurator: per-choice sales note.
--
-- A choice can carry a short note (+ a note type) shown to the rep in the wizard,
-- to help explain the difference between one option and another
-- (e.g. "מסגרת שלמה חזקה יותר אך יקרה יותר"). Reordering questions and the
-- question-to-question dependency both already have columns (sort_order and
-- depends_on_group_key / depends_on_value_key on bed_option_groups) — this only
-- adds the note fields.

BEGIN;

ALTER TABLE public.bed_option_values
  ADD COLUMN IF NOT EXISTS note      text,
  ADD COLUMN IF NOT EXISTS note_type text;

-- Backfill stable keys for any rows created before the manager set one. The
-- wizard's prefill and the question-dependency both match by key, so a null key
-- would collapse siblings together; a per-id key is unique and stable.
UPDATE public.bed_option_groups SET key = 'g_' || id::text WHERE key IS NULL OR key = '';
UPDATE public.bed_option_values SET key = 'v_' || id::text WHERE key IS NULL OR key = '';

NOTIFY pgrst, 'reload schema';

COMMIT;
