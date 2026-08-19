-- Repair the product image URLs that point at files which were never there.
--
-- The audit (product-images-audit workflow, run #1) showed every broken
-- reference is an upholstered-bed product whose URLs were recorded as
-- "<folder>/N.jpg" while the files really uploaded are "<folder>/<name>-0N.jpg"
-- — e.g. kd/1.jpg vs kd/kd-01.jpg, cube/3.jpg vs cube/cube-2-03.jpg, and
-- yahalom/1.jpg vs yahalom/unknown-l0ti-01.jpg. Same folder, same ordinal,
-- different file name.
--
-- So the repair resolves each broken "<folder>/N.jpg" to the object in that
-- folder whose name ends in -N.jpg / -0N.jpg, and rewrites the product's URL
-- to it. A reference that resolves to nothing (colini recorded nine images,
-- one was ever uploaded) is dropped from the gallery, and a cover left with
-- no file falls back to the first image that does exist in its folder.
-- URLs pointing outside product-images, and ones whose object exists, are
-- not touched.
--
-- Idempotent: after the first run no URL matches the broken shape any more,
-- so re-running finds nothing to do.

BEGIN;

-- Does this bucket path exist as-is? (%20 decoded, like the audit.)
CREATE FUNCTION pg_temp.img_exists(p text) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'product-images'
        AND o.name = replace(p, '%20', ' ')
    )
  $$;

-- Resolve a broken "<folder>/N.jpg" to the real object: same folder, name
-- ending in -N.jpg (zero-padded or not). Only that exact broken shape is
-- eligible; anything else resolves to NULL and is left for the caller.
CREATE FUNCTION pg_temp.img_resolve(p text) RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT o.name
    FROM storage.objects o
    WHERE p ~ '^[A-Za-z0-9_-]+/[0-9]+\.jpg$'
      AND o.bucket_id = 'product-images'
      AND o.name ~ ('^' || split_part(p, '/', 1) || '/.*-0*'
                    || regexp_replace(split_part(p, '/', 2), '\.jpg$', '')
                    || '\.jpg$')
    ORDER BY o.name
    LIMIT 1
  $$;

-- The path after /product-images/, and the prefix before it, so a rewritten
-- URL keeps whatever host the original carried.
CREATE FUNCTION pg_temp.img_path(u text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(u, '/product-images/', 2) $$;
CREATE FUNCTION pg_temp.img_base(u text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(u, '/product-images/', 1) || '/product-images/' $$;

-- 1. Covers: broken and resolvable → rewrite in place. -----------------------
UPDATE public.products p
SET image_url = pg_temp.img_base(p.image_url) || pg_temp.img_resolve(pg_temp.img_path(p.image_url))
WHERE p.image_url LIKE '%/product-images/%'
  AND NOT pg_temp.img_exists(pg_temp.img_path(p.image_url))
  AND pg_temp.img_resolve(pg_temp.img_path(p.image_url)) IS NOT NULL;

-- 2. Covers still broken (nothing to resolve to): fall back to the first
--    image that really exists in the same folder, so the product card shows
--    SOMETHING rather than a broken icon. If the folder is empty, leave the
--    URL alone — a visible gap beats silently blanking a field.
UPDATE public.products p
SET image_url = pg_temp.img_base(p.image_url) || (
  SELECT o.name FROM storage.objects o
  WHERE o.bucket_id = 'product-images'
    AND o.name LIKE split_part(pg_temp.img_path(p.image_url), '/', 1) || '/%'
  ORDER BY o.name
  LIMIT 1
)
WHERE p.image_url LIKE '%/product-images/%'
  AND NOT pg_temp.img_exists(pg_temp.img_path(p.image_url))
  AND EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'product-images'
      AND o.name LIKE split_part(pg_temp.img_path(p.image_url), '/', 1) || '/%'
  );

-- 3. Galleries: rewrite the resolvable, drop the truly nonexistent, keep
--    order and every URL that was already fine (other buckets included).
UPDATE public.products p
SET images = (
  SELECT COALESCE(array_agg(x.new_url ORDER BY g.ord), '{}'::text[])
  FROM unnest(p.images) WITH ORDINALITY AS g(url, ord)
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN g.url NOT LIKE '%/product-images/%' THEN g.url
      WHEN pg_temp.img_exists(pg_temp.img_path(g.url)) THEN g.url
      WHEN pg_temp.img_resolve(pg_temp.img_path(g.url)) IS NOT NULL
        THEN pg_temp.img_base(g.url) || pg_temp.img_resolve(pg_temp.img_path(g.url))
      ELSE NULL
    END AS new_url
  ) x
  WHERE x.new_url IS NOT NULL
)
WHERE EXISTS (
  SELECT 1 FROM unnest(p.images) AS g(url)
  WHERE g.url LIKE '%/product-images/%'
    AND NOT pg_temp.img_exists(pg_temp.img_path(g.url))
);

COMMIT;
