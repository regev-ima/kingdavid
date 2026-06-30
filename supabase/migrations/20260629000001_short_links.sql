-- Branded short links for shared documents (WhatsApp / SMS / email).
--
-- Instead of pasting the long public Supabase PDF URL into a message, the app
-- creates a short code here and shares a branded link (e.g.
-- https://doc.kingdavid4u.co.il/Ab12cd) that a tiny Cloudflare Worker resolves:
-- it reads this row, returns an Open-Graph branded preview page, and redirects
-- to target_url. So the customer sees a short, branded link with a nice
-- WhatsApp preview — never "supabase.co".
--
-- Resolving a code is public (the target PDF is already a public URL anyway),
-- so the Worker can read with the anon key. Only logged-in users create links.

CREATE TABLE IF NOT EXISTS public.short_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  target_url  text NOT NULL,
  title       text,
  subtitle    text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_short_links_code ON public.short_links (code);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS short_links_select ON public.short_links;
CREATE POLICY short_links_select ON public.short_links
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS short_links_insert ON public.short_links;
CREATE POLICY short_links_insert ON public.short_links
  FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT ON public.short_links TO anon, authenticated;
GRANT INSERT ON public.short_links TO authenticated;

NOTIFY pgrst, 'reload schema';
