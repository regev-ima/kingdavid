-- Make the "מקור הגעה" filter on ניהול לידים actually find leads.
--
-- `leads.source` is not a controlled vocabulary — it holds whatever the
-- campaign was named: "גוגל דף חדש עלית - ליד" (13,599 leads), "Facebook Form",
-- "fb", "Outbrain", plus the handful of picker keys (`store`, `website`) that
-- almost nothing uses. The list's badge column solves this by DERIVING a
-- channel from the raw text (src/constants/sourceChannels.js), but the filter
-- kept comparing `source = 'website'` verbatim — so picking "אתר" returned
-- nothing while the list visibly showed אתר badges. The filter and the badge
-- were answering different questions.
--
-- This migration gives the filter the badge's answer, server-side:
--
--   • lead_source_channel(text)   — the channel a raw source string resolves
--     to. A SQL mirror of CHANNEL_RULES in src/constants/sourceChannels.js:
--     same patterns, same first-match-wins order, same lower/trim, same
--     'unknown' fallback. Change one, change the other.
--   • source_channel(leads)       — PostgREST computed column over it, so the
--     client can filter and count on `source_channel=eq.google` exactly like a
--     real column (same mechanism as arrival_hour_il).
--   • an expression index          — the filter is also offered under
--     "כל הזמנים", where no date range narrows the scan first.
--
-- The index stores values computed by lead_source_channel at write time, so a
-- future migration that CHANGES the rules must also REINDEX
-- leads_source_channel_idx — CREATE OR REPLACE alone would leave the index
-- answering with the old rules.
--
-- Idempotent: CREATE OR REPLACE + CREATE INDEX IF NOT EXISTS.

BEGIN;

-- Index builds on a 125k-row table can run past the default API timeout.
SET LOCAL statement_timeout = '600s';

CREATE OR REPLACE FUNCTION public.lead_source_channel(src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- Mirrors CHANNEL_RULES: checked top to bottom, first match wins, so a value
  -- naming two channels ("פייסבוק , גוגל , שיחה נכנסת") resolves to the same
  -- one the badge shows. `s` is the raw value lowered and trimmed, exactly as
  -- resolveSourceChannel() prepares it.
  SELECT CASE
    WHEN s = '' THEN 'unknown'
    WHEN s ~ 'גוגל|^google' OR s IN ('דיגיטל', 'digital') THEN 'google'
    WHEN s ~ 'פייסבוק|פייסב|פייסוק|facebook' OR s = 'fb' THEN 'facebook'
    WHEN s ~ 'אינסטגרם|instagram' OR s = 'ig' THEN 'instagram'
    WHEN s ~ 'טיקטוק|tiktok' THEN 'tiktok'
    WHEN s ~ 'וטסאפ|ואטסאפ|ואטפס|ואטאפס|whatsapp' THEN 'whatsapp'
    WHEN s ~ 'טאבולה|אאוטבריין|outbrain|taboola' THEN 'outbrain'
    WHEN s ~ 'טלגרם|telegram' THEN 'telegram'
    WHEN s ~ 'שיחה נכנסת' OR s IN ('שיחה', 'callcenter', 'מוקד') THEN 'callcenter'
    WHEN s ~ 'כניסה לחנות' OR s IN ('store', 'חנות') THEN 'store'
    WHEN s ~ 'אתר|דף נחיתה' OR s = 'website' THEN 'website'
    WHEN s ~ 'לקוח חוזר|לקוחה חוזרת'
      OR s IN ('הפניה', 'חבר', 'לקוח', 'חברה', 'referral', 'returning_customer') THEN 'referral'
    WHEN s ~ 'שירות לקוחות' THEN 'service'
    ELSE 'unknown'
  END
  -- The trim set covers what String.trim() strips from real data: ASCII
  -- whitespace plus the NBSP (\u00a0) and BOM (\ufeff) that ride in on
  -- copy-paste and CSV imports.
  FROM (SELECT lower(btrim(coalesce(src, ''), E' \t\r\n\u00a0\ufeff'))) AS t(s)
$$;

COMMENT ON FUNCTION public.lead_source_channel(text) IS
  'Channel a raw leads.source string resolves to (google/facebook/…/unknown). SQL mirror of CHANNEL_RULES in src/constants/sourceChannels.js — keep the two in sync, and REINDEX leads_source_channel_idx when the rules change.';

-- The computed column PostgREST exposes: filtering `source_channel=eq.google`
-- inlines to lead_source_channel(leads.source), which is what the index below
-- indexes.
CREATE OR REPLACE FUNCTION public.source_channel(public.leads)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.lead_source_channel($1.source);
$$;

COMMENT ON FUNCTION public.source_channel(public.leads) IS
  'PostgREST computed column: the arrival channel of a lead, derived from the free-text source. Used by the מקור הגעה filter on ניהול לידים.';

GRANT EXECUTE ON FUNCTION public.lead_source_channel(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.source_channel(public.leads) TO authenticated, anon, service_role;

CREATE INDEX IF NOT EXISTS leads_source_channel_idx
  ON public.leads (public.lead_source_channel(source));

NOTIFY pgrst, 'reload schema';

COMMIT;
