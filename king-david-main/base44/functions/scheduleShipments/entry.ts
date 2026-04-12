import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// פונקציה לחישוב ימי עסקים
function calculateBusinessDays(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);
  
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

// פונקציה דינמית לזיהוי אזור העיר
function getCityRegionDynamic(cityName) {
  if (!cityName) return null;
  
  const normalizedCity = cityName.trim();
  
  // רשימה מקיפה של ערים לפי מחוזות ישראל
  const cityRegions = {
    // צפון - מחוז הצפון, מחוז חיפה והגליל
    north: [
      'חיפה', 'קריית ים', 'קריית מוצקין', 'קריית ביאליק', 'קריית אתא', 'נשר',
      'טירת כרמל', 'עספיא', 'דלית אל כרמל',
      'נהריה', 'עכו', 'צפת', 'קריית שמונה', 'כרמיאל', 'מעלות תרשיחא',
      'נצרת', 'נצרת עילית', 'טבריה', 'בית שאן', 'עפולה', 'מגדל העמק',
      'יוקנעם', 'יקנעם עילית', 'שפרעם', 'סחנין', 'טמרה', 'ראמה',
      'מעלה גלבוע', 'קרית שלמה', 'רמת ישי', 'מגדל', 'פרדס חנה כרכור',
      'חדרה', 'אור עקיבא', 'זכרון יעקב', 'בנימינה', 'קיסריה', 'חריש'
    ],
    
    // מרכז - מחוז המרכז, מחוז תל אביב, השפלה והשרון
    center: [
      'תל אביב', 'תל אביב יפו', 'רמת גן', 'גבעתיים', 'בני ברק', 'חולון', 'בת ים',
      'רמת השרון', 'הרצליה', 'אור יהודה', 'קריית אונו', 'גבעת שמואל',
      'נתניה', 'רעננה', 'כפר סבא', 'הוד השרון', 'ראש העין', 'פתח תקווה',
      'אלעד', 'יהוד מונוסון', 'יהוד',
      'ראשון לציון', 'רחובות', 'נס ציונה', 'יבנה', 'גדרה', 'רמלה', 'לוד',
      'מודיעין', 'מודיעין מכבים רעות', 'שוהם', 'מזכרת בתיה', 'קרית עקרון',
      'גן יבנה', 'באר יעקב'
    ],
    
    // ירושלים - מחוז ירושלים והאזור
    jerusalem: [
      'ירושלים', 'בית שמש', 'מעלה אדומים', 'מבשרת ציון', 'אבו גוש',
      'גוש עציון', 'אפרת', 'בית אל', 'ביתר עילית'
    ],
    
    // דרום - מחוז הדרום והנגב
    south: [
      'באר שבע', 'אשדוד', 'אשקלון', 'קריית גת', 'שדרות', 'נתיבות',
      'אילת', 'דימונה', 'ערד', 'עראד', 'אופקים',
      'קרית מלאכי', 'גדרות', 'מצפה רמון', 'רהט', 'תל שבע',
      'להבים', 'עומר', 'מיתר', 'ניר עוז'
    ]
  };
  
  // חיפוש העיר באזורים
  for (const [region, cities] of Object.entries(cityRegions)) {
    const found = cities.find(city => 
      normalizedCity.includes(city) || city.includes(normalizedCity)
    );
    if (found) return region;
  }
  
  return null;
}

// מיפוי קואורדינטות משוערות לערים מרכזיות
const cityCoordinates = {
  // צפון
  'חיפה': { lat: 32.8, lon: 35.0 },
  'נהריה': { lat: 33.0, lon: 35.1 },
  'טבריה': { lat: 32.8, lon: 35.5 },
  'עפולה': { lat: 32.6, lon: 35.3 },
  'כרמיאל': { lat: 32.9, lon: 35.3 },
  'עכו': { lat: 32.9, lon: 35.1 },
  'צפת': { lat: 32.9, lon: 35.5 },
  'קריית שמונה': { lat: 33.2, lon: 35.6 },
  'נצרת': { lat: 32.7, lon: 35.3 },
  'קריית מוצקין': { lat: 32.8, lon: 35.1 },
  'קריית ים': { lat: 32.8, lon: 35.1 },
  'קריית ביאליק': { lat: 32.8, lon: 35.1 },
  'קריית אתא': { lat: 32.8, lon: 35.1 },
  'מגדל העמק': { lat: 32.7, lon: 35.2 },
  'נצרת עילית': { lat: 32.7, lon: 35.3 },
  'יקנעם': { lat: 32.7, lon: 35.1 },
  'בית שאן': { lat: 32.5, lon: 35.5 },
  'חדרה': { lat: 32.4, lon: 34.9 },
  'אור עקיבא': { lat: 32.5, lon: 34.9 },
  
  // מרכז
  'תל אביב': { lat: 32.0, lon: 34.8 },
  'נתניה': { lat: 32.3, lon: 34.9 },
  'פתח תקווה': { lat: 32.1, lon: 34.9 },
  'רמת גן': { lat: 32.0, lon: 34.8 },
  'רחובות': { lat: 31.9, lon: 34.8 },
  'ראשון לציון': { lat: 31.9, lon: 34.8 },
  'הרצליה': { lat: 32.2, lon: 34.8 },
  'רעננה': { lat: 32.2, lon: 34.9 },
  'הוד השרון': { lat: 32.1, lon: 34.9 },
  'מודיעין': { lat: 31.9, lon: 35.0 },
  'חולון': { lat: 32.0, lon: 34.8 },
  'בני ברק': { lat: 32.0, lon: 34.8 },
  'בת ים': { lat: 32.0, lon: 34.7 },
  'גבעתיים': { lat: 32.0, lon: 34.8 },
  'רמת השרון': { lat: 32.1, lon: 34.8 },
  'כפר סבא': { lat: 32.2, lon: 34.9 },
  'ראש העין': { lat: 32.1, lon: 34.9 },
  'לוד': { lat: 32.0, lon: 34.9 },
  'רמלה': { lat: 31.9, lon: 34.9 },
  'נס ציונה': { lat: 31.9, lon: 34.8 },
  'יבנה': { lat: 31.9, lon: 34.7 },
  'קריית אונו': { lat: 32.0, lon: 34.9 },
  'גבעת שמואל': { lat: 32.1, lon: 34.9 },
  'אור יהודה': { lat: 32.0, lon: 34.9 },
  
  // דרום
  'באר שבע': { lat: 31.2, lon: 34.8 },
  'אשדוד': { lat: 31.8, lon: 34.6 },
  'אשקלון': { lat: 31.7, lon: 34.6 },
  'קריית גת': { lat: 31.6, lon: 34.8 },
  'אילת': { lat: 29.5, lon: 34.9 },
  'דימונה': { lat: 31.1, lon: 35.0 },
  'ערד': { lat: 31.3, lon: 35.2 },
  'נתיבות': { lat: 31.4, lon: 34.6 },
  'שדרות': { lat: 31.5, lon: 34.6 },
  'אופקים': { lat: 31.3, lon: 34.6 },
  'קריית מלאכי': { lat: 31.7, lon: 34.7 },
  
  // ירושלים
  'ירושלים': { lat: 31.8, lon: 35.2 },
  'מעלה אדומים': { lat: 31.8, lon: 35.3 },
  'בית שמש': { lat: 31.7, lon: 35.0 }
};

// חישוב מרחק משוער בין שתי ערים (בק"מ)
function calculateDistance(city1, city2) {
  const c1 = cityCoordinates[city1];
  const c2 = cityCoordinates[city2];
  
  if (!c1 || !c2) return 100; // ברירת מחדל
  
  const latDiff = c1.lat - c2.lat;
  const lonDiff = c1.lon - c2.lon;
  
  // נוסחת מרחק אוקלידי פשוטה * 111 (ק"מ לדרגה)
  return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111;
}

// אלגוריתם אופטימיזציה של מסלול (Nearest Neighbor)
function optimizeRoute(shipments) {
  if (shipments.length <= 1) return shipments;
  
  const optimized = [shipments[0]];
  const remaining = [...shipments.slice(1)];
  
  while (remaining.length > 0) {
    const current = optimized[optimized.length - 1];
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    
    remaining.forEach((shipment, index) => {
      const distance = calculateDistance(current.city, shipment.city);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    
    optimized.push(remaining[nearestIndex]);
    remaining.splice(nearestIndex, 1);
  }
  
  return optimized;
}

// חישוב מרחק כולל של מסלול
function calculateTotalDistance(shipments) {
  let total = 0;
  for (let i = 0; i < shipments.length - 1; i++) {
    total += calculateDistance(shipments[i].city, shipments[i + 1].city);
  }
  return Math.round(total);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { shipmentIds } = await req.json();

  // טעינת כל הנתונים
  const routes = await base44.entities.DeliveryRoute.list();
  const orders = await base44.entities.Order.list();
  const allShipments = await base44.entities.DeliveryShipment.list();
  
  // מיפוי הזמנות
  const ordersMap = {};
  orders.forEach(order => {
    ordersMap[order.id] = order;
  });

  const results = { success: 0, failed: 0, details: [], optimizations: [] };

  // שלב 1: שיבוץ בסיסי
  for (const shipmentId of shipmentIds) {
    try {
      const shipment = await base44.entities.DeliveryShipment.get(shipmentId);
      if (!shipment) {
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

      const route = routes.find(r => r.is_active && r.region === shipmentRegion);
      
      if (!route) {
        results.failed++;
        results.details.push({ shipmentId, error: `לא נמצא מסלול עבור ${shipment.city}` });
        continue;
      }

      // קבלת ההזמנה לחישוב SLA
      const order = ordersMap[shipment.order_id];
      let slaDeadline = null;
      
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

      // חיפוש התאריך הקרוב ביותר
      const today = new Date();
      let scheduledDate = null;
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
      const slaWarning = slaDeadline && scheduledDate > slaDeadline;

      await base44.asServiceRole.entities.DeliveryShipment.update(shipmentId, {
        status: 'scheduled',
        scheduled_date: scheduledDateStr,
        time_window: 'morning',
        carrier: route.default_carrier || route.name
      });

      results.success++;
      results.details.push({ 
        shipmentId, 
        scheduledDate: scheduledDateStr,
        route: route.name,
        slaWarning 
      });

    } catch (error) {
      results.failed++;
      results.details.push({ shipmentId, error: error.message });
    }
  }

  // שלב 2: אופטימיזציה של מסלולים
  // קיבוץ כל המשלוחים המתוכננים לפי תאריך ומסלול
  const scheduledByDateAndRoute = {};
  
  allShipments
    .filter(s => s.status === 'scheduled' && s.scheduled_date)
    .forEach(shipment => {
      const key = `${shipment.scheduled_date}_${shipment.carrier}`;
      if (!scheduledByDateAndRoute[key]) {
        scheduledByDateAndRoute[key] = {
          date: shipment.scheduled_date,
          carrier: shipment.carrier,
          shipments: []
        };
      }
      scheduledByDateAndRoute[key].shipments.push(shipment);
    });

  // ניתוח כל קבוצה
  Object.values(scheduledByDateAndRoute).forEach(group => {
    if (group.shipments.length < 2) return;
    
    const originalOrder = [...group.shipments];
    const optimizedOrder = optimizeRoute(group.shipments);
    
    const originalDistance = calculateTotalDistance(originalOrder);
    const optimizedDistance = calculateTotalDistance(optimizedOrder);
    const improvement = originalDistance - optimizedDistance;
    const improvementPercent = Math.round((improvement / originalDistance) * 100);
    
    if (improvement > 5) { // שיפור של יותר מ-5 ק"מ
      results.optimizations.push({
        date: group.date,
        carrier: group.carrier,
        shipmentCount: group.shipments.length,
        originalDistance,
        optimizedDistance,
        improvement,
        improvementPercent,
        optimizedOrder: optimizedOrder.map(s => ({
          id: s.id,
          customer: s.customer_name,
          city: s.city
        }))
      });
    }
    
    // בדיקת עומס יתר
    const routeInfo = routes.find(r => r.default_carrier === group.carrier || r.name === group.carrier);
    if (routeInfo && group.shipments.length > routeInfo.capacity_pallets) {
      results.optimizations.push({
        date: group.date,
        carrier: group.carrier,
        type: 'overload',
        shipmentCount: group.shipments.length,
        capacity: routeInfo.capacity_pallets,
        overflow: group.shipments.length - routeInfo.capacity_pallets,
        suggestion: 'יש לפצל למסלול נוסף או להשתמש במשאית גדולה יותר'
      });
    }
  });

  return Response.json({ 
    success: true,
    results,
    optimizations: results.optimizations,
    message: `שובצו ${results.success} משלוחים, ${results.failed} נכשלו. נמצאו ${results.optimizations.length} הזדמנויות אופטימיזציה.`
  });
});