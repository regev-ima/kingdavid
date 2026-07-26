-- One canonical phone key per lead, so "the same customer" is a fact the DB can
-- state instead of something every caller re-derives (and gets wrong).
--
-- Today leads.phone holds whatever the source sent:
--   manual entry          "050-1234567"   (separators kept as typed)
--   upsertLead webhook    "+972501234567" / "0501234567"
--   Google-Sheets import  "0501234567"    (digits only)
-- and every duplicate check in the app compares the RAW string
-- (`.eq('phone', …)`), so those three are three different leads. The Sheets
-- import doesn't even check ("no duplicate check for speed") and re-inserts
-- every row on every run.
--
-- phone_normalized is maintained by a trigger, so it holds for writes that never
-- pass through the client — webhooks, imports, SQL — and a new write path cannot
-- forget it.
--
-- NOTE ON UNIQUENESS: the index below is deliberately NOT unique. Duplicates
-- already exist in this table, so a unique index would fail to build (and would
-- start rejecting webhook writes for pairs that were legitimately created
-- earlier). Uniqueness is enforceable only after the existing duplicates are
-- merged — that is the follow-up step, together with the merge UI.

BEGIN;

-- Same rules as normalizeIsraeliPhone() in src/utils/phoneUtils.js, kept
-- IMMUTABLE so it can be used in an index or a generated expression.
CREATE OR REPLACE FUNCTION public.normalize_il_phone(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH d AS (SELECT regexp_replace(coalesce(raw, ''), '\D', '', 'g') AS digits)
  SELECT CASE
    WHEN digits = '' THEN NULL
    -- local mobile 05XXXXXXXX → 9725XXXXXXX
    WHEN digits LIKE '05%' AND length(digits) = 10 THEN '972' || substr(digits, 2)
    -- already international mobile
    WHEN digits LIKE '9725%' AND length(digits) = 12 THEN digits
    -- local landline / VoIP 0XXXXXXXX
    WHEN digits LIKE '0%' AND length(digits) IN (9, 10) THEN '972' || substr(digits, 2)
    -- international, any Israeli prefix
    WHEN digits LIKE '972%' AND length(digits) BETWEEN 11 AND 12 THEN digits
    -- anything else: keep the digits so two identical inputs still collide
    ELSE digits
  END
  FROM d;
$$;

COMMENT ON FUNCTION public.normalize_il_phone(text) IS
  'Israeli phone → canonical 972XXXXXXXXX key. Mirrors normalizeIsraeliPhone() in src/utils/phoneUtils.js.';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_normalized text;

COMMENT ON COLUMN public.leads.phone_normalized IS
  'Canonical form of phone (972XXXXXXXXX), maintained by trigger. Use this to match/dedupe leads by phone — never the raw phone column.';

CREATE OR REPLACE FUNCTION public.leads_sync_phone_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_normalized := public.normalize_il_phone(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_phone_normalized_sync ON public.leads;
CREATE TRIGGER leads_phone_normalized_sync
  BEFORE INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.leads_sync_phone_normalized();

-- Backfill existing rows (single pass; the WHERE keeps it a no-op on re-run).
UPDATE public.leads
SET phone_normalized = public.normalize_il_phone(phone)
WHERE phone_normalized IS DISTINCT FROM public.normalize_il_phone(phone);

-- Equality lookups on the canonical key: the duplicate check on every write
-- path, and the phone search in the UI.
CREATE INDEX IF NOT EXISTS leads_phone_normalized_idx
  ON public.leads (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- Duplicate groups, for the merge step and for "how bad is it" reporting.
-- A view (not a materialized one) so it's always current; it is only ever read
-- by an admin screen, not on a hot path.
CREATE OR REPLACE VIEW public.lead_phone_duplicates AS
SELECT
  phone_normalized,
  count(*)::bigint AS lead_count,
  min(created_date) AS first_created,
  max(effective_sort_date) AS last_activity,
  array_agg(id ORDER BY created_date) AS lead_ids
FROM public.leads
WHERE phone_normalized IS NOT NULL
GROUP BY phone_normalized
HAVING count(*) > 1;

COMMENT ON VIEW public.lead_phone_duplicates IS
  'Leads sharing one canonical phone. Input for the merge flow; read by admin screens only.';

GRANT SELECT ON public.lead_phone_duplicates TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
