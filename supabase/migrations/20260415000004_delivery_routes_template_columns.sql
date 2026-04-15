-- Add route-template columns to delivery_routes.
--
-- The production delivery_routes table stored per-day route runs:
--   id, created_date, updated_date, route_date, driver, shipment_ids, status, notes
--
-- The deliveries-area UI (RoutesManager, SmartScheduler) and the
-- scheduleShipments edge function all assume a *template* shape instead:
--   name, region, active_days, capacity_pallets, truck_identifiers,
--   default_carrier, color, is_active
--
-- Rather than split the table, we extend it with the template columns (all
-- nullable so existing rows keep working), then seed the 6 default regional
-- routes. A row that has `region` + `active_days` acts as a template; a row
-- that has `route_date` + `driver` + `shipment_ids` acts as a single run.

-- ---------------------------------------------------------------------------
-- 1. Template columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_routes
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS active_days integer[],
  ADD COLUMN IF NOT EXISTS capacity_pallets integer,
  ADD COLUMN IF NOT EXISTS truck_identifiers text[],
  ADD COLUMN IF NOT EXISTS default_carrier text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Seed one default active route per region (idempotent)
-- ---------------------------------------------------------------------------
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
         default_carrier, color, is_active)
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
          20,
          ARRAY[]::text[],
          'קינג דיוויד',
          v_row->>'color',
          true
        );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
