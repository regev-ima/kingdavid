import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, MapPin, Phone, Truck } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { createPageUrl } from '@/utils';

// Factory address: רחוב העמל 6 קרית מלאכי. The dispatcher's "trucks leave from
// here" anchor for both the day map's polyline and (Round 3) the auto-router's
// nearest-neighbor starting point.
const DEPOT = {
  lat: 31.7264,
  lng: 34.7472,
  label: 'מפעל קינג דוד · קריית מלאכי',
};

// Bounding box around Israel — used to (a) reject obviously-bogus
// coordinates such as (0,0) which leaflet would otherwise plot in the Gulf
// of Guinea, and (b) constrain the map's pannable area so dispatchers
// can't accidentally drift to Africa or Europe. Slightly generous on each
// side so legitimate edge cities (Eilat in the south, Metula in the north)
// don't get filtered out.
const ISRAEL_BBOX = {
  minLat: 29.0,
  maxLat: 33.5,
  minLng: 34.0,
  maxLng: 36.2,
};

function isInsideIsrael(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= ISRAEL_BBOX.minLat &&
    lat <= ISRAEL_BBOX.maxLat &&
    lng >= ISRAEL_BBOX.minLng &&
    lng <= ISRAEL_BBOX.maxLng
  );
}

// Status → marker color. Mirrors the badge palette the rest of the app uses
// for delivery_shipments.status so the map "feels" consistent with the list.
const STATUS_COLORS = {
  need_scheduling: '#9CA3AF', // slate
  scheduled:       '#3B82F6', // blue
  dispatched:      '#F97316', // orange
  in_transit:      '#F97316',
  delivered:       '#10B981', // emerald
  failed:          '#EF4444', // red
  returned:        '#A855F7', // purple
};

const STATUS_LABELS = {
  need_scheduling: 'לתאום',
  scheduled:       'מתוזמן',
  dispatched:      'יצא לדרך',
  in_transit:      'בדרך',
  delivered:       'נמסר',
  failed:          'נכשל',
  returned:        'הוחזר',
};

// react-leaflet's default Marker tries to load images via Webpack-style
// resolution that doesn't work under Vite. Stub the asset URLs once so the
// fallback markers render instead of broken images. We also build our own
// numbered DivIcon below for the actual stops.
let leafletDefaultsPatched = false;
function patchLeafletDefaults() {
  if (leafletDefaultsPatched) return;
  // eslint-disable-next-line no-underscore-dangle
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
  leafletDefaultsPatched = true;
}

// Numbered, colored DivIcon — small circle with the stop number inside.
function buildStopIcon(number, color) {
  const html = `
    <div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:12px;
      box-shadow:0 2px 4px rgba(0,0,0,.35);
      border:2px solid #fff;
    ">${number}</div>
  `;
  return L.divIcon({
    html,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

// Big factory icon for the depot.
function buildDepotIcon() {
  const html = `
    <div style="
      width:34px;height:34px;border-radius:6px;
      background:#111827;color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:11px;
      box-shadow:0 2px 6px rgba(0,0,0,.4);
      border:2px solid #fff;
    ">🏭</div>
  `;
  return L.divIcon({
    html,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

// Auto-fit the visible bounds to the markers + depot, with a sensible padding.
// Recomputes any time the input list changes, so a different day re-frames.
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [points, map]);
  return null;
}

/**
 * One-day delivery map. Renders every shipment scheduled for the given date
 * as a numbered, status-colored marker, plus a polyline from the depot through
 * the stops in their current order and back. The polyline is straight-line
 * (no traffic-aware routing yet) — that arrives in the auto-routing round.
 */
export default function DayDeliveryMap({ shipments }) {
  const navigate = useNavigate();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    patchLeafletDefaults();
  }, []);

  // Filter to the chosen date and keep only rows that carry coordinates
  // *inside Israel*. Reject (0,0) and any other lat/lng that would render
  // outside the country — leaflet was drawing the Gulf of Guinea otherwise
  // because the legacy geocoder occasionally writes nulls back as zeros.
  const { mapped, unmapped } = useMemo(() => {
    const dayRows = shipments.filter((s) => s.scheduled_date && s.scheduled_date.slice(0, 10) === date);
    const m = [];
    const u = [];
    for (const s of dayRows) {
      const lat = Number(s.latitude);
      const lng = Number(s.longitude);
      if (isInsideIsrael(lat, lng)) m.push({ ...s, lat, lng });
      else u.push(s);
    }
    return { mapped: m, unmapped: u };
  }, [shipments, date]);

  // Polyline order: shipments come in whatever order the parent passed; we
  // honour `route_order` if it's set (Round 3 will write to it), otherwise
  // fall back to the time-of-day-then-creation order, ending with a return
  // leg back to the depot so the dispatcher sees the full loop.
  const orderedRoute = useMemo(() => {
    const sorted = [...mapped].sort((a, b) => {
      const ao = Number.isFinite(Number(a.route_order)) ? Number(a.route_order) : 1e9;
      const bo = Number.isFinite(Number(b.route_order)) ? Number(b.route_order) : 1e9;
      if (ao !== bo) return ao - bo;
      return (a.created_date || '').localeCompare(b.created_date || '');
    });
    return sorted;
  }, [mapped]);

  const polylinePoints = useMemo(() => {
    if (orderedRoute.length === 0) return [];
    return [
      [DEPOT.lat, DEPOT.lng],
      ...orderedRoute.map((s) => [s.lat, s.lng]),
      [DEPOT.lat, DEPOT.lng],
    ];
  }, [orderedRoute]);

  const fitPoints = useMemo(() => {
    return [[DEPOT.lat, DEPOT.lng], ...mapped.map((s) => [s.lat, s.lng])];
  }, [mapped]);

  const statusBreakdown = useMemo(() => {
    const counts = {};
    for (const s of mapped) counts[s.status] = (counts[s.status] || 0) + 1;
    return counts;
  }, [mapped]);

  const shiftDay = (delta) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(format(d, 'yyyy-MM-dd'));
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-indigo-600" />
              <span>מפת יום</span>
              <Badge variant="outline">{mapped.length} משלוחים על המפה</Badge>
              {unmapped.length > 0 && (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  {unmapped.length} ללא קואורדינטות תקינות
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => shiftDay(-1)} title="יום קודם">←</Button>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-44"
              />
              <Button variant="outline" size="sm" onClick={() => shiftDay(1)} title="יום הבא">→</Button>
              <Button variant="ghost" size="sm" onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))}>
                <CalendarIcon className="h-4 w-4 me-1" />
                היום
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {mapped.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              אין משלוחים מתוכננים ליום זה (או שאף אחד מהם לא עבר geocoding).
            </div>
          ) : (
            <div className="relative">
              <MapContainer
                center={[DEPOT.lat, DEPOT.lng]}
                zoom={9}
                style={{ height: '560px', width: '100%' }}
                scrollWheelZoom
                // Lock the pannable area to Israel so a stray click+drag
                // can't take the dispatcher to Africa or Europe.
                maxBounds={[
                  [ISRAEL_BBOX.minLat, ISRAEL_BBOX.minLng],
                  [ISRAEL_BBOX.maxLat, ISRAEL_BBOX.maxLng],
                ]}
                maxBoundsViscosity={1}
                minZoom={7}
                maxZoom={16}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Depot anchor — always rendered. */}
                <Marker position={[DEPOT.lat, DEPOT.lng]} icon={buildDepotIcon()}>
                  <Popup>
                    <div className="text-sm font-medium">{DEPOT.label}</div>
                    <div className="text-xs text-muted-foreground">נקודת מוצא של המסלול</div>
                  </Popup>
                </Marker>

                {/* Numbered, color-coded shipment markers. */}
                {orderedRoute.map((s, idx) => (
                  <Marker
                    key={s.id}
                    position={[s.lat, s.lng]}
                    icon={buildStopIcon(idx + 1, STATUS_COLORS[s.status] || '#6B7280')}
                  >
                    <Popup>
                      <div className="text-sm space-y-1">
                        <div className="font-bold">{s.customer_name}</div>
                        <div className="text-xs text-muted-foreground">#{s.shipment_number}</div>
                        <div className="text-xs">
                          {s.city}{s.address ? ` · ${s.address}` : ''}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge style={{ background: STATUS_COLORS[s.status] || '#6B7280', color: 'white' }}>
                            {STATUS_LABELS[s.status] || s.status}
                          </Badge>
                          {s.time_window && <Badge variant="outline">{s.time_window}</Badge>}
                        </div>
                        <div className="flex gap-2 pt-1">
                          {s.customer_phone && (
                            <a href={`tel:+972${String(s.customer_phone).replace(/\D/g, '').replace(/^0/, '')}`}
                               className="inline-flex items-center gap-1 text-xs text-green-700">
                              <Phone className="h-3 w-3" />
                              {s.customer_phone}
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate(createPageUrl('ShipmentDetails') + `?id=${s.id}`)}
                            className="text-xs text-indigo-700 underline ms-auto"
                          >
                            פתח משלוח
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}

                {/* Straight-line route — Round 3 will reorder these by
                    nearest-neighbor TSP from the depot. */}
                {polylinePoints.length > 1 && (
                  <Polyline
                    positions={polylinePoints}
                    pathOptions={{ color: '#6366f1', weight: 3, opacity: 0.65, dashArray: '6,6' }}
                  />
                )}

                <FitBounds points={fitPoints} />
              </MapContainer>

              {/* Legend */}
              <div className="absolute bottom-4 right-4 bg-white border rounded-lg shadow-lg p-3 z-[1000] text-xs space-y-1">
                <div className="font-semibold text-foreground">מקרא</div>
                {Object.entries(STATUS_LABELS).map(([key, label]) => {
                  const count = statusBreakdown[key];
                  if (!count) return null;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ background: STATUS_COLORS[key] }}
                      />
                      <span>{label}</span>
                      <span className="text-muted-foreground">({count})</span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-1 mt-1 border-t">
                  <Truck className="h-3 w-3" />
                  <span>{DEPOT.label.split('·')[0].trim()}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {unmapped.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">משלוחים בלי קואורדינטות ({unmapped.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">
              משלוחים בלי lat/lng או עם קואורדינטות מחוץ לישראל (כולל 0,0) לא יוצגו על המפה. הרץ את ה-edge function geocodeShipment כדי לאכלס מחדש.
            </p>
            <ul className="space-y-1 text-sm">
              {unmapped.map((s) => (
                <li key={s.id} className="flex items-center justify-between border rounded px-2 py-1">
                  <span className="truncate">
                    #{s.shipment_number} · {s.customer_name} · {s.city || '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(createPageUrl('ShipmentDetails') + `?id=${s.id}`)}
                    className="text-xs text-indigo-700 hover:underline whitespace-nowrap"
                  >
                    פתח
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
