import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Ban, Loader2, RotateCcw } from 'lucide-react';
import { cancelOrder, reactivateOrder } from '@/lib/cancelOrder';

// Cancelling an order, and undoing it. Deliberately separate from
// DeleteOrderDialog: that one erases, this one records that the sale fell
// through. The dialog spells out the money consequences, because they are the
// whole difference between the two.
export default function CancelOrderDialog({ open, onOpenChange, order, currentUserEmail, onDone }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const isCancelled = Boolean(order?.cancelled_at);

  useEffect(() => { if (open) setReason(''); }, [open]);

  const run = useMutation({
    mutationFn: () => (isCancelled
      ? reactivateOrder(order)
      : cancelOrder(order, { reason, cancelledBy: currentUserEmail })),
    onSuccess: () => {
      toast.success(isCancelled
        ? `הזמנה #${order?.order_number} הופעלה מחדש`
        : `הזמנה #${order?.order_number} בוטלה`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', order?.id] });
      queryClient.invalidateQueries({ queryKey: ['commission', order?.id] });
      queryClient.invalidateQueries({ queryKey: ['shipment', order?.id] });
      onOpenChange(false);
      onDone?.(order);
    },
    onError: (err) => {
      const parts = [err?.message, err?.details, err?.hint, err?.code]
        .map((p) => (p == null || p === '' ? null : String(p)))
        .filter(Boolean);
      toast.error(`הפעולה נכשלה: ${parts.join(' — ') || 'שגיאה לא ידועה'}`, { duration: 10000 });
      console.error('cancelOrder failed', err);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!run.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCancelled
              ? <><RotateCcw className="h-5 w-5 text-primary" /> הפעלת הזמנה מחדש</>
              : <><Ban className="h-5 w-5 text-amber-600" /> ביטול הזמנה</>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1 text-sm">
          <p>
            הזמנה <span className="font-semibold">#{order?.order_number}</span>
            {order?.customer_name ? <> של <span className="font-semibold">{order.customer_name}</span></> : null}
            {isCancelled ? ' תחזור להיות פעילה.' : ' תסומן כמבוטלת.'}
          </p>

          {isCancelled ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5 text-xs">
              <p className="font-semibold">מה יקרה:</p>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>• העמלה תחזור לסטטוס "ממתין" (לא ל"מאושר" — האישור נקבע מחדש לפי התשלום)</li>
                <li>• המשלוח יחזור ל"לתאום"</li>
                <li>• סה״כ ההזמנות וה-LTV של הלקוח יעודכנו בחזרה</li>
              </ul>
              {order?.cancel_reason ? (
                <p className="pt-1 text-muted-foreground">סיבת הביטול הקודמת: {order.cancel_reason}</p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5 text-xs text-amber-900">
                <p className="font-semibold">מה יקרה:</p>
                <ul className="space-y-0.5">
                  <li>• ההזמנה תישאר ברשימה עם תג "בוטל" — לא נמחקת</li>
                  <li>• העמלה תבוטל ולא תיכלל בתשלום לנציג</li>
                  <li>• ההזמנה תצא מספירת ההכנסות ומהמדדים</li>
                  <li>• המשלוח יבוטל ויצא מתור התיאום</li>
                  <li>• סה״כ ההזמנות וה-LTV של הלקוח יקוזזו ב-₪{(order?.total || 0).toLocaleString()}</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                סטטוסי התשלום, הייצור והמשלוח נשארים כפי שהם — כדי שיישאר תיעוד של המצב שבו ההזמנה בוטלה.
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">סיבת ביטול (אופציונלי)</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="הלקוח התחרט, נמצא זול יותר, כפילות..."
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={run.isPending}>
            סגור
          </Button>
          <Button
            variant={isCancelled ? 'default' : 'destructive'}
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            {run.isPending ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : null}
            {isCancelled ? 'הפעל מחדש' : 'בטל הזמנה'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
