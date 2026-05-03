import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Card } from '@/components/ui/card';
import { Phone, Package, GripVertical, Truck } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import { format } from '@/lib/safe-date-fns';
import { base44 } from '@/api/base44Client';
import OrderQuickView from './OrderQuickView';

// Three boards. Internally the DB tracks five production statuses
// (not_started / materials_check / in_production / qc / ready) — we
// keep them but render the three middle ones under a single "בייצור"
// column. Dropping into "בייצור" sets the leaf status to in_production
// so we don't silently lose materials_check / qc unless the manager
// goes back to the list view to set them.
const COLUMNS = [
  { id: 'queue', label: 'חדש', leafStatus: 'not_started', members: ['not_started'], accent: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  { id: 'in_production', label: 'בייצור', leafStatus: 'in_production', members: ['materials_check', 'in_production', 'qc'], accent: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500' },
  { id: 'ready', label: 'מוכן', leafStatus: 'ready', members: ['ready'], accent: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
];

function columnIdForStatus(status) {
  for (const col of COLUMNS) {
    if (col.members.includes(status)) return col.id;
  }
  return 'queue'; // unknown / null — sit in the inbox
}

// Idempotent: if a shipment already exists for the order, don't create
// another one. The manager may drag back-and-forth between in-production
// and ready, but we don't want a stack of phantom shipments.
async function ensureShipment(order) {
  const existing = await base44.entities.DeliveryShipment.filter({ order_id: order.id });
  if (existing && existing.length > 0) {
    return { created: false, shipment: existing[0] };
  }
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

function OrderCard({ order, dragProvided, isDragging, hasShipment, onPreview, onCall }) {
  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      onClick={() => onPreview?.(order)}
      className={`group flex items-start gap-2 rounded-lg border bg-card p-3 text-sm shadow-sm transition-all cursor-pointer
        ${isDragging ? 'shadow-lg ring-2 ring-primary' : 'hover:border-primary/40 hover:shadow-md'}`}
    >
      <span
        {...(dragProvided?.dragHandleProps || {})}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 text-muted-foreground/50 group-hover:text-muted-foreground"
        title="גרור כדי להעביר עמודה"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold text-primary">#{order.order_number}</span>
          {order.created_date && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {format(new Date(order.created_date), 'dd/MM')}
            </span>
          )}
        </div>
        <p className="truncate font-medium text-foreground">{order.customer_name || 'לקוח'}</p>
        {order.customer_phone && (
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {order.customer_phone}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-1.5">
          {order.production_status && (
            <StatusBadge status={order.production_status} className="text-[10px] py-0 px-1.5" />
          )}
          {hasShipment && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
              <Truck className="h-3 w-3" /> משלוח פתוח
            </span>
          )}
        </div>
      </div>
      {order.customer_phone && (
        <button
          type="button"
          onClick={(e) => {
            // Card click opens the quick-view; we don't want both at once.
            e.stopPropagation();
            onCall?.(order.customer_phone);
          }}
          className="mt-0.5 flex-shrink-0 rounded-full bg-green-100 hover:bg-green-200 active:bg-green-300 p-1.5 text-green-700 transition-colors"
          title={`התקשר ל-${order.customer_phone}`}
        >
          <Phone className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export default function FactoryKanban({ orders, shipmentsByOrderId = {} }) {
  const queryClient = useQueryClient();
  const [previewOrderId, setPreviewOrderId] = useState(null);

  const handleCall = async (phone) => {
    if (!phone) return;
    try {
      await base44.functions.invoke('clickToCall', { customerPhone: phone });
      toast.success(`מתקשר ל-${phone}`);
    } catch (err) {
      toast.error(`חיוג נכשל: ${err?.message || 'שגיאה'}`);
    }
  };

  const orderById = useMemo(() => {
    const m = new Map();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  const grouped = useMemo(() => {
    const out = { queue: [], in_production: [], ready: [] };
    for (const o of orders) {
      const colId = columnIdForStatus(o.production_status);
      out[colId].push(o);
    }
    // Within each column: oldest first so the manager handles FIFO.
    for (const id of Object.keys(out)) {
      out[id].sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
    }
    return out;
  }, [orders]);

  // Single mutation handles BOTH the production_status update and the
  // shipment-create side-effect. Failure on either side toasts and lets
  // react-query refetch settle the column back to its original spot.
  const moveMutation = useMutation({
    mutationFn: async ({ orderId, targetColumnId }) => {
      const order = orderById.get(orderId);
      if (!order) throw new Error('הזמנה לא נמצאה');
      const target = COLUMNS.find((c) => c.id === targetColumnId);
      if (!target) throw new Error('עמודה לא חוקית');

      // Don't clobber materials_check / qc when dropping into the same
      // bucket — only update if the new column is actually different.
      const currentColumn = columnIdForStatus(order.production_status);
      if (currentColumn !== targetColumnId) {
        await base44.entities.Order.update(order.id, { production_status: target.leafStatus });
      }

      // Open the shipment side-effect on the entry into in_production
      // or ready — including the inventory shortcut (queue → ready).
      let shipmentResult = null;
      if (targetColumnId === 'in_production' || targetColumnId === 'ready') {
        shipmentResult = await ensureShipment(order);
      }

      return { order, targetColumnId, shipmentResult };
    },
    onSuccess: ({ targetColumnId, shipmentResult }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['factory-shipments'] });
      const target = COLUMNS.find((c) => c.id === targetColumnId);
      if (shipmentResult?.created) {
        toast.success(`ההזמנה הועברה ל"${target?.label}" · משלוח חדש נפתח לתיאום`);
      } else {
        toast.success(`ההזמנה הועברה ל"${target?.label}"`);
      }
    },
    onError: (err) => {
      toast.error(`העברה נכשלה: ${err?.message || 'שגיאה'}`);
    },
  });

  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    moveMutation.mutate({ orderId: draggableId, targetColumnId: destination.droppableId });
  };

  return (
    <>
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid gap-4 md:grid-cols-3" dir="rtl">
        {COLUMNS.map((col) => {
          const colOrders = grouped[col.id] || [];
          return (
            <Droppable key={col.id} droppableId={col.id}>
              {(dropProvided, dropSnapshot) => (
                <Card
                  ref={dropProvided.innerRef}
                  {...dropProvided.droppableProps}
                  className={`flex flex-col overflow-hidden ${col.accent} ${
                    dropSnapshot.isDraggingOver ? 'ring-2 ring-primary/40' : ''
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                      <span className="font-bold text-foreground">{col.label}</span>
                    </div>
                    <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold text-foreground">
                      {colOrders.length}
                    </span>
                  </div>
                  <div className="min-h-[80px] flex-1 space-y-2 p-2">
                    {colOrders.length === 0 && (
                      <div className="flex flex-col items-center gap-1 py-6 text-xs text-muted-foreground/70">
                        <Package className="h-5 w-5 opacity-50" />
                        {dropSnapshot.isDraggingOver ? 'שחרר כאן' : 'אין הזמנות'}
                      </div>
                    )}
                    {colOrders.map((order, idx) => (
                      <Draggable key={order.id} draggableId={order.id} index={idx}>
                        {(dragProvided, dragSnapshot) => (
                          <OrderCard
                            order={order}
                            dragProvided={dragProvided}
                            isDragging={dragSnapshot.isDragging}
                            hasShipment={!!shipmentsByOrderId[order.id]}
                            onPreview={(o) => setPreviewOrderId(o.id)}
                            onCall={handleCall}
                          />
                        )}
                      </Draggable>
                    ))}
                    {dropProvided.placeholder}
                  </div>
                </Card>
              )}
            </Droppable>
          );
        })}
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
