#!/usr/bin/env node
/**
 * Backfill geocoding on every shipment that has no lat/lng yet.
 * Calls Google Maps Geocoding API directly (not the edge function) so it
 * can be run during dev without deploying the function first.
 *
 * Usage:
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   GOOGLE_MAPS_API_KEY=... \
 *     node scripts/geocodeSeedShipments.mjs
 *
 * Processes in batches of 25. Skips rows that already have latitude+longitude
 * unless you pass --force.
 */

import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_MAPS_API_KEY,
} = process.env;

const FORCE = process.argv.includes('--force');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}
if (!GOOGLE_MAPS_API_KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function geocodeOne(address, city) {
  const query = [address, city, 'Israel'].filter(Boolean).join(', ');
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'il');
  url.searchParams.set('language', 'iw');
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

  const resp = await fetch(url.toString());
  const body = await resp.json();

  if (body.status === 'ZERO_RESULTS') return { status: 'failed', error: 'ZERO_RESULTS' };
  if (body.status !== 'OK' || !body.results?.length) {
    return { status: 'failed', error: body.error_message || body.status };
  }
  const top = body.results[0];
  return {
    status: top.partial_match ? 'partial' : 'ok',
    latitude: top.geometry.location.lat,
    longitude: top.geometry.location.lng,
    formatted: top.formatted_address,
  };
}

async function main() {
  let query = supabase
    .from('delivery_shipments')
    .select('id, shipment_number, address, city, latitude, longitude');

  if (!FORCE) {
    query = query.or('latitude.is.null,longitude.is.null');
  }

  const { data: shipments, error } = await query;
  if (error) {
    console.error('Fetch failed:', error);
    process.exit(1);
  }

  console.log(`Found ${shipments.length} shipments to geocode${FORCE ? ' (--force)' : ''}.`);
  if (shipments.length === 0) return;

  const summary = { ok: 0, partial: 0, failed: 0, no_address: 0 };

  for (const shipment of shipments) {
    if (!shipment.address && !shipment.city) {
      await supabase
        .from('delivery_shipments')
        .update({
          geocoded_at: new Date().toISOString(),
          geocode_status: 'no_address',
        })
        .eq('id', shipment.id);
      summary.no_address++;
      continue;
    }

    try {
      const result = await geocodeOne(shipment.address, shipment.city);
      const update = {
        geocoded_at: new Date().toISOString(),
        geocode_status: result.status,
      };
      if (result.latitude != null && result.longitude != null) {
        update.latitude = result.latitude;
        update.longitude = result.longitude;
      }
      await supabase.from('delivery_shipments').update(update).eq('id', shipment.id);

      summary[result.status] = (summary[result.status] || 0) + 1;
      const label = result.status.padEnd(7);
      const coords = result.latitude != null
        ? `${result.latitude.toFixed(4)},${result.longitude.toFixed(4)}`
        : '(no coords)';
      console.log(`  ${label} ${shipment.shipment_number}  ${shipment.city} - ${shipment.address}  →  ${coords}`);
    } catch (err) {
      summary.failed++;
      console.error(`  FAIL    ${shipment.shipment_number}:`, err.message);
    }
  }

  console.log('\nSummary:');
  Object.entries(summary).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
