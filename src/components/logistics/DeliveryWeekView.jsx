import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, Phone, Sun, Cloud, Moon, Calendar as CalendarIcon, User, GripVertical } from 'lucide-react';
import { format, addDays, startOfWeek } from '@/lib/safe-date-fns';
import { getCityRegion, REGIONS } from '@/components/utils/cityRegionMapper';

// Regional color theme for consistent badges across the app.
const REGION_COLORS = {
  north:     'bg-blue-100 text-blue-800 border-blue-300',
  center:    'bg-green-100 text-green-800 border-green-300',
  sharon:    'bg-purple-100 text-purple-800 border-purple-300',
  shomron:   'bg-orange-100 text-orange-800 border-orange-300',
  jerusalem: 'bg-pink-100 text-pink-800 border-pink-300',
  south:     'bg-amber-100 text-amber-800 border-amber-300',
  unknown:   'bg-gray-100 text-gray-700 border-gray-300',
};

const TIME_WINDOW_META = {
  morning:   { label: 'בוקר 08:00-12:00',  icon: Sun,   order: 1 },
  afternoon: { label: 'צהריים 12:00-16:00', icon: Cloud, order: 2 },
  evening:   { label: 'ערב 16:00-20:00',    icon: Moon,  order: 3 },
  all_day:   { label: 'כל היום',            icon: Sun,   order: 4 },
};

const HEB_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * Week view for scheduled shipments.
 *
 * Drag a shipment to a different day to reschedule it — the row's
 * scheduled_date is updated and the Deliveries list is invalidated so KPIs
 * stay in sync. Same-day drops are no-ops (intra-day order isn't user-
 * controlled here).
 *
 * Structure note (the previous version of this file had a bug where the
 * grip handle didn't appear and rows wouldn't drag): @hello-pangea/dnd
 * needs every <Draggable> to be a *direct* child of the element that
 * carries dropProvided.innerRef, otherwise the placeholder positioning
 * breaks and the lib silently refuses to attach drag listeners. The old
 * version nested Draggables inside a RegionSection wrapper which broke
 * exactly that contract. Now the Droppable's ref is on a flat <div>, and
 * region headers are rendered as plain non-draggable rows interleaved
 * with the Draggables in the same flat list.
 */
export default function DeliveryWeekView({ shipments }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, newDate }) => base44.entities.DeliveryShipment.update(id, { scheduled_date: newDate }),
    onSuccess: (_, { newDate }) => {
      queryClient.invalidateQueries(['shipments']);
      toast.success(`המשלוח הועבר ל-${format(new Date(newDate), 'dd/MM')}`);
    },
    onError: (err) => {
      const parts = [err?.message, err?.details, err?.hint, err?.code].filter(Boolean);
      toast.error(`עדכון המשלוח נכשל: ${parts.join(' — ') || 'שגיאה לא ידועה'}`, { duration: Infinity });
    },
  });

  // Build the 5 business days (Sun–Thu) for the selected week.
  const weekDays = useMemo(() => {
    const today = new Date();
    const sunday = startOfWeek(today, { weekStartsOn: 0 });
    const shifted = addDays(sunday, weekOffset * 7);
    return Array.from({ length: 5 }, (_, i) => addDays(shifted, i));
  }, [weekOffset]);

  // Bucket shipments by yyyy-MM-dd → flat sorted list per day. The order is:
  // by region, then by time window, then by city. Region transitions get a
  // synthetic "header" row (kind: 'header') so the day card visually groups
  // shipments without needing a wrapper component (which would break dnd
  // nesting — see comment at the top of the file).
  const dayItemsByDate = useMemo(() => {
    const result = new Map();
    for (const day of weekDays) {
      const key = format(day, 'yyyy-MM-dd');
      const dayShipments = shipments.filter(
        (s) => s.scheduled_date && s.scheduled_date.slice(0, 10) === key && s.status !== 'need_scheduling',
      );

      // Group by region, sort regions by size (largest first).
      const byRegion = new Map();
      for (const s of dayShipments) {
        const region = getCityRegion(s.city) || 'unknown';
        if (!byRegion.has(region)) byRegion.set(region, []);
        byRegion.get(region).push(s);
      }
      const sortedRegions = [...byRegion.entries()].sort(([, a], [, b]) => b.length - a.length);

      // Sort each region's shipments and produce a flat [header, row, row, header, row…] list.
      const items = [];
      for (const [region, regionShipments] of sortedRegions) {
        regionShipments.sort((a, b) => {
          const ao = TIME_WINDOW_META[a.time_window]?.order || 99;
          const bo = TIME_WINDOW_META[b.time_window]?.order || 99;
          if (ao !== bo) return ao - bo;
          return (a.city || '').localeCompare(b.city || '');
        });
        items.push({ kind: 'header', region, count: regionShipments.length });
        regionShipments.forEach((s, idx) => items.push({ kind: 'row', shipment: s, stopNumber: idx + 1 }));
      }
      result.set(key, items);
    }
    return result;
  }, [shipments, weekDays]);

  const unscheduledCount = useMemo(
    () => shipments.filter((s) => s.status === 'need_scheduling').length,
    [shipments],
  );

  // dnd-callback: figure out which day the row was dropped onto and bump its
  // scheduled_date if the target day differs from the source day. Same-day
  // drops are no-ops on purpose (intra-day order isn't user-controlled).
  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    if (rescheduleMutation.isPending) return;
    rescheduleMutation.mutate({ id: draggableId, newDate: destination.droppableId });
  };

  const renderDayCard = (date) => {
    const key = format(date, 'yyyy-MM-dd');
    const items = dayItemsByDate.get(key) || [];
    const dayName = HEB_DAY_NAMES[date.getDay()];
    const isToday = key === format(new Date(), 'yyyy-MM-dd');
    const shipmentCount = items.filter((it) => it.kind === 'row').length;

    // Track the running Draggable index. Header rows don't count.
    let dragIdx = 0;

    return (
      <Card key={key} className={isToday ? 'border-2 border-indigo-500' : ''}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-base">{dayName}</span>
              <span className="text-sm text-muted-foreground">{format(date, 'dd/MM')}</span>
              {isToday && <Badge className="bg-indigo-600">היום</Badge>}
            </div>
            <Badge variant="outline">{shipmentCount}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Droppable droppableId={key}>
            {(dropProvided, dropSnapshot) => (
              <div
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className={`min-h-[80px] rounded-md transition-colors ${
                  dropSnapshot.isDraggingOver ? 'ring-2 ring-indigo-300 bg-indigo-50/60 p-1' : ''
                }`}
              >
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground italic px-2 py-3">
                    {dropSnapshot.isDraggingOver ? 'שחרר כדי לתזמן ליום הזה' : 'אין משלוחים מתוכננים'}
                  </p>
                )}

                {items.map((item, idx) => {
                  if (item.kind === 'header') {
                    return <RegionHeader key={`hdr-${item.region}-${idx}`} region={item.region} count={item.count} />;
                  }
                  // item.kind === 'row'
                  const myDragIndex = dragIdx;
                  dragIdx += 1;
                  return (
                    <Draggable key={item.shipment.id} draggableId={item.shipment.id} index={myDragIndex}>
                      {(dragProvided, dragSnapshot) => (
                        <ShipmentRow
                          shipment={item.shipment}
                          stopNumber={item.stopNumber}
                          onClick={() => navigate(createPageUrl('ShipmentDetails') + `?id=${item.shipment.id}`)}
                          dragProvided={dragProvided}
                          isDragging={dragSnapshot.isDragging}
                        />
                      )}
                    </Draggable>
                  );
                })}

                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header with navigation + unscheduled warning */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset - 1)}>
            ← שבוע קודם
          </Button>
          <Select value={String(weekOffset)} onValueChange={(v) => setWeekOffset(parseInt(v, 10))}>
            <SelectTrigger className="w-auto min-w-[180px]">
              <CalendarIcon className="h-4 w-4 me-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="-1">שבוע שעבר</SelectItem>
              <SelectItem value="0">השבוע</SelectItem>
              <SelectItem value="1">שבוע הבא</SelectItem>
              <SelectItem value="2">בעוד שבועיים</SelectItem>
              <SelectItem value="3">בעוד 3 שבועות</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>
            שבוע הבא →
          </Button>
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
              חזור להיום
            </Button>
          )}
        </div>

        {unscheduledCount > 0 && (
          <Badge variant="outline" className="border-amber-500 text-amber-700 gap-1 py-1.5 px-2">
            <CalendarIcon className="h-3 w-3" />
            {unscheduledCount} משלוחים ממתינים לשיבוץ
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        💡 גרור משלוח (אחיזה בידית בצד ימין) ליום אחר כדי לתזמן מחדש.
      </p>

      {/* 5-day grid wrapped in one DragDropContext so cross-day drops work. */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
          {weekDays.map(renderDayCard)}
        </div>
      </DragDropContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual region label inserted between groups of shipments inside a day.
// Plain non-draggable element — must be a sibling of the Draggables, not a
// wrapper, otherwise dnd's placeholder positioning breaks.
// ---------------------------------------------------------------------------
function RegionHeader({ region, count }) {
  const label = REGIONS[region] || region;
  const colorClass = REGION_COLORS[region] || REGION_COLORS.unknown;
  return (
    <div className={`flex items-center justify-between px-2 py-1 my-1 rounded text-xs font-semibold ${colorClass}`}>
      <span className="flex items-center gap-1">
        <MapPin className="h-3 w-3" />
        {label}
      </span>
      <Badge variant="outline" className="bg-white text-[10px] py-0">{count}</Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One draggable shipment row inside a day card.
// The Draggable's ref/draggableProps go on the outer <div>; only the small
// grip span carries dragHandleProps so the rest of the row keeps its normal
// click-to-open and tap-to-call behaviour.
// ---------------------------------------------------------------------------
function ShipmentRow({ shipment, stopNumber, onClick, dragProvided, isDragging }) {
  const meta = TIME_WINDOW_META[shipment.time_window] || TIME_WINDOW_META.all_day;
  const Icon = meta.icon;
  const phone = (shipment.contact_phone || shipment.customer_phone || '').replace(/[^0-9]/g, '');

  return (
    <div
      ref={dragProvided.innerRef}
      {...dragProvided.draggableProps}
      className={`flex items-start gap-2 text-xs px-2 py-2 my-1 border rounded-md bg-white transition-colors ${
        isDragging ? 'shadow-lg ring-2 ring-indigo-400 rotate-1' : 'hover:bg-slate-50'
      }`}
    >
      {/* Drag handle — visible enough to find. */}
      <span
        {...dragProvided.dragHandleProps}
        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 cursor-grab active:cursor-grabbing"
        title="גרור ליום אחר"
        aria-label="גרור ליום אחר"
      >
        <GripVertical className="h-4 w-4" />
      </span>

      {/* Stop number (route order). */}
      <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-semibold text-[11px]">
        {stopNumber}
      </span>

      <button type="button" onClick={onClick} className="flex-1 min-w-0 text-start">
        <div className="flex items-center gap-1 font-medium text-foreground">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate">{shipment.customer_name}</span>
        </div>
        <div className="text-muted-foreground truncate">
          {shipment.city}{shipment.address ? ` • ${shipment.address}` : ''}
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-muted-foreground">
          <Icon className="h-3 w-3" />
          {meta.label}
        </div>
      </button>

      {phone && (
        <a
          href={`tel:+972${phone.replace(/^0/, '')}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-green-600 hover:text-green-700 p-1"
          title={phone}
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
