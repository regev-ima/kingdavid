import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

// ---------------------------------------------------------------------------
// geocodeShipment - Google Maps Geocoding for delivery_shipments.
//
// Input:  { shipmentId: string }       OR
//         { shipmentIds: string[] }    (max 50 per call)
//
// For each shipment:
//   1. Build query from `${address}, ${city}, Israel`
//   2. Call Google Geocoding API
//   3. Persist result to delivery_shipments:
//        - success           → latitude, longitude, geocode_status='ok'
//        - partial match     → latitude, longitude, geocode_status='partial'
//        - zero results      → geocode_status='failed'
//        - missing address   → geocode_status='no_address'
//   4. Always stamp geocoded_at = now()
//
// Requires Supabase secret: GOOGLE_MAPS_API_KEY
// ---------------------------------------------------------------------------

interface ShipmentRow {
  id: string;
  address: string | null;
  city: string | null;
  [key: string]: unknown;
}

interface GeocodeResult {
  shipmentId: string;
  status: 'ok' | 'failed' | 'partial' | 'no_address';
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  error?: string;
}

async function geocodeOne(
  apiKey: string,
  shipment: ShipmentRow,
): Promise<GeocodeResult> {
  const address = (shipment.address || '').trim();
  const city = (shipment.city || '').trim();

  if (!address && !city) {
    return { shipmentId: shipment.id, status: 'no_address', error: 'חסרה כתובת ועיר' };
  }

  const query = [address, city, 'Israel'].filter(Boolean).join(', ');
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'il');
  url.searchParams.set('language', 'iw'); // Hebrew response components
  url.searchParams.set('key', apiKey);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    return {
      shipmentId: shipment.id,
      status: 'failed',
      error: `HTTP ${resp.status}`,
    };
  }

  const body = await resp.json() as {
    status: string;
    results: Array<{
      formatted_address: string;
      partial_match?: boolean;
      geometry: { location: { lat: number; lng: number } };
    }>;
    error_message?: string;
  };

  if (body.status === 'ZERO_RESULTS') {
    return { shipmentId: shipment.id, status: 'failed', error: 'ZERO_RESULTS' };
  }
  if (body.status !== 'OK' || !body.results?.length) {
    return {
      shipmentId: shipment.id,
      status: 'failed',
      error: body.error_message || body.status,
    };
  }

  const top = body.results[0];
  return {
    shipmentId: shipment.id,
    status: top.partial_match ? 'partial' : 'ok',
    latitude: top.geometry.location.lat,
    longitude: top.geometry.location.lng,
    formattedAddress: top.formatted_address,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await getUser(req);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json(
        { error: 'GOOGLE_MAPS_API_KEY not configured on server' },
        { status: 500, headers: corsHeaders },
      );
    }

    const body = await req.json();
    const ids: string[] = body.shipmentIds
      ? Array.isArray(body.shipmentIds) ? body.shipmentIds : []
      : body.shipmentId ? [body.shipmentId] : [];

    if (ids.length === 0) {
      return Response.json(
        { error: 'שדה shipmentId או shipmentIds חובה' },
        { status: 400, headers: corsHeaders },
      );
    }
    if (ids.length > 50) {
      return Response.json(
        { error: 'מקסימום 50 משלוחים לקריאה' },
        { status: 400, headers: corsHeaders },
      );
    }

    const supabase = createServiceClient();

    const { data: shipments, error: fetchError } = await supabase
      .from('delivery_shipments')
      .select('id, address, city')
      .in('id', ids);

    if (fetchError) throw fetchError;
    if (!shipments || shipments.length === 0) {
      return Response.json({ results: [], summary: { ok: 0, failed: 0 } }, { headers: corsHeaders });
    }

    // Google Geocoding supports ~50 QPS on default quota, but we're polite
    // and run sequentially — this endpoint is only called for backfill or
    // on shipment save, not in hot paths.
    const results: GeocodeResult[] = [];
    for (const shipment of shipments as ShipmentRow[]) {
      try {
        const result = await geocodeOne(apiKey, shipment);
        results.push(result);

        const update: Record<string, unknown> = {
          geocoded_at: new Date().toISOString(),
          geocode_status: result.status,
        };
        if (result.latitude != null && result.longitude != null) {
          update.latitude = result.latitude;
          update.longitude = result.longitude;
        }

        const { error: updateError } = await supabase
          .from('delivery_shipments')
          .update(update)
          .eq('id', shipment.id);

        if (updateError) {
          console.error('update error', shipment.id, updateError);
        }
      } catch (err) {
        results.push({
          shipmentId: shipment.id,
          status: 'failed',
          error: (err as Error).message,
        });
      }
    }

    const summary = {
      ok: results.filter((r) => r.status === 'ok').length,
      partial: results.filter((r) => r.status === 'partial').length,
      failed: results.filter((r) => r.status === 'failed').length,
      no_address: results.filter((r) => r.status === 'no_address').length,
    };

    return Response.json({ results, summary }, { headers: corsHeaders });
  } catch (error) {
    console.error('geocodeShipment error:', error);
    return Response.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
