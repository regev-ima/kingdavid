-- Add products.technologies (jsonb array of {name, description} objects) and
-- expose it through the website_get_products() RPC so the website's
-- "בתוך המזרן" / "Inside the mattress" accordion has a structured source.
--
-- features is already text on products and already returned by the RPC, so it
-- needs no migration — the CRM UI adds the editor for it in the same PR.

BEGIN;

-- 1. Column ---------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS technologies jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. RPC ------------------------------------------------------------
-- Re-create the RPC with technologies appended to RETURNS TABLE and SELECT.
-- All other columns, ORDER BY, filters, SECURITY DEFINER and search_path
-- are preserved verbatim.
CREATE OR REPLACE FUNCTION public.website_get_products()
 RETURNS TABLE(
    id                   uuid,
    name                 text,
    description          text,
    sku                  text,
    category             text,
    bed_type             text,
    image_url            text,
    images               text[],
    warranty_years       integer,
    features             text,
    hardness             integer,
    has_trial_period     boolean,
    default_variation_id uuid,
    created_date         timestamp with time zone,
    website_categories   text[],
    is_on_sale           boolean,
    discount_type        text,
    discount_value       numeric,
    sale_starts_at       timestamp with time zone,
    sale_ends_at         timestamp with time zone,
    variations           jsonb,
    technologies         jsonb
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.name,
    p.description,
    p.sku,
    p.category,
    CASE
      WHEN p.bed_type IS NULL THEN NULL
      WHEN array_length(p.bed_type, 1) IS NULL THEN NULL
      ELSE p.bed_type[1]
    END AS bed_type,
    p.image_url,
    COALESCE(p.images, '{}'::text[]) AS images,
    p.warranty_years,
    p.features,
    p.hardness,
    COALESCE(p.has_trial_period, false) AS has_trial_period,
    p.default_variation_id,
    p.created_date,
    COALESCE(p.website_categories, '{}'::text[]) AS website_categories,
    COALESCE(p.is_on_sale, false)                AS is_on_sale,
    p.discount_type,
    p.discount_value,
    p.sale_starts_at,
    p.sale_ends_at,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id',         v.id,
        'product_id', v.product_id,
        'name',       v.name,
        'sku',        v.sku,
        'base_price', v.base_price,
        'final_price',v.final_price,
        'width_cm',   v.width_cm,
        'length_cm',  v.length_cm,
        'is_active',  v.is_active
      ))
      FROM public.product_variations v
      WHERE v.product_id = p.id AND v.is_active = true),
      '[]'::jsonb
    ) AS variations,
    COALESCE(p.technologies, '[]'::jsonb) AS technologies
  FROM public.products p
  WHERE p.is_active = true
  ORDER BY p.created_date DESC;
$function$;

COMMIT;
