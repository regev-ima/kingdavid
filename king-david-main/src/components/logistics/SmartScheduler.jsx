import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Truck, AlertTriangle, TrendingUp, MapPin, Calendar, Map, Zap } from "lucide-react";
import { calculateSLADaysRemaining } from './SLABadge';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getCityRegion, getRegionName } from '@/components/utils/cityRegionMapper';
import RouteMap from './RouteMap';
import { toast } from 'react-hot-toast';

const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export default function SmartScheduler({ shipments, orders }) {
  const [recommendations, setRecommendations] = useState([]);
  const [showMap, setShowMap] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [simulationMode, setSimulationMode] = useState(false);
  const [analyzedShipments, setAnalyzedShipments] = useState([]);
  const [isScheduling, setIsScheduling] = useState(false);

  const queryClient = useQueryClient();
  const { data: routes = [] } = useQuery({
    queryKey: ['routes'],
    queryFn: () => base44.entities.DeliveryRoute.list(),
  });

  // פונקציית עזר למציאת מסלול מתאים לעיר (לפי אזור)
  const findRouteForCity = (city) => {
    if (!city) return null;
    const cityRegion = getCityRegion(city);
    if (!cityRegion) return null;
    
    // מצא מסלול פעיל באזור הזה
    return routes.find(route => 
      route.is_active && route.region === cityRegion
    );
  };

  // אלגוריתם אופטימיזציה למסלולים
  const optimizeRoutes = (shipmentsToOptimize) => {
    const optimizedRoutes = {};
    
    // קיבוץ משלוחים לפי מסלול
    shipmentsToOptimize.forEach(shipment => {
      if (!shipment.matchedRoute) return;
      
      const routeId = shipment.matchedRoute.id;
      if (!optimizedRoutes[routeId]) {
        optimizedRoutes[routeId] = {
          route: shipment.matchedRoute,
          shipments: [],
          totalPallets: 0,
          criticalCount: 0,
          warningCount: 0,
          safeCount: 0
        };
      }
      
      optimizedRoutes[routeId].shipments.push(shipment);
      optimizedRoutes[routeId].totalPallets += 1; // נניח כל משלוח = 1 משטח
      
      if (shipment.priority === 'critical') optimizedRoutes[routeId].criticalCount++;
      else if (shipment.priority === 'warning') optimizedRoutes[routeId].warningCount++;
      else optimizedRoutes[routeId].safeCount++;
    });
    
    // מיון משלוחים בכל מסלול לפי דחיפות ומיקום
    Object.values(optimizedRoutes).forEach(routeData => {
      routeData.shipments.sort((a, b) => {
        // קודם לפי עדיפות
        const priorityOrder = { critical: 0, warning: 1, safe: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        // אחר כך לפי עיר (לקבץ אותה עיר ביחד)
        return (a.city || '').localeCompare(b.city || '');
      });
    });
    
    return optimizedRoutes;
  };

  // ניתוח חכם של המשלוחים עם מסלולים
  const analyzeShipments = () => {
    const pending = shipments.filter(s => s.status === 'need_scheduling');
    const ordersMap = {};
    
    // מיפוי הזמנות למשלוחים
    orders?.forEach(order => {
      ordersMap[order.id] = order;
    });

    const analyzed = pending.map(shipment => {
      const order = ordersMap[shipment.order_id];
      const daysRemaining = order ? calculateSLADaysRemaining(order.created_date) : null;
      const matchedRoute = findRouteForCity(shipment.city);
      
      return {
        ...shipment,
        order,
        daysRemaining,
        priority: daysRemaining <= 3 ? 'critical' : daysRemaining <= 7 ? 'warning' : 'safe',
        matchedRoute
      };
    });

    // מיון לפי דחיפות
    analyzed.sort((a, b) => {
      const priorityOrder = { critical: 0, warning: 1, safe: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // יצירת המלצות
    const newRecommendations = [];

    // חיפוש משלוחים קריטיים
    const critical = analyzed.filter(s => s.priority === 'critical');
    if (critical.length > 0) {
      newRecommendations.push({
        type: 'critical',
        title: `🔴 ${critical.length} משלוחים קריטיים דורשים תשומת לב מיידית!`,
        description: `משלוחים אלה חייבים לצאת בימים הקרובים כדי לעמוד ב-SLA. ממליץ לתעדף אותם בכל משאית זמינה.`,
        items: critical.slice(0, 5),
        action: 'תעדוף מיידי',
        routeInfo: null
      });
    }

    // ניתוח לפי מסלולים
    if (routes.length > 0) {
      const today = new Date().getDay();
      
      routes.forEach(route => {
        if (!route.is_active) return;
        
        // משלוחים שמתאימים למסלול זה
        const routeShipments = analyzed.filter(s => s.matchedRoute?.id === route.id);
        
        if (routeShipments.length === 0) return;

        // חישוב קיבולת משוערת (נניח שכל משלוח תופס משטח אחד)
        const estimatedPallets = routeShipments.length;
        const capacityUsage = route.capacity_pallets ? Math.round((estimatedPallets / route.capacity_pallets) * 100) : 0;
        
        const criticalCount = routeShipments.filter(s => s.priority === 'critical').length;
        const warningCount = routeShipments.filter(s => s.priority === 'warning').length;
        const safeCount = routeShipments.filter(s => s.priority === 'safe').length;

        // בדיקה אם יש יום פעילות קרוב
        const nextActiveDay = route.active_days?.find(day => day >= today) ?? route.active_days?.[0];
        const daysUntilNextRun = nextActiveDay !== undefined 
          ? (nextActiveDay >= today ? nextActiveDay - today : 7 - today + nextActiveDay)
          : null;

        let recType = 'route-info';
        let recTitle = `📍 מסלול ${route.name}`;
        let recDesc = `${routeShipments.length} משלוחים ממתינים`;

        if (capacityUsage > 100) {
          recType = 'route-overflow';
          recTitle = `⚠️ עומס במסלול ${route.name}`;
          recDesc = `יש ${routeShipments.length} משלוחים (${capacityUsage}% קיבולת). יש צורך בתכנון נוסף או העברת משלוחים.`;
        } else if (criticalCount > 0 && daysUntilNextRun !== null && daysUntilNextRun <= criticalCount) {
          recType = 'route-urgent';
          recTitle = `🔴 דחוף: מסלול ${route.name}`;
          recDesc = `${criticalCount} משלוחים קריטיים חייבים לצאת! המסלול הבא ביום ${daysOfWeek[nextActiveDay]} (עוד ${daysUntilNextRun} ימים).`;
        } else if (capacityUsage >= 70) {
          recType = 'route-optimal';
          recTitle = `✨ מסלול ${route.name} - מוכן לשיבוץ`;
          recDesc = `קיבולת אופטימלית: ${criticalCount} קריטיים, ${warningCount} דחופים, ${safeCount} רגילים. ניצול ${capacityUsage}%.`;
        } else if (safeCount >= 3) {
          recType = 'route-early';
          recTitle = `💚 הזדמנות: מסלול ${route.name}`;
          recDesc = `יש ${safeCount} משלוחים חדשים. אפשר להקדים אספקה ולהפתיע לקוחות.`;
        }

        if (recType !== 'route-info' || routeShipments.length >= 3) {
          newRecommendations.push({
            type: recType,
            title: recTitle,
            description: recDesc,
            items: routeShipments.slice(0, 5),
            action: capacityUsage > 100 ? 'תכנן קיבולת נוספת' : 'שבץ למסלול',
            routeInfo: {
              route,
              capacityUsage,
              criticalCount,
              warningCount,
              safeCount,
              nextActiveDay: nextActiveDay !== undefined ? daysOfWeek[nextActiveDay] : 'לא מוגדר',
              daysUntilNextRun
            }
          });
        }
      });
    }

    // משלוחים ללא מסלול מוגדר
    const noRoute = analyzed.filter(s => !s.matchedRoute);
    if (noRoute.length > 0) {
      newRecommendations.push({
        type: 'no-route',
        title: `⚠️ ${noRoute.length} משלוחים ללא מסלול מוגדר`,
        description: `משלוחים אלה לא משויכים לאף מסלול קיים. יש להגדיר מסלול חדש או לעדכן את האזורים המכוסים.`,
        items: noRoute.slice(0, 5),
        action: 'הגדר מסלול',
        routeInfo: null
      });
    }

    // אזהרה על צוואר בקבוק
    const warning = analyzed.filter(s => s.priority === 'warning');
    if (warning.length > 10) {
      newRecommendations.push({
        type: 'bottleneck',
        title: `⚠️ צוואר בקבוק צפוי`,
        description: `יש ${warning.length} משלוחים שיהפכו לקריטיים בשבוע הקרוב. ממליץ להגדיל קיבולת או להעביר חלק למשאיות חיצוניות.`,
        items: [],
        action: 'תכנן קיבולת',
        routeInfo: null
      });
    }

    setRecommendations(newRecommendations);
    setAnalyzedShipments(analyzed);
  };

  // שיבוץ מחדש של משלוחים קיימים
  const rescheduleExisting = async () => {
    const scheduled = shipments.filter(s => s.status === 'scheduled');
    
    if (scheduled.length === 0) {
      toast.error('אין משלוחים מתוזמנים לשיבוץ מחדש');
      return;
    }

    const confirmed = window.confirm(`האם אתה בטוח שברצונך לשבץ מחדש ${scheduled.length} משלוחים מתוזמנים? זה יאפס את השיבוץ הקיים שלהם.`);
    if (!confirmed) return;

    setIsScheduling(true);
    toast.loading('מאפס ומשבץ מחדש...', { id: 'rescheduling' });

    try {
      // איפוס סטטוס לכל המשלוחים המתוזמנים
      for (const shipment of scheduled) {
        await base44.asServiceRole.entities.DeliveryShipment.update(shipment.id, {
          status: 'need_scheduling',
          scheduled_date: null,
          time_window: null,
          carrier: null
        });
      }

      // שיבוץ מחדש
      const shipmentIds = scheduled.map(s => s.id);
      const response = await base44.functions.invoke('scheduleShipments', { shipmentIds });

      if (response.data.success) {
        toast.success(`${response.data.results.success} משלוחים שובצו מחדש בהצלחה!`, { id: 'rescheduling', duration: 5000 });
        queryClient.invalidateQueries({ queryKey: ['shipments'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      } else {
        toast.error('שגיאה בשיבוץ מחדש', { id: 'rescheduling' });
      }
    } catch (error) {
      toast.error('שגיאה: ' + error.message, { id: 'rescheduling' });
    } finally {
      setIsScheduling(false);
    }
  };

  // ביצוע שיבוץ אוטומטי
  const executeScheduling = async () => {
    if (analyzedShipments.length === 0) {
      toast.error('אין משלוחים לשיבוץ');
      return;
    }

    setIsScheduling(true);
    toast.loading('משבץ ומבצע אופטימיזציה...', { id: 'scheduling' });

    try {
      const shipmentIds = analyzedShipments.map(s => s.id);
      const response = await base44.functions.invoke('scheduleShipments', { shipmentIds });

      if (response.data.success) {
        // הצגת תוצאות אופטימיזציה
        const optimizations = response.data.optimizations || [];
        
        if (optimizations.length > 0) {
          const routeOptimizations = optimizations.filter(opt => opt.optimizedOrder);
          const overloadWarnings = optimizations.filter(opt => opt.type === 'overload');
          
          let message = response.data.message;
          if (routeOptimizations.length > 0) {
            const totalSaved = routeOptimizations.reduce((sum, opt) => sum + opt.improvement, 0);
            message += `\n💡 חיסכון של ${totalSaved} ק"מ באופטימיזציה!`;
          }
          if (overloadWarnings.length > 0) {
            message += `\n⚠️ ${overloadWarnings.length} מסלולים עמוסים מעבר לקיבולת`;
          }
          
          toast.success(message, { id: 'scheduling', duration: 5000 });
          
          // הצגת המלצות אופטימיזציה
          if (routeOptimizations.length > 0) {
            setRecommendations(prev => [
              ...prev,
              ...routeOptimizations.map(opt => ({
                type: 'route-optimization',
                title: `🚀 אופטימיזציה למסלול ${opt.carrier}`,
                description: `ביום ${opt.date}: ${opt.shipmentCount} משלוחים. חיסכון של ${opt.improvement} ק"מ (${opt.improvementPercent}%)`,
                items: opt.optimizedOrder.map(s => ({ id: s.id, customer_name: s.customer, city: s.city })),
                action: 'הצג מסלול מומלץ',
                routeInfo: {
                  originalDistance: opt.originalDistance,
                  optimizedDistance: opt.optimizedDistance,
                  improvement: opt.improvement,
                  improvementPercent: opt.improvementPercent
                }
              })),
              ...overloadWarnings.map(opt => ({
                type: 'route-overflow',
                title: `⚠️ עומס יתר במסלול ${opt.carrier}`,
                description: `ביום ${opt.date}: ${opt.shipmentCount} משלוחים (קיבולת: ${opt.capacity}). עודף של ${opt.overflow} משלוחים.`,
                items: [],
                action: 'פצל למסלול נוסף',
                routeInfo: opt
              }))
            ]);
          }
        } else {
          toast.success(response.data.message, { id: 'scheduling' });
        }
        
        queryClient.invalidateQueries({ queryKey: ['shipments'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        setAnalyzedShipments([]);
      } else {
        toast.error('שגיאה בשיבוץ', { id: 'scheduling' });
      }
    } catch (error) {
      toast.error('שגיאה: ' + error.message, { id: 'scheduling' });
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600" />
          שיבוץ חכם ואופטימיזציה
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Button 
            onClick={analyzeShipments}
            className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
          >
            <Sparkles className="h-4 w-4 me-2" />
            נתח וצור המלצות
          </Button>
          <Button 
            onClick={rescheduleExisting}
            disabled={isScheduling}
            variant="outline"
            className="flex-1 border-orange-500 text-orange-700 hover:bg-orange-50"
          >
            <Truck className="h-4 w-4 me-2" />
            {isScheduling ? 'משבץ...' : 'שבץ מחדש משלוחים קיימים'}
          </Button>
          {recommendations.length > 0 && (
            <Button 
              onClick={executeScheduling}
              disabled={isScheduling}
              className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            >
              <Zap className="h-4 w-4 me-2" />
              {isScheduling ? 'משבץ...' : 'בצע שיבוץ אוטומטי'}
            </Button>
          )}
          <Button 
            onClick={() => setShowMap(!showMap)}
            variant="outline"
          >
            <Map className="h-4 w-4 me-2" />
            {showMap ? 'הסתר מפה' : 'הצג מפה'}
          </Button>
        </div>

        {showMap && (
          <div className="mt-4">
            <RouteMap 
              shipments={analyzedShipments} 
              selectedRoute={selectedRoute}
            />
          </div>
        )}

        {recommendations.length > 0 && (
          <div className="space-y-3 mt-4">
            {recommendations.map((rec, idx) => (
              <div 
                key={idx} 
                className={`p-4 rounded-lg border-r-4 ${
                  rec.type === 'critical' || rec.type === 'route-urgent' ? 'bg-red-50 border-red-500' :
                  rec.type === 'route-optimal' || rec.type === 'route-early' ? 'bg-green-50 border-green-500' :
                  rec.type === 'route-overflow' || rec.type === 'no-route' ? 'bg-amber-50 border-amber-500' :
                  rec.type === 'bottleneck' ? 'bg-orange-50 border-orange-500' :
                  'bg-blue-50 border-blue-500'
                }`}
              >
                <h4 className="font-semibold mb-1">{rec.title}</h4>
                <p className="text-sm text-foreground/80 mb-2">{rec.description}</p>
                
                {rec.routeInfo && (
                  <div className="grid grid-cols-2 gap-2 my-3 p-2 bg-white/70 rounded-lg text-xs">
                    <div>
                      <span className="text-muted-foreground">קיבולת:</span>
                      <span className="font-medium mr-1">{rec.routeInfo.capacityUsage}%</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">יום הבא:</span>
                      <span className="font-medium mr-1">{rec.routeInfo.nextActiveDay}</span>
                    </div>
                    <div>
                      <span className="text-red-600">🔴 קריטי:</span>
                      <span className="font-medium mr-1">{rec.routeInfo.criticalCount}</span>
                    </div>
                    <div>
                      <span className="text-amber-600">🟡 דחוף:</span>
                      <span className="font-medium mr-1">{rec.routeInfo.warningCount}</span>
                    </div>
                    <div>
                      <span className="text-green-600">🟢 רגיל:</span>
                      <span className="font-medium mr-1">{rec.routeInfo.safeCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">קיבולת:</span>
                      <span className="font-medium mr-1">{rec.routeInfo.route?.capacity_pallets || 'לא מוגדר'} משטחים</span>
                    </div>
                  </div>
                )}
                
                {rec.items.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-2">
                    <p className="font-medium">כולל משלוחים:</p>
                    <ul className="list-disc list-inside mt-1">
                      {rec.items.slice(0, 3).map(item => (
                        <li key={item.id}>
                          {item.customer_name} - {item.city}
                          {item.daysRemaining !== null && (
                            <span className={`mr-1 font-medium ${
                              item.priority === 'critical' ? 'text-red-600' :
                              item.priority === 'warning' ? 'text-amber-600' :
                              'text-green-600'
                            }`}>
                              ({item.daysRemaining} ימים)
                            </span>
                          )}
                        </li>
                      ))}
                      {rec.items.length > 3 && (
                        <li>ועוד {rec.items.length - 3} משלוחים...</li>
                      )}
                    </ul>
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => {
                      if (rec.routeInfo) {
                        setSelectedRoute(rec.routeInfo.route);
                        setShowMap(true);
                      }
                    }}
                  >
                    {rec.action}
                  </Button>
                  {rec.routeInfo && (
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => {
                        setSelectedRoute(rec.routeInfo.route);
                        setShowMap(true);
                      }}
                    >
                      <Map className="h-3 w-3 me-1" />
                      הצג במפה
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {recommendations.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <Truck className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>לחץ על הכפתור לקבלת המלצות אוטומטיות</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}