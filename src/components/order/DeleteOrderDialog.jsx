import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { collectOrderDependents, deleteOrderCascade, DEPENDENT_LABELS } from '@/lib/deleteOrder';

// Admin-only confirmation for deleting an order. It names the order, and lists
// exactly which linked records go with it — an admin clearing test data should
// not have to guess whether a commission or a service ticket is about to
// disappear too.
export default function DeleteOrderDialog({ open, onOpenChange, order, onDeleted }) {
  const queryClient = useQueryClient();

  const { data: dependents, isLoading } = useQuery({
    queryKey: ['order-dependents', order?.id],
    queryFn: () => collectOrderDependents(order.id),
    enabled: !!order?.id && open,
    staleTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrderCascade(order),
    onSuccess: () => {
      toast.success(`הזמנה #${order?.order_number} נמחקה`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', order?.id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
      onDeleted?.(order);
    },
    onError: (err) => {
      const parts = [err?.message, err?.details, err?.hint, err?.code]
        .map((p) => (p == null || p === '' ? null : String(p)))
        .filter(Boolean);
      toast.error(`מחיקת ההזמנה נכשלה: ${parts.join(' — ') || 'שגיאה לא ידועה'}`, { duration: 10000 });
      console.error('deleteOrder failed', err);
    },
  });

  const linked = Object.entries(dependents?.counts || {}).filter(([, n]) => n > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!deleteMutation.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            מחיקת הזמנה
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1 text-sm">
          <p>
            הזמנה <span className="font-semibold">#{order?.order_number}</span>
            {order?.customer_name ? <> של <span className="font-semibold">{order.customer_name}</span></> : null}
            {' '}תימחק לצמיתות. לא ניתן לשחזר.
          </p>

          <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-red-800">יימחקו יחד עם ההזמנה:</p>
            {isLoading ? (
              <p className="text-xs text-red-700 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                בודק רשומות מקושרות...
              </p>
            ) : linked.length === 0 ? (
              <p className="text-xs text-red-700">אין רשומות מקושרות — רק ההזמנה עצמה.</p>
            ) : (
              <ul className="text-xs text-red-700 space-y-0.5">
                {linked.map(([key, n]) => (
                  <li key={key}>• {DEPENDENT_LABELS[key]}: {n}</li>
                ))}
              </ul>
            )}
          </div>

          {order?.customer_id ? (
            <p className="text-xs text-muted-foreground">
              נתוני הלקוח יתעדכנו בהתאם: סה״כ הזמנות פחות 1, ו-LTV יקוזז ב-
              ₪{(order?.total || 0).toLocaleString()}.
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleteMutation.isPending}>
            ביטול
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending || isLoading}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-1.5 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 me-1.5" />
            )}
            מחק לצמיתות
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
