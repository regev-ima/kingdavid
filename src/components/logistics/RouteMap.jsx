import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Badge } from "@/components/ui/badge";

// Fix for default marker icon in React-Leaflet
if (typeof window !== 'undefined') {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
}

// קואורדינטות משוערות לערים מרכזיות
const CITY_COORDINATES = {
  // צפון
  'חיפה': [32.7940, 34.9896],
  'נהריה': [33.0085, 35.0947],
  'צפת': [32.9658, 35.4983],
  'טבריה': [32.7922, 35.5308],
  'עפולה': [32.6078, 35.2897],
  
  // מרכז
  'תל אביב': [32.0853, 34.7818],
  'ירוחם': [30.9889, 34.9316],
  'רמת גן': [32.0719, 34.8237],
  'פתח תקווה': [32.0878, 34.8878],
  'נתניה': [32.3215, 34.8532],
  'רחובות': [31.8947, 34.8078],
  
  // ירושלים
  'ירושלים': [31.7683, 35.2137],
  'בית שמש': [31.7531, 34.9885],
  
  // דרום
  'באר שבע': [31.2518, 34.7913],
  'אשדוד': [31.8044, 34.6553],
  'אשקלון': [31.6688, 34.5742],
  'אילת': [29.5581, 34.9482]
};

// מרכזי אזורים
const REGION_CENTERS = {
  north: [32.8, 35.2],
  center: [32.0853, 34.7818],
  jerusalem: [31.7683, 35.2137],
  south: [31.0, 34.8]
};

const REGION_COLORS = {
  north: '#3b82f6',
  center: '#10b981',
  jerusalem: '#f59e0b',
  south: '#ef4444'
};

export default function RouteMap({ shipments, selectedRoute, simulationResult }) {
  // מיקום ברירת מחדל - מרכז ישראל
  const defaultCenter = [31.5, 34.9];
  const defaultZoom = 8;

  // חישוב קואורדינטות של משלוחים
  const shipmentsWithCoords = shipments.map(shipment => {
    const city = shipment.city;
    let coords = null;
    
    // חיפוש קואורדינטות לפי שם העיר
    for (const [cityName, cityCoords] of Object.entries(CITY_COORDINATES)) {
      if (city?.includes(cityName) || cityName.includes(city || '')) {
        coords = cityCoords;
        break;
      }
    }
    
    return { ...shipment, coords };
  }).filter(s => s.coords);

  // אם יש מסלול נבחר או תוצאת סימולציה
  const routeShipments = simulationResult?.shipments || 
    (selectedRoute ? shipmentsWithCoords.filter(s => s.matchedRoute?.id === selectedRoute.id) : []);

  return (
    <div className="relative">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: '500px', width: '100%', borderRadius: '8px' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* משלוחים על המפה */}
        {routeShipments.map((shipment, idx) => (
          shipment.coords && (
            <Marker key={shipment.id} position={shipment.coords}>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold">{shipment.customer_name}</p>
                  <p>{shipment.city}</p>
                  <p className="text-xs text-muted-foreground">#{shipment.shipment_number}</p>
                  {shipment.daysRemaining !== null && (
                    <Badge className={
                      shipment.priority === 'critical' ? 'bg-red-100 text-red-800' :
                      shipment.priority === 'warning' ? 'bg-amber-100 text-amber-800' :
                      'bg-green-100 text-green-800'
                    }>
                      {shipment.daysRemaining} ימים
                    </Badge>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        ))}

        {/* מעגלי אזורים */}
        {selectedRoute && REGION_CENTERS[selectedRoute.region] && (
          <Circle
            center={REGION_CENTERS[selectedRoute.region]}
            radius={50000}
            pathOptions={{
              color: REGION_COLORS[selectedRoute.region],
              fillColor: REGION_COLORS[selectedRoute.region],
              fillOpacity: 0.1
            }}
          />
        )}

        {/* קו מסלול משוער */}
        {routeShipments.length > 1 && (
          <Polyline
            positions={routeShipments.map(s => s.coords)}
            pathOptions={{
              color: selectedRoute ? REGION_COLORS[selectedRoute.region] : '#6366f1',
              weight: 3,
              opacity: 0.7
            }}
          />
        )}
      </MapContainer>

      {/* מקרא */}
      <div className="absolute bottom-4 right-4 bg-white p-3 rounded-lg shadow-lg border">
        <p className="text-xs font-semibold mb-2">מקרא:</p>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span>קריטי (0-3 ימים)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <span>דחוף (4-7 ימים)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>רגיל (8-14 ימים)</span>
          </div>
        </div>
      </div>
    </div>
  );
}