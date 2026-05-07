import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import StatusBadge from '@/components/shared/StatusBadge';
import { Phone, ExternalLink, Truck, FileText, Package } from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { base44 } from '@/api/base44Client';

const PRODUCTION_STATUS_OPTIONS = [
  { value: 'not_started', label: 'בתור לייצור' },
  { value: 'in_production', label: 'ייצור' },
  { value: 'ready', label: 'מוכן' },
];

function formatCurrency(value) {
  if (value == null || value === '') return '-';
  return `₪${Number(value || 0).toLocaleString()}`;
}

// A compact peek at the order without forcing the manager off the
// kanban. Heavy detail (full items, price breakdown, notes history)
// stays on the OrderDetails page — this is intentionally a summary.
export default function OrderQuickView({ order, shipment, isOpen, onClose, onCall }) {
  const queryClient = useQueryClient();

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }) =>
      base44.entities.Order.update(orderId, { production_status: status }),
    onSuccess: (_data, variables) => {
      const label = PRODUCTION_STATUS_OPTIONS.find((o) => o.value === variables.status)?.label || variables.status;
      toast.success(`הסטטוס עודכן ל"${label}"`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['factory-shipments'] });
    },
    onError: (err) => toast.error(`עדכון נכשל: ${err?.message || 'שגיאה'}`),
  });

  if (!order) return null;
  const phone = order.customer_phone;
  const fullOrderUrl = createPageUrl('OrderDetails') + `?id=${order.id}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-primary">#{order.order_number}</span>
            <span className="font-normal text-foreground">· {order.customer_name || 'לקוח'}</span>
          </DialogTitle>
          {order.created_date && (
            <DialogDescription>
              נוצרה {format(new Date(order.created_date), 'dd/MM/yyyy HH:mm')}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* Status row */}
          <div className="flex flex-wrap gap-2">
            {order.production_status && <StatusBadge status={order.production_status} />}
            {order.payment_status && <StatusBadge status={order.payment_status} />}
            {shipment?.status && (
              <span className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 ring-1 ring-cyan-200">
                <Truck className="h-3 w-3" /> משלוח: <StatusBadge status={shipment.status} className="!bg-transparent !ring-0 !p-0 !text-cyan-700" />
              </span>
            )}
          </div>

          {/* Status changer — saves immediately. The drag-and-drop boards
              are great for bulk shuffles, but a single status flip from
              an open card shouldn't require closing the modal first. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              סטטוס ייצור
            </div>
            <Select
              value={
                order.production_status === 'materials_check' || order.production_status === 'qc'
                  ? 'in_production'
                  : order.production_status || 'not_started'
              }
              onValueChange={(value) => {
                if (value === order.production_status) return;
                updateStatusMutation.mutate({ orderId: order.id, status: value });
              }}
              disabled={updateStatusMutation.isPending}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contact */}
          {phone && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">לקוח</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{order.customer_name}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">{phone}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCall?.(phone)}
                  className="h-8 gap-1 border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                >
                  <Phone className="h-3.5 w-3.5" />
                  התקשר
                </Button>
              </div>
            </div>
          )}

          {/* Total */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">סכום</div>
            <p className="mt-1 text-lg font-bold text-foreground">{formatCurrency(order.total)}</p>
          </div>

          {/* Items — first 5, count the rest */}
          {Array.isArray(order.items) && order.items.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Package className="h-3 w-3" /> פריטים ({order.items.length})
              </div>
              <ul className="space-y-1.5 text-sm">
                {order.items.slice(0, 5).map((item, idx) => {
                  const hasDims = item.length_cm && item.width_cm;
                  const addonCount = (item.selected_addons || []).length;
                  return (
                    <li key={idx} className="border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-foreground">
                          {item.product_name || item.name || item.sku || 'פריט'}
                        </span>
                        {item.quantity != null && (
                          <span className="flex-shrink-0 text-xs font-medium text-muted-foreground tabular-nums">×{item.quantity}</span>
                        )}
                      </div>
                      {(hasDims || item.sku || addonCount > 0) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          {hasDims && (
                            <span className="font-medium text-primary">
                              {item.length_cm}×{item.width_cm}{item.height_cm ? `×${item.height_cm}` : ''} ס"מ
                            </span>
                          )}
                          {item.sku && <span dir="ltr">{item.sku}</span>}
                          {addonCount > 0 && <span>+ {addonCount} תוספות</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
                {order.items.length > 5 && (
                  <li className="text-center text-xs text-muted-foreground/70">+ {order.items.length - 5} נוספים</li>
                )}
              </ul>
            </div>
          )}

          {/* Factory notes — read-only summary; full edit lives in OrderDetails. */}
          {order.notes_factory && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3 w-3" /> הערות מפעל
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground/80">{order.notes_factory}</p>
            </div>
          )}

          {/* Footer CTA */}
          <Link to={fullOrderUrl} onClick={onClose}>
            <Button className="w-full gap-1.5">
              <ExternalLink className="h-4 w-4" />
              פתח הזמנה מלאה
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
