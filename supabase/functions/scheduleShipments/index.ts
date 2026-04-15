import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

// ---------------------------------------------------------------------------
// Depot (factory origin) - all routes start here each delivery day.
// ---------------------------------------------------------------------------
const DEPOT = {
  name: 'קריית מלאכי (מפעל)',
  lat: 31.7296,
  lon: 34.7467,
};

// ---------------------------------------------------------------------------
// City → region map. Mirrors src/components/utils/cityRegionMapper.jsx.
// Order of the map matters: we check sharon/shomron/jerusalem before
// center/north/south so a city like רעננה is classified as sharon, not center.
// ---------------------------------------------------------------------------
function getCityRegionDynamic(cityName: string | null): string | null {
  if (!cityName) return null;
  const normalizedCity = cityName.trim();

  const cityRegions: Array<[string, string[]]> = [
    ['sharon', [
      'רעננה', 'כפר סבא', 'הוד השרון', 'תל מונד', 'קדימה צורן', 'קדימה', 'צורן',
      'אבן יהודה', 'שערי תקווה', 'אלפי מנשה', 'אייל', 'גן חיים', 'בני ציון',
      'נורדיה', 'כפר יונה', 'גאולים',
    ]],
    ['shomron', [
      'אריאל', 'קרני שומרון', 'עמנואל', 'ברקן', 'קדומים', 'עלי זהב',
      'פדואל', 'בית אריה', 'אורנית', 'אלקנה', 'יקיר', 'שבי שומרון',
      'איתמר', 'עלי', 'שילה', 'מעלה לבונה', 'רחלים',
    ]],
    ['jerusalem', [
      'ירושלים', 'בית שמש', 'מעלה אדומים', 'מבשרת ציון', 'אבו גוש',
      'גוש עציון', 'אפרת', 'בית אל', 'ביתר עילית', 'צור הדסה', 'הר אדר',
    ]],
    ['north', [
      'חיפה', 'קריית ים', 'קריית מוצקין', 'קריית ביאליק', 'קריית אתא', 'נשר',
      'טירת כרמל', 'עספיא', 'דלית אל כרמל',
      'נהריה', 'עכו', 'צפת', 'קריית שמונה', 'כרמיאל', 'מעלות תרשיחא',
      'נצרת', 'נצרת עילית', 'טבריה', 'בית שאן', 'עפולה', 'מגדל העמק',
      'יוקנעם', 'יקנעם עילית', 'שפרעם', 'סחנין', 'טמרה', 'ראמה',
      'רמת ישי', 'חדרה', 'אור עקיבא', 'זכרון יעקב', 'בנימינה', 'קיסריה',
      'חריש', 'פרדס חנה כרכור', 'פרדס חנה',
    ]],
    ['south', [
      'באר שבע', 'אשדוד', 'אשקלון', 'קריית גת', 'קרית גת', 'שדרות', 'נתיבות',
      'אילת', 'דימונה', 'ערד', 'עראד', 'אופקים',
      'קריית מלאכי', 'קרית מלאכי',
      'גדרות', 'מצפה רמון', 'רהט', 'תל שבע',
      'להבים', 'עומר', 'מיתר', 'ניר עוז',
    ]],
    ['center', [
      'תל אביב', 'תל אביב יפו', 'רמת גן', 'גבעתיים', 'בני ברק', 'חולון', 'בת ים',
      'רמת השרון', 'הרצליה', 'אור יהודה', 'קריית אונו', 'גבעת שמואל',
      'נתניה',
      'פתח תקווה', 'ראש העין', 'אלעד', 'יהוד מונוסון', 'יהוד',
      'ראשון לציון', 'רחובות', 'נס ציונה', 'יבנה', 'גדרה', 'רמלה', 'לוד',
      'מודיעין', 'מודיעין מכבים רעות', 'שוהם', 'מזכרת בתיה', 'קרית עקרון',
      'גן יבנה', 'באר יעקב',
    ]],
  ];

  for (const [region, cities] of cityRegions) {
    const found = cities.find(
      (city) => normalizedCity.includes(city) || city.includes(normalizedCity),
    );
    if (found) return region;
  }

  return null;
}

// ---------------------------------------------------------------------------
// City-center coordinates. Used ONLY as fallback when a shipment has no
// geocoded lat/lng yet (e.g. before geocodeShipment has run on it).
// Once geocodeShipment populates shipment.latitude/longitude, the optimizer
// uses those instead — which gives sub-city (street-level) ordering.
// ---------------------------------------------------------------------------
const cityCoordinates: Record<string, { lat: number; lon: number }> = {
  // North
  'חיפה': { lat: 32.80, lon: 35.00 },
  'נהריה': { lat: 33.00, lon: 35.10 },
  'טבריה': { lat: 32.79, lon: 35.53 },
  'עפולה': { lat: 32.61, lon: 35.29 },
  'כרמיאל': { lat: 32.92, lon: 35.29 },
  'עכו': { lat: 32.93, lon: 35.08 },
  'צפת': { lat: 32.97, lon: 35.50 },
  'קריית שמונה': { lat: 33.21, lon: 35.57 },
  'נצרת': { lat: 32.70, lon: 35.30 },
  'קריית מוצקין': { lat: 32.84, lon: 35.08 },
  'קריית ים': { lat: 32.85, lon: 35.07 },
  'קריית ביאליק': { lat: 32.83, lon: 35.08 },
  'קריית אתא': { lat: 32.81, lon: 35.11 },
  'מגדל העמק': { lat: 32.68, lon: 35.24 },
  'נצרת עילית': { lat: 32.71, lon: 35.32 },
  'יקנעם': { lat: 32.66, lon: 35.11 },
  'בית שאן': { lat: 32.50, lon: 35.50 },
  'חדרה': { lat: 32.44, lon: 34.92 },
  'אור עקיבא': { lat: 32.50, lon: 34.92 },
  'פרדס חנה': { lat: 32.47, lon: 34.97 },
  'זכרון יעקב': { lat: 32.57, lon: 34.95 },
  'בנימינה': { lat: 32.52, lon: 34.95 },
  'קיסריה': { lat: 32.51, lon: 34.90 },
  'חריש': { lat: 32.47, lon: 35.04 },

  // Sharon
  'רעננה': { lat: 32.184, lon: 34.871 },
  'כפר סבא': { lat: 32.175, lon: 34.907 },
  'הוד השרון': { lat: 32.15, lon: 34.89 },
  'תל מונד': { lat: 32.25, lon: 34.92 },
  'קדימה צורן': { lat: 32.28, lon: 34.93 },
  'קדימה': { lat: 32.28, lon: 34.93 },
  'אבן יהודה': { lat: 32.27, lon: 34.89 },
  'אלפי מנשה': { lat: 32.17, lon: 34.98 },
  'שערי תקווה': { lat: 32.13, lon: 34.99 },
  'אורנית': { lat: 32.11, lon: 35.00 },
  'כפר יונה': { lat: 32.32, lon: 34.93 },

  // Shomron
  'אריאל': { lat: 32.104, lon: 35.173 },
  'קרני שומרון': { lat: 32.17, lon: 35.10 },
  'עמנואל': { lat: 32.16, lon: 35.13 },
  'ברקן': { lat: 32.14, lon: 35.12 },
  'קדומים': { lat: 32.22, lon: 35.10 },
  'אלקנה': { lat: 32.10, lon: 35.08 },
  'בית אריה': { lat: 32.05, lon: 35.06 },
  'עלי זהב': { lat: 32.06, lon: 35.07 },
  'פדואל': { lat: 32.09, lon: 35.05 },

  // Jerusalem
  'ירושלים': { lat: 31.78, lon: 35.22 },
  'מעלה אדומים': { lat: 31.78, lon: 35.30 },
  'בית שמש': { lat: 31.74, lon: 34.99 },
  'מבשרת ציון': { lat: 31.80, lon: 35.14 },
  'ביתר עילית': { lat: 31.69, lon: 35.12 },
  'גוש עציון': { lat: 31.65, lon: 35.12 },
  'אפרת': { lat: 31.65, lon: 35.15 },

  // Center
  'תל אביב': { lat: 32.08, lon: 34.78 },
  'נתניה': { lat: 32.33, lon: 34.86 },
  'פתח תקווה': { lat: 32.09, lon: 34.89 },
  'רמת גן': { lat: 32.07, lon: 34.82 },
  'רחובות': { lat: 31.89, lon: 34.81 },
  'ראשון לציון': { lat: 31.97, lon: 34.80 },
  'הרצליה': { lat: 32.16, lon: 34.84 },
  'הוד השרון-': { lat: 32.15, lon: 34.89 },
  'מודיעין': { lat: 31.90, lon: 35.01 },
  'חולון': { lat: 32.01, lon: 34.77 },
  'בני ברק': { lat: 32.08, lon: 34.83 },
  'בת ים': { lat: 32.02, lon: 34.75 },
  'גבעתיים': { lat: 32.07, lon: 34.81 },
  'רמת השרון': { lat: 32.15, lon: 34.84 },
  'ראש העין': { lat: 32.09, lon: 34.95 },
  'לוד': { lat: 31.95, lon: 34.89 },
  'רמלה': { lat: 31.93, lon: 34.87 },
  'נס ציונה': { lat: 31.93, lon: 34.80 },
  'יבנה': { lat: 31.88, lon: 34.74 },
  'קריית אונו': { lat: 32.05, lon: 34.85 },
  'גבעת שמואל': { lat: 32.08, lon: 34.86 },
  'אור יהודה': { lat: 32.03, lon: 34.85 },
  'הרצליה פיתוח': { lat: 32.17, lon: 34.81 },

  // South
  'באר שבע': { lat: 31.25, lon: 34.79 },
  'אשדוד': { lat: 31.80, lon: 34.64 },
  'אשקלון': { lat: 31.67, lon: 34.57 },
  'קריית גת': { lat: 31.61, lon: 34.77 },
  'אילת': { lat: 29.55, lon: 34.95 },
  'דימונה': { lat: 31.07, lon: 35.03 },
  'ערד': { lat: 31.26, lon: 35.21 },
  'נתיבות': { lat: 31.42, lon: 34.59 },
  'שדרות': { lat: 31.52, lon: 34.59 },
  'אופקים': { lat: 31.31, lon: 34.62 },
  'קריית מלאכי': { lat: 31.73, lon: 34.75 },
  'רהט': { lat: 31.39, lon: 34.75 },
};

interface ShipmentWithCoords {
  id: string;
  city: string;
  customer_name?: string;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

// Return the best-available coordinates for a shipment:
// 1. Geocoded lat/lng from the shipment row (street-level precision).
// 2. Fallback: city-center from cityCoordinates (city-level precision).
// 3. Last resort: { lat: 0, lon: 0 } - triggers default distance.
function coordsFor(shipment: ShipmentWithCoords): { lat: number; lon: number } | null {
  if (shipment.latitude != null && shipment.longitude != null) {
    return { lat: Number(shipment.latitude), lon: Number(shipment.longitude) };
  }
  const cityCoords = cityCoordinates[shipment.city];
  if (cityCoords) return cityCoords;
  return null;
}

// Haversine-free approximation (Euclidean × 111 km/deg) — plenty accurate for
// the small geographic range of Israel and for TSP ordering purposes.
function distanceBetween(
  a: { lat: number; lon: number } | null,
  b: { lat: number; lon: number } | null,
): number {
  if (!a || !b) return 100; // fallback: penalize unknowns so they go last
  const latDiff = a.lat - b.lat;
  const lonDiff = a.lon - b.lon;
  return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111;
}

// Nearest-neighbor TSP starting from a fixed origin (the depot, or the last
// stop of the previous time-window segment).
function optimizeFromOrigin(
  origin: { lat: number; lon: number },
  shipments: ShipmentWithCoords[],
): ShipmentWithCoords[] {
  if (shipments.length === 0) return [];
  const remaining = [...shipments];
  const ordered: ShipmentWithCoords[] = [];
  let current = origin;

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    remaining.forEach((shipment, index) => {
      const dist = distanceBetween(current, coordsFor(shipment));
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestIndex = index;
      }
    });

    const next = remaining.splice(nearestIndex, 1)[0];
    ordered.push(next);
    current = coordsFor(next) ?? current;
  }

  return ordered;
}

// Order stops for a single delivery day:
//   depot → morning stops (optimized) → afternoon stops (optimized) → evening stops (optimized)
// This way a morning-only customer is never slotted between two afternoon stops.
const TIME_WINDOW_ORDER = ['morning', 'afternoon', 'evening', 'all_day', null];

function orderDayRoute(shipments: ShipmentWithCoords[]): ShipmentWithCoords[] {
  const buckets: Record<string, ShipmentWithCoords[]> = {};
  for (const s of shipments) {
    const key = (s.time_window as string | null) ?? 'all_day';
    (buckets[key] ??= []).push(s);
  }

  const ordered: ShipmentWithCoords[] = [];
  let origin = { lat: DEPOT.lat, lon: DEPOT.lon };

  for (const windowKey of TIME_WINDOW_ORDER) {
    if (!windowKey) continue;
    const bucket = buckets[windowKey];
    if (!bucket || bucket.length === 0) continue;
    const optimized = optimizeFromOrigin(origin, bucket);
    ordered.push(...optimized);
    // Next bucket continues from where this one ended.
    const lastCoords = coordsFor(optimized[optimized.length - 1]);
    if (lastCoords) origin = lastCoords;
  }

  return ordered;
}

function totalRouteDistance(origin: { lat: number; lon: number }, shipments: ShipmentWithCoords[]): number {
  let total = 0;
  let prev = origin;
  for (const s of shipments) {
    const c = coordsFor(s);
    total += distanceBetween(prev, c);
    if (c) prev = c;
  }
  return Math.round(total);
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

    const supabase = createServiceClient();
    const { shipmentIds } = await req.json();

    const [routesRes, ordersRes, allShipmentsRes] = await Promise.all([
      supabase.from('delivery_routes').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('delivery_shipments').select('*'),
    ]);

    if (routesRes.error) throw routesRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (allShipmentsRes.error) throw allShipmentsRes.error;

    const routes = routesRes.data ?? [];
    const orders = ordersRes.data ?? [];
    const allShipments = allShipmentsRes.data ?? [];

    const ordersMap: Record<string, any> = {};
    orders.forEach((order) => {
      ordersMap[order.id] = order;
    });

    const results: {
      success: number;
      failed: number;
      details: any[];
      optimizations: any[];
    } = { success: 0, failed: 0, details: [], optimizations: [] };

    // -----------------------------------------------------------------------
    // Step 1: basic scheduling (region match + next active day + SLA check)
    // -----------------------------------------------------------------------
    for (const shipmentId of shipmentIds) {
      try {
        const { data: shipment, error: shipmentError } = await supabase
          .from('delivery_shipments')
          .select('*')
          .eq('id', shipmentId)
          .single();

        if (shipmentError || !shipment) {
          results.failed++;
          results.details.push({ shipmentId, error: 'לא נמצא' });
          continue;
        }

        const shipmentRegion = getCityRegionDynamic(shipment.city);
        if (!shipmentRegion) {
          results.failed++;
          results.details.push({ shipmentId, error: `עיר לא מוכרת: ${shipment.city}` });
          continue;
        }

        const route = routes.find((r: any) => r.is_active && r.region === shipmentRegion);
        if (!route) {
          results.failed++;
          results.details.push({ shipmentId, error: `לא נמצא מסלול עבור ${shipment.city}` });
          continue;
        }

        // SLA deadline = order created + 14 business days
        const order = ordersMap[shipment.order_id];
        let slaDeadline: Date | null = null;
        if (order && order.created_date) {
          const orderDate = new Date(order.created_date);
          slaDeadline = new Date(orderDate);
          let businessDaysAdded = 0;
          while (businessDaysAdded < 14) {
            slaDeadline.setDate(slaDeadline.getDate() + 1);
            const dayOfWeek = slaDeadline.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
              businessDaysAdded++;
            }
          }
        }

        // Pick the earliest active day that still fits within SLA
        const today = new Date();
        let scheduledDate: Date | null = null;
        let foundValidDate = false;

        for (let daysAhead = 0; daysAhead < 28 && !foundValidDate; daysAhead++) {
          const checkDate = new Date(today);
          checkDate.setDate(checkDate.getDate() + daysAhead);
          const checkDay = checkDate.getDay();
          if (route.active_days && route.active_days.includes(checkDay)) {
            if (!slaDeadline || checkDate <= slaDeadline) {
              scheduledDate = checkDate;
              foundValidDate = true;
            }
          }
        }

        // If SLA can't be met, still schedule to the next active day
        if (!foundValidDate) {
          for (let daysAhead = 0; daysAhead < 28; daysAhead++) {
            const checkDate = new Date(today);
            checkDate.setDate(checkDate.getDate() + daysAhead);
            const checkDay = checkDate.getDay();
            if (route.active_days && route.active_days.includes(checkDay)) {
              scheduledDate = checkDate;
              foundValidDate = true;
              break;
            }
          }
        }

        if (!foundValidDate || !scheduledDate) {
          results.failed++;
          results.details.push({ shipmentId, error: 'לא נמצא יום פעיל במסלול' });
          continue;
        }

        const scheduledDateStr = scheduledDate.toISOString().split('T')[0];
        const slaWarning = slaDeadline ? scheduledDate > slaDeadline : false;

        const { error: updateError } = await supabase
          .from('delivery_shipments')
          .update({
            status: 'scheduled',
            scheduled_date: scheduledDateStr,
            // Preserve any time_window the admin already set; otherwise default to morning.
            time_window: shipment.time_window || 'morning',
            carrier: route.default_carrier || route.name,
          })
          .eq('id', shipmentId);

        if (updateError) throw updateError;

        results.success++;
        results.details.push({
          shipmentId,
          scheduledDate: scheduledDateStr,
          route: route.name,
          slaWarning,
        });
      } catch (error) {
        results.failed++;
        results.details.push({ shipmentId, error: (error as Error).message });
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: geographic route optimization.
    // For each (scheduled_date × carrier) group: order by time_window, and
    // within each window run nearest-neighbor starting from the depot (morning)
    // or from the last stop of the previous window.
    // -----------------------------------------------------------------------

    // Re-fetch: some shipments were just updated in step 1.
    const { data: refreshedShipments } = await supabase
      .from('delivery_shipments')
      .select('*')
      .eq('status', 'scheduled');

    const scheduledByDateAndRoute: Record<string, {
      date: string;
      carrier: string;
      shipments: ShipmentWithCoords[];
    }> = {};

    (refreshedShipments ?? allShipments)
      .filter((s: any) => s.status === 'scheduled' && s.scheduled_date)
      .forEach((shipment: any) => {
        const key = `${shipment.scheduled_date}_${shipment.carrier}`;
        if (!scheduledByDateAndRoute[key]) {
          scheduledByDateAndRoute[key] = {
            date: shipment.scheduled_date,
            carrier: shipment.carrier,
            shipments: [],
          };
        }
        scheduledByDateAndRoute[key].shipments.push(shipment);
      });

    for (const group of Object.values(scheduledByDateAndRoute)) {
      if (group.shipments.length < 2) continue;

      const depotOrigin = { lat: DEPOT.lat, lon: DEPOT.lon };
      const originalDistance = totalRouteDistance(depotOrigin, group.shipments);
      const optimizedOrder = orderDayRoute(group.shipments);
      const optimizedDistance = totalRouteDistance(depotOrigin, optimizedOrder);

      const improvement = originalDistance - optimizedDistance;
      const improvementPercent = originalDistance > 0
        ? Math.round((improvement / originalDistance) * 100)
        : 0;

      if (improvement > 5) {
        results.optimizations.push({
          date: group.date,
          carrier: group.carrier,
          shipmentCount: group.shipments.length,
          originalDistance,
          optimizedDistance,
          improvement,
          improvementPercent,
          depot: DEPOT.name,
          optimizedOrder: optimizedOrder.map((s, idx) => ({
            stopNumber: idx + 1,
            id: s.id,
            customer: s.customer_name,
            city: s.city,
            timeWindow: s.time_window,
          })),
        });
      }

      // Capacity check
      const routeInfo = routes.find(
        (r: any) => r.default_carrier === group.carrier || r.name === group.carrier,
      );
      if (routeInfo && group.shipments.length > (routeInfo as any).capacity_pallets) {
        results.optimizations.push({
          date: group.date,
          carrier: group.carrier,
          type: 'overload',
          shipmentCount: group.shipments.length,
          capacity: (routeInfo as any).capacity_pallets,
          overflow: group.shipments.length - (routeInfo as any).capacity_pallets,
          suggestion: 'יש לפצל למסלול נוסף או להשתמש במשאית גדולה יותר',
        });
      }
    }

    return Response.json(
      {
        success: true,
        results,
        optimizations: results.optimizations,
        message: `שובצו ${results.success} משלוחים, ${results.failed} נכשלו. נמצאו ${results.optimizations.length} הזדמנויות אופטימיזציה.`,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
