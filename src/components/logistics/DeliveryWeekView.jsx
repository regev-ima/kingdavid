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
import { MapPin, Phone, ChevronDown, ChevronUp, Sun, Cloud, Moon, Calendar as CalendarIcon, User, GripVertical } from 'lucide-react';
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
 * Groups each day's scheduled shipments by region, and within region by time
 * window. This is the view a dispatcher uses when planning trucks for the week.
 *
 * Drag a shipment to a different day to reschedule it — the row's
 * scheduled_date is updated and the Deliveries list is invalidated so KPIs
 * stay in sync. Same-day drops are no-ops; we don't support intra-day
 * reordering yet (the in-day order is auto-derived from region + time
 * window + city).
 */
export default function DeliveryWeekView({ shipments }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, -1 = prev, +1 = next

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

  // Bucket shipments by yyyy-MM-dd for fast lookup.
  const shipmentsByDate = useMemo(() => {
    const map = new Map();
    for (const s of shipments) {
      if (!s.scheduled_date || s.status === 'need_scheduling') continue;
      const key = s.scheduled_date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return map;
  }, [shipments]);

  const unscheduledCount = useMemo(
    () => shipments.filter((s) => s.status === 'need_scheduling').length,
    [shipments],
  );

  // dnd-callback: figure out which day the row was dropped onto and bump its
  // scheduled_date if the target day differs from the source day. Same-day
  // drops are no-ops on purpose (intra-day order isn't user-controlled here).
  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    if (rescheduleMutation.isPending) return;
    rescheduleMutation.mutate({ id: draggableId, newDate: destination.droppableId });
  };

  // A single day column: groups that day's shipments by region, then by time window.
  const renderDayCard = (date) => {
    const key = format(date, 'yyyy-MM-dd');
    const dayShipments = shipmentsByDate.get(key) || [];
    const dayName = HEB_DAY_NAMES[date.getDay()];
    const isToday = key === format(new Date(), 'yyyy-MM-dd');

    // Group by region
    const byRegion = {};
    for (const s of dayShipments) {
      const region = getCityRegion(s.city) || 'unknown';
      (byRegion[region] ??= []).push(s);
    }

    // Each Draggable inside this Droppable needs a unique sequential index.
    // We grant indices in the same iteration order the regions/rows render
    // below, so the first row of the first (largest) region gets index 0,
    // the last row of the last region gets index N-1.
    const sortedRegions = Object.entries(byRegion).sort(([, a], [, b]) => b.length - a.length);
    let rowIndexCounter = 0;
    const indexFor = () => rowIndexCounter++;

    return (
      <Droppable droppableId={key} key={key}>
        {(dropProvided, dropSnapshot) => (
          <Card
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            className={`${isToday ? 'border-2 border-indigo-500' : ''} ${
              dropSnapshot.isDraggingOver ? 'ring-2 ring-indigo-300 bg-indigo-50/50' : ''
            } transition-colors`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-base">{dayName}</span>
                  <span className="text-sm text-muted-foreground">{format(date, 'dd/MM')}</span>
                  {isToday && <Badge className="bg-indigo-600">היום</Badge>}
                </div>
                <Badge variant="outline">{dayShipments.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0 min-h-[80px]">
              {dayShipments.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  {dropSnapshot.isDraggingOver ? 'שחרר כדי לתזמן ליום הזה' : 'אין משלוחים מתוכננים'}
                </p>
              )}
              {sortedRegions.map(([region, regionShipments]) => (
                <RegionSection
                  key={region}
                  region={region}
                  shipments={regionShipments}
                  indexFor={indexFor}
                  onShipmentClick={(id) =>
                    navigate(createPageUrl('ShipmentDetails') + `?id=${id}`)
                  }
                />
              ))}
              {dropProvided.placeholder}
            </CardContent>
          </Card>
        )}
      </Droppable>
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
        💡 גרור משלוח ליום אחר כדי לתזמן מחדש.
      </p>

      {/* 5-day grid */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
          {weekDays.map(renderDayCard)}
        </div>
      </DragDropContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Region section inside a day card
// ---------------------------------------------------------------------------
function RegionSection({ region, shipments, indexFor, onShipmentClick }) {
  const [expanded, setExpanded] = useState(shipments.length <= 3);
  const regionLabel = REGIONS[region] || region;
  const colorClass = REGION_COLORS[region] || 'bg-gray-100 text-gray-800 border-gray-300';

  // Sort by time_window, then by order set on shipment (geo-sorted by optimizer).
  const sorted = [...shipments].sort((a, b) => {
    const aOrder = TIME_WINDOW_META[a.time_window]?.order || 99;
    const bOrder = TIME_WINDOW_META[b.time_window]?.order || 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.city || '').localeCompare(b.city || '');
  });

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 ${colorClass} border-b transition-colors hover:opacity-80`}
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5" />
          <span className="text-sm font-semibold">{regionLabel}</span>
          <Badge variant="outline" className="bg-white text-xs">
            {shipments.length}
          </Badge>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <ol className="divide-y">
          {sorted.map((s, stopIdx) => (
            <Draggable key={s.id} draggableId={s.id} index={indexFor()}>
              {(dragProvided, dragSnapshot) => (
                <ShipmentRow
                  index={stopIdx + 1}
                  shipment={s}
                  onClick={() => onShipmentClick(s.id)}
                  dragProvided={dragProvided}
                  isDragging={dragSnapshot.isDragging}
                />
              )}
            </Draggable>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single shipment row inside a region section
// ---------------------------------------------------------------------------
function ShipmentRow({ index, shipment, onClick, dragProvided, isDragging }) {
  const meta = TIME_WINDOW_META[shipment.time_window] || TIME_WINDOW_META.all_day;
  const Icon = meta.icon;
  const phone = (shipment.contact_phone || shipment.customer_phone || '').replace(/[^0-9]/g, '');

  return (
    <li
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      className={`px-3 py-2 flex items-start gap-2 text-xs hover:bg-slate-50 transition-colors ${
        isDragging ? 'bg-white shadow-lg ring-2 ring-indigo-300 rounded' : ''
      }`}
    >
      {/* Drag handle — only this small zone responds to drag-start so the
          rest of the row can still receive plain clicks (open shipment) and
          taps on the phone link. */}
      {dragProvided && (
        <span
          {...dragProvided.dragHandleProps}
          className="shrink-0 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing pt-0.5"
          title="גרור ליום אחר"
          aria-label="גרור ליום אחר"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}

      {/* Stop number (route order) */}
      <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-semibold text-[11px]">
        {index}
      </span>

      <button type="button" onClick={onClick} className="flex-1 min-w-0 text-start">
        <div className="flex items-center gap-1 font-medium text-foreground">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate">{shipment.customer_name}</span>
        </div>
        <div className="text-muted-foreground truncate">
          {shipment.city} • {shipment.address}
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
    </li>
  );
}
