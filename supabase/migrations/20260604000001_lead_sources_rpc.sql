-- Distinct lead sources for the Lead Management "מקור" filter.
--
-- The leads.source column is free text holding raw values (google_ads,
-- Facebook Form, Outbrain, taboola, digital, …) that the hardcoded
-- LEAD_SOURCE_OPTIONS list never covered, so the filter could only offer a
-- handful of curated sources. This function returns every source actually
-- present, with its lead count, most-common first, so the UI can build the
-- full filter list dynamically.
--
-- SECURITY INVOKER (the default) so the caller's RLS applies: an admin sees
-- every source, a rep sees only sources present in leads they can access.
-- Idempotent via CREATE OR REPLACE, so the migration is safe to re-run.
CREATE OR REPLACE FUNCTION public.lead_sources()
RETURNS TABLE (source text, lead_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT l.source::text AS source, count(*)::bigint AS lead_count
  FROM public.leads l
  WHERE l.source IS NOT NULL AND btrim(l.source) <> ''
  GROUP BY l.source
  ORDER BY count(*) DESC, l.source ASC;
$$;

REVOKE ALL ON FUNCTION public.lead_sources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_sources() TO authenticated;

-- Reload PostgREST schema cache so the RPC is callable immediately.
NOTIFY pgrst, 'reload schema';
