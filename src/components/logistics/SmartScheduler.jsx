import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Truck, Map, Zap, Loader2 } from "lucide-react";
import { calculateSLADaysRemaining } from './SLABadge';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getCityRegion } from '@/components/utils/cityRegionMapper';
import RouteMap from './RouteMap';
import { toast } from 'sonner';

const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export default function SmartScheduler({ shipments, orders }) {
  const [recommendations, setRecommendations] = useState([]);
  const [showMap, setShowMap] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [analyzedShipments, setAnalyzedShipments] = useState([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [progress, setProgress] = useState(null);
  // progress = { label, target, elapsedMs, startCount } | null
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  // Live-polling: while scheduling is in flight, poll the DB every 1s to show
  // how many shipments have flipped from need_scheduling → scheduled.
  useEffect(() => {
    if (!progress) return;

    // Timer tick (elapsed seconds)
    tickRef.current = setInterval(() => {
      setProgress((p) => p ? { ...p, elapsedMs: p.elapsedMs + 1000 } : p);
    }, 1000);

    // DB poll (scheduled count)
    pollRef.current = setInterval(async () => {
      try {
        const all = await base44.entities.DeliveryShipment.list();
        const nowScheduled = all.filter((s) => s.status === 'scheduled').length;
        setProgress((p) => p ? { ...p, doneCount: nowScheduled - p.startCount } : p);
      } catch {
        // ignore transient poll errors
      }
    }, 1500);

    return () => {
      clearInterval(tickRef.current);
      clearInterval(pollRef.current);
    };
  }, [progress?.target]);

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
    setProgress({
      label: `מאפס ומשבץ מחדש ${scheduled.length} משלוחים...`,
      target: scheduled.length,
      doneCount: 0,
      startCount: shipments.filter(s => s.status === 'scheduled').length - scheduled.length,
      elapsedMs: 0,
    });
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
      setProgress(null);
    }
  };

  // ביצוע שיבוץ אוטומטי (currently unused — kept for the richer optimization
  // toast; primary flow is `scheduleAllPending` below).
  // eslint-disable-next-line no-unused-vars
  const executeScheduling = async () => {
    if (analyzedShipments.length === 0) {
      toast.error('אין משלוחים לשיבוץ');
      return;
    }

    setIsScheduling(true);
    setProgress({
      label: `משבץ ${analyzedShipments.length} משלוחים ומחשב סדר גאוגרפי...`,
      target: analyzedShipments.length,
      doneCount: 0,
      startCount: shipments.filter(s => s.status === 'scheduled').length,
      elapsedMs: 0,
    });
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
      setProgress(null);
    }
  };

  // One-click primary flow: analyze → schedule, no intermediate step.
  const scheduleAllPending = async () => {
    const pending = shipments.filter((s) => s.status === 'need_scheduling');
    if (pending.length === 0) {
      toast.info('אין משלוחים חדשים לשיבוץ');
      return;
    }

    // Run the existing analyzer (builds analyzedShipments + recommendations)
    // then immediately execute scheduling on that set.
    analyzeShipments();
    // analyzeShipments sets state; we need to wait for it before execute.
    // Easiest: duplicate what executeScheduling does but use `pending` directly.
    setIsScheduling(true);
    setProgress({
      label: `משבץ ${pending.length} משלוחים ומחשב סדר גאוגרפי...`,
      target: pending.length,
      doneCount: 0,
      startCount: shipments.filter((s) => s.status === 'scheduled').length,
      elapsedMs: 0,
    });
    toast.loading('משבץ ומבצע אופטימיזציה...', { id: 'scheduling' });

    try {
      const shipmentIds = pending.map((s) => s.id);
      const response = await base44.functions.invoke('scheduleShipments', { shipmentIds });

      if (response?.data?.success) {
        toast.success(response.data.message, { id: 'scheduling', duration: 5000 });
        queryClient.invalidateQueries({ queryKey: ['shipments'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        setAnalyzedShipments([]);
      } else {
        toast.error('שגיאה בשיבוץ', { id: 'scheduling' });
      }
    } catch (err) {
      toast.error('שגיאה: ' + err.message, { id: 'scheduling' });
    } finally {
      setIsScheduling(false);
      setProgress(null);
    }
  };

  const pendingCount = shipments.filter((s) => s.status === 'need_scheduling').length;
  const scheduledCount = shipments.filter((s) => s.status === 'scheduled').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600" />
          שיבוץ חכם ואופטימיזציה
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hero summary + primary CTA */}
        <div className="flex items-center justify-between flex-wrap gap-4 rounded-lg border bg-slate-50 p-4">
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">ממתינים לשיבוץ</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{scheduledCount}</p>
              <p className="text-xs text-muted-foreground">כבר מתוזמנים</p>
            </div>
          </div>
          <Button
            onClick={scheduleAllPending}
            disabled={isScheduling || pendingCount === 0}
            size="lg"
            className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
          >
            <Zap className="h-5 w-5 me-2" />
            {isScheduling
              ? 'משבץ...'
              : pendingCount === 0
                ? 'אין משלוחים לשיבוץ'
                : `שבץ את כל ה-${pendingCount} המשלוחים עכשיו`}
          </Button>
        </div>

        {/* Secondary actions (collapsed, less prominent) */}
        <div className="flex gap-2 flex-wrap text-sm">
          <Button
            onClick={analyzeShipments}
            variant="ghost"
            size="sm"
            disabled={isScheduling}
          >
            <Sparkles className="h-3.5 w-3.5 me-1.5" />
            הצג המלצות בלבד (בלי לשבץ)
          </Button>
          <Button
            onClick={rescheduleExisting}
            disabled={isScheduling || scheduledCount === 0}
            variant="ghost"
            size="sm"
            className="text-orange-700 hover:bg-orange-50"
          >
            <Truck className="h-3.5 w-3.5 me-1.5" />
            שבץ מחדש משלוחים קיימים
          </Button>
          <Button onClick={() => setShowMap(!showMap)} variant="ghost" size="sm">
            <Map className="h-3.5 w-3.5 me-1.5" />
            {showMap ? 'הסתר מפה' : 'הצג מפה'}
          </Button>
        </div>

        {progress && (
          <Card className="border-2 border-blue-400 bg-blue-50/60">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-foreground">{progress.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    זמן שעבר: {Math.floor(progress.elapsedMs / 1000)} שניות
                    {progress.target > 0 && ` • התקדמות: ${Math.min(progress.doneCount, progress.target)} / ${progress.target}`}
                  </p>
                </div>
              </div>
              <Progress
                value={progress.target > 0
                  ? Math.min(100, (progress.doneCount / progress.target) * 100)
                  : 0}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                💡 המערכת מתאימה כל משלוח למסלול לפי אזור, מוצאת את יום החלוקה הקרוב ביותר, ומסדרת את הסדר הגאוגרפי מהמפעל בקריית מלאכי. עשוי להימשך עד ~15 שניות.
              </p>
            </CardContent>
          </Card>
        )}

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