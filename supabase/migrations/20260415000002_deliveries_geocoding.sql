-- Deliveries geocoding + region expansion
-- Adds latitude/longitude (populated by geocodeShipment edge function via Google Maps)
-- and seeds default delivery_routes for the 6 regions we use:
--   north, center, sharon, shomron, jerusalem, south
-- Delivery week is Sunday (0) through Thursday (4).

-- ---------------------------------------------------------------------------
-- 1. Geocoding columns on delivery_shipments
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_shipments
  ADD COLUMN IF NOT EXISTS latitude     numeric(10,7),
  ADD COLUMN IF NOT EXISTS longitude    numeric(10,7),
  ADD COLUMN IF NOT EXISTS geocoded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS geocode_status text
    CHECK (geocode_status IN ('ok', 'failed', 'partial', 'no_address'));

-- Index to speed up the optimizer's scheduled_date + status grouping.
CREATE INDEX IF NOT EXISTS delivery_shipments_schedule_idx
  ON public.delivery_shipments (scheduled_date, status);

-- Index on geocode_status so the backfill script can cheaply find ungeocoded rows.
CREATE INDEX IF NOT EXISTS delivery_shipments_geocode_status_idx
  ON public.delivery_shipments (geocode_status)
  WHERE geocode_status IS NULL OR geocode_status <> 'ok';

-- ---------------------------------------------------------------------------
-- 2. Default delivery_routes for all 6 regions
-- ---------------------------------------------------------------------------
-- Policy: one default active route per region, Sun-Thu (days 0-4).
-- Only INSERT if no active route exists for that region yet, so this migration
-- is safe to re-run and will not overwrite whatever the user configured later.
DO $$
DECLARE
  v_region text;
  v_regions jsonb := '[
    {"key":"north",     "name":"צפון",    "color":"blue"},
    {"key":"center",    "name":"מרכז",    "color":"green"},
    {"key":"sharon",    "name":"שרון",    "color":"purple"},
    {"key":"shomron",   "name":"שומרון",  "color":"orange"},
    {"key":"jerusalem", "name":"ירושלים", "color":"pink"},
    {"key":"south",     "name":"דרום",    "color":"blue"}
  ]'::jsonb;
  v_row jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_regions)
  LOOP
    v_region := v_row->>'key';
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_routes
      WHERE region = v_region AND is_active = true
    ) THEN
      INSERT INTO public.delivery_routes
        (name, region, active_days, capacity_pallets, truck_identifiers,
         default_carrier, color, notes, is_active)
      VALUES
        (
          'מסלול ' || (v_row->>'name'),
          v_region,
          CASE v_region
            WHEN 'north'     THEN ARRAY[1, 3]      -- שני + רביעי
            WHEN 'center'    THEN ARRAY[0, 2, 4]   -- ראשון + שלישי + חמישי
            WHEN 'sharon'    THEN ARRAY[1, 3]      -- שני + רביעי
            WHEN 'shomron'   THEN ARRAY[2]         -- שלישי
            WHEN 'jerusalem' THEN ARRAY[0, 3]      -- ראשון + רביעי
            WHEN 'south'     THEN ARRAY[0, 2, 4]   -- ראשון + שלישי + חמישי
          END,
          20,                       -- capacity_pallets (placeholder, admin can edit)
          ARRAY[]::text[],
          'קינג דיוויד',            -- default_carrier
          v_row->>'color',
          'נוצר אוטומטית ע"י מיגרציה — ניתן לערוך',
          true
        );
    END IF;
  END LOOP;
END $$;

-- Reload PostgREST schema cache so the new columns are visible to the API.
NOTIFY pgrst, 'reload schema';
