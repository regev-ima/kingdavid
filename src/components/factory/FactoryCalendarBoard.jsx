import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { addDays, addWeeks, format, startOfWeek, isToday, isPast, startOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/shared/StatusBadge';
import { Phone, Package, GripVertical, Truck, Check, ChevronRight, ChevronLeft, CalendarDays, Inbox, Sparkles } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import OrderQuickView from './OrderQuickView';
import { useIsraeliHolidays } from '@/hooks/useIsraeliHolidays';

const WORKING_DAYS_PER_WEEK = 5; // Sun-Thu
const WEEKS_VISIBLE = 2;

// Idempotent shipment-create — same helper we ship in FactoryKanban.
// Inlined here to keep the calendar board self-contained; drift is
// unlikely (it's six lines).
async function ensureShipment(order) {
  const existing = await base44.entities.DeliveryShipment.filter({ order_id: order.id });
  if (existing && existing.length > 0) return { created: false, shipment: existing[0] };
  const shipment = await base44.entities.DeliveryShipment.create({
    order_id: order.id,
    customer_name: order.customer_name || '',
    customer_phone: order.customer_phone || '',
    address: order.shipping_address || order.address || '',
    city: order.shipping_city || order.city || '',
    status: 'need_scheduling',
  });
  return { created: true, shipment };
}

function OrderCard({ order, dragProvided, isDragging, hasShipment, onPreview, onCall, onMarkReady, isReady, isOverdue }) {
  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      onClick={() => onPreview?.(order)}
      className={`group flex items-start gap-1.5 rounded-md border p-2 text-xs shadow-sm transition-all cursor-pointer
        ${isReady ? 'border-emerald-300 bg-emerald-50/50 opacity-75' : 'bg-card'}
        ${isOverdue && !isReady ? 'border-red-300 ring-1 ring-red-200' : ''}
        ${isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:border-primary/40 hover:shadow-md'}`}
    >
      <span
        {...(dragProvided?.dragHandleProps || {})}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 text-muted-foreground/50 group-hover:text-muted-foreground"
        title="גרור כדי להעביר יום"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <span className="font-bold text-primary">#{order.order_number}</span>
          {isOverdue && !isReady && (
            <span className="text-[9px] font-bold text-red-600">באיחור</span>
          )}
        </div>
        <p className={`truncate font-medium ${isReady ? 'text-foreground/60 line-through decoration-emerald-500' : 'text-foreground'}`}>
          {order.customer_name || 'לקוח'}
        </p>
        {order.customer_phone && (
          <p className="truncate text-[10px] text-muted-foreground" dir="ltr">{order.customer_phone}</p>
        )}
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          {hasShipment && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-50 px-1 py-px text-[9px] font-semibold text-cyan-700">
              <Truck className="h-2.5 w-2.5" /> משלוח
            </span>
          )}
          {isReady && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-700">
              <Check className="h-2.5 w-2.5" /> מוכן
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {order.customer_phone && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCall?.(order.customer_phone);
            }}
            className="flex-shrink-0 rounded-full bg-green-100 hover:bg-green-200 active:bg-green-300 p-1 text-green-700 transition-colors"
            title={`התקשר ל-${order.customer_phone}`}
          >
            <Phone className="h-3 w-3" />
          </button>
        )}
        {!isReady && order.production_scheduled_date && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkReady?.(order);
            }}
            className="flex-shrink-0 rounded-full bg-emerald-100 hover:bg-emerald-200 active:bg-emerald-300 p-1 text-emerald-700 transition-colors"
            title="סמן כמוכן"
          >
            <Check className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function HolidayPill({ items }) {
  if (!items || items.length === 0) return null;
  // Show the first holiday name; tooltip lists the rest if there's more.
  const first = items[0];
  const hasMore = items.length > 1;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
        first.isYomTov ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
      }`}
      title={items.map((i) => i.hebrew || i.title).join(' · ')}
    >
      <Sparkles className="h-2.5 w-2.5" />
      {first.hebrew || first.title}
      {hasMore && ` +${items.length - 1}`}
    </span>
  );
}

export default function FactoryCalendarBoard({ orders, shipmentsByOrderId = {} }) {
  const queryClient = useQueryClient();
  const [previewOrderId, setPreviewOrderId] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const startWeek = useMemo(
    () => addWeeks(startOfWeek(new Date(), { weekStartsOn: 0 }), weekOffset * WEEKS_VISIBLE),
    [weekOffset],
  );
  const endWeek = useMemo(
    () => addWeeks(startWeek, WEEKS_VISIBLE - 1),
    [startWeek],
  );

  const days = useMemo(() => {
    // Two weeks × five working days (Sun-Thu, skip Fri/Sat).
    const result = [];
    for (let w = 0; w < WEEKS_VISIBLE; w++) {
      const weekStart = addDays(startWeek, w * 7);
      for (let d = 0; d < WORKING_DAYS_PER_WEEK; d++) {
        result.push(addDays(weekStart, d));
      }
    }
    return result;
  }, [startWeek]);

  const dayKeys = useMemo(() => days.map((d) => format(d, 'yyyy-MM-dd')), [days]);
  const holidaysByDate = useIsraeliHolidays(days[0], addDays(days[days.length - 1], 1));

  // Bucket orders into inbox (no scheduled date) or by day-key.
  const buckets = useMemo(() => {
    const map = { inbox: [] };
    for (const k of dayKeys) map[k] = [];
    for (const o of orders) {
      if (!o.production_scheduled_date) {
        map.inbox.push(o);
        continue;
      }
      const k = format(new Date(o.production_scheduled_date), 'yyyy-MM-dd');
      if (map[k]) map[k].push(o);
      // Orders scheduled outside the visible window simply hide; the
      // navigator below moves between two-week windows.
    }
    // Inbox: oldest first so FIFO. Day buckets: by created_date asc too.
    const sortFn = (a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0);
    map.inbox.sort(sortFn);
    for (const k of dayKeys) map[k].sort(sortFn);
    return map;
  }, [orders, dayKeys]);

  const orderById = useMemo(() => {
    const m = new Map();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  // Shared helpers ---------------------------------------------------------

  const handleCall = async (phone) => {
    if (!phone) return;
    try {
      await base44.functions.invoke('clickToCall', { customerPhone: phone });
      toast.success(`מתקשר ל-${phone}`);
    } catch (err) {
      toast.error(`חיוג נכשל: ${err?.message || 'שגיאה'}`);
    }
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['factory-shipments'] });
  };

  // Drag → place on a day. Idempotent shipment-create on FIRST move out of
  // inbox; subsequent day-to-day drags only update production_scheduled_date.
  const moveMutation = useMutation({
    mutationFn: async ({ orderId, targetKey }) => {
      const order = orderById.get(orderId);
      if (!order) throw new Error('הזמנה לא נמצאה');

      // Build the new production_scheduled_date. Inbox = null. A day-key
      // gets noon UTC (avoids tz boundary surprises when reading back).
      let newDate = null;
      if (targetKey !== 'inbox') {
        const d = new Date(`${targetKey}T12:00:00`);
        newDate = d.toISOString();
      }

      // production_status sync: dragging out of inbox sets in_production
      // (unless already ready); dragging back to inbox resets to not_started.
      const updates = { production_scheduled_date: newDate };
      if (targetKey === 'inbox') {
        if (order.production_status !== 'not_started') updates.production_status = 'not_started';
      } else if (order.production_status === 'not_started') {
        updates.production_status = 'in_production';
      }

      await base44.entities.Order.update(order.id, updates);

      // Open the shipment ONLY when leaving inbox for the first time.
      // Day-to-day shuffles never create or alter shipments.
      const wasInInbox = !order.production_scheduled_date;
      let shipmentResult = null;
      if (wasInInbox && targetKey !== 'inbox') {
        shipmentResult = await ensureShipment(order);
      }
      return { targetKey, shipmentResult };
    },
    onSuccess: ({ targetKey, shipmentResult }) => {
      refreshAll();
      const label = targetKey === 'inbox'
        ? 'ההזמנה הוחזרה לתור'
        : `ההזמנה תוזמנה ל-${format(new Date(`${targetKey}T12:00:00`), 'EEEE dd/MM', { locale: he })}`;
      if (shipmentResult?.created) {
        toast.success(`${label} · משלוח נפתח לתיאום`);
      } else {
        toast.success(label);
      }
    },
    onError: (err) => toast.error(`העברה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const markReadyMutation = useMutation({
    mutationFn: async ({ order }) => {
      await base44.entities.Order.update(order.id, { production_status: 'ready' });
      return order;
    },
    onSuccess: () => {
      refreshAll();
      toast.success('ההזמנה סומנה כמוכנה');
    },
    onError: (err) => toast.error(`עדכון נכשל: ${err?.message || 'שגיאה'}`),
  });

  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    moveMutation.mutate({ orderId: draggableId, targetKey: destination.droppableId });
  };

  // Render -----------------------------------------------------------------

  const weekRangeLabel = `${format(days[0], 'd/M')} – ${format(days[days.length - 1], 'd/M')}`;
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  const renderDayCell = (day) => {
    const key = format(day, 'yyyy-MM-dd');
    const cellOrders = buckets[key] || [];
    const dayName = format(day, 'EEEE', { locale: he });
    const dateLabel = format(day, 'dd/MM');
    const isCurrentDay = key === todayKey;
    const dayPast = isPast(day) && !isCurrentDay;
    const holidays = holidaysByDate[key] || [];

    return (
      <Droppable droppableId={key} key={key}>
        {(dropProvided, dropSnapshot) => (
          <div
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            className={`flex min-h-[160px] flex-col rounded-lg border transition-colors ${
              isCurrentDay ? 'border-primary/60 bg-primary/5' : dayPast ? 'border-border bg-muted/40' : 'border-border bg-card'
            } ${dropSnapshot.isDraggingOver ? 'ring-2 ring-primary/50' : ''}`}
          >
            <div className="flex items-center justify-between gap-1 border-b border-border/60 px-2 py-1.5">
              <div className="flex items-baseline gap-1.5">
                <span className={`text-sm font-bold ${isCurrentDay ? 'text-primary' : 'text-foreground'}`}>{dayName}</span>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">{dateLabel}</span>
              </div>
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-bold text-foreground/70">
                {cellOrders.length}
              </span>
            </div>
            {holidays.length > 0 && (
              <div className="px-2 pt-1">
                <HolidayPill items={holidays} />
              </div>
            )}
            <div className="flex-1 space-y-1.5 p-2">
              {cellOrders.length === 0 && (
                <p className="text-center text-[10px] text-muted-foreground/60 italic mt-3">
                  {dropSnapshot.isDraggingOver ? 'שחרר כאן' : 'אין ייצור מתוזמן'}
                </p>
              )}
              {cellOrders.map((order, idx) => (
                <Draggable key={order.id} draggableId={order.id} index={idx}>
                  {(dragProvided, dragSnapshot) => (
                    <OrderCard
                      order={order}
                      dragProvided={dragProvided}
                      isDragging={dragSnapshot.isDragging}
                      hasShipment={!!shipmentsByOrderId[order.id]}
                      isReady={order.production_status === 'ready'}
                      isOverdue={dayPast}
                      onPreview={(o) => setPreviewOrderId(o.id)}
                      onCall={handleCall}
                      onMarkReady={(o) => markReadyMutation.mutate({ order: o })}
                    />
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          </div>
        )}
      </Droppable>
    );
  };

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-3" dir="rtl">
          {/* Navigator */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset - 1)} className="h-8 px-2">
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">שבועיים אחורה</span>
              </Button>
              <Button
                variant={weekOffset === 0 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setWeekOffset(0)}
                className="h-8"
              >
                <CalendarDays className="h-3.5 w-3.5 me-1" /> השבועיים הנוכחיים
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset + 1)} className="h-8 px-2">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">שבועיים קדימה</span>
              </Button>
              <span className="text-sm text-muted-foreground">{weekRangeLabel}</span>
            </div>
            <span className="text-xs text-muted-foreground/80">{orders.length} הזמנות פעילות</span>
          </div>

          <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
            {/* Inbox column */}
            <Droppable droppableId="inbox">
              {(dropProvided, dropSnapshot) => (
                <Card
                  ref={dropProvided.innerRef}
                  {...dropProvided.droppableProps}
                  className={`flex flex-col bg-amber-50/30 border-amber-200 ${
                    dropSnapshot.isDraggingOver ? 'ring-2 ring-primary/40' : ''
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-amber-200 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Inbox className="h-4 w-4 text-amber-700" />
                      <span className="font-bold text-foreground">חדש</span>
                    </div>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold text-foreground">
                      {buckets.inbox.length}
                    </span>
                  </div>
                  <div className="min-h-[200px] flex-1 space-y-1.5 p-2 max-h-[calc(100vh-220px)] overflow-y-auto">
                    {buckets.inbox.length === 0 && (
                      <div className="flex flex-col items-center gap-1 py-6 text-xs text-muted-foreground/70">
                        <Package className="h-5 w-5 opacity-50" />
                        אין הזמנות חדשות
                      </div>
                    )}
                    {buckets.inbox.map((order, idx) => (
                      <Draggable key={order.id} draggableId={order.id} index={idx}>
                        {(dragProvided, dragSnapshot) => (
                          <OrderCard
                            order={order}
                            dragProvided={dragProvided}
                            isDragging={dragSnapshot.isDragging}
                            hasShipment={!!shipmentsByOrderId[order.id]}
                            isReady={order.production_status === 'ready'}
                            onPreview={(o) => setPreviewOrderId(o.id)}
                            onCall={handleCall}
                            onMarkReady={(o) => markReadyMutation.mutate({ order: o })}
                          />
                        )}
                      </Draggable>
                    ))}
                    {dropProvided.placeholder}
                  </div>
                </Card>
              )}
            </Droppable>

            {/* Two-week × five-day grid */}
            <div className="grid grid-cols-5 gap-2">
              {days.map(renderDayCell)}
            </div>
          </div>
        </div>
      </DragDropContext>

      <OrderQuickView
        order={previewOrderId ? orderById.get(previewOrderId) : null}
        shipment={previewOrderId ? shipmentsByOrderId[previewOrderId] : null}
        isOpen={!!previewOrderId}
        onClose={() => setPreviewOrderId(null)}
        onCall={handleCall}
      />
    </>
  );
}
