import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CreditCard, ShieldCheck } from 'lucide-react';

// Client-side companion to hyp-sign / hyp-notify. The dialog:
//   1. Lets the user pick an amount (default: remaining balance).
//   2. Calls hyp-sign to get a signed iframe URL.
//   3. Loads that URL in an iframe so the customer can enter card details.
//   4. Listens for the postMessage that HypReturn fires after Hyp's redirect
//      and closes itself, asking the parent to refresh the order so the new
//      payment row appears (the server-to-server hyp-notify is what actually
//      writes it — see the Edge Function).

export default function HypPaymentDialog({ open, onOpenChange, order, onPaid }) {
  // amount_paid is not a stored column (see the hyp-* Edge Functions) — it's
  // always the sum of the payments array.
  const paid = useMemo(
    () => (order?.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    [order],
  );
  const remaining = useMemo(() => {
    if (!order) return 0;
    const total = Number(order.total || 0);
    return Math.max(0, +(total - paid).toFixed(2));
  }, [order, paid]);

  const [amount, setAmount] = useState('');
  const [iframeUrl, setIframeUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastResultRef = useRef(null);

  // Reset state whenever the dialog re-opens for a new order or attempt.
  useEffect(() => {
    if (!open) return;
    setAmount(remaining > 0 ? String(remaining) : '');
    setIframeUrl(null);
    setError(null);
    lastResultRef.current = null;
  }, [open, remaining]);

  // Listen for HypReturn's postMessage so we can close the dialog and
  // signal the parent to refetch the order.
  useEffect(() => {
    if (!open) return;
    const handler = async (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== 'hyp-return') return;
      console.log('[HypPaymentDialog] received from HypReturn:', data);
      lastResultRef.current = data;
      if (data.status === 'success' && data.transaction_id) {
        // Browser said success — confirm with Hyp's own VERIFY endpoint
        // before we trust it. hyp-verify writes the payment row.
        try {
          const verifyResult = await base44.functions.invoke('hyp-verify', {
            order_id: order?.id,
            transaction_id: data.transaction_id,
            hyp_params: data.all_params || null,
          });
          console.log('[HypPaymentDialog] hyp-verify result:', verifyResult);
          if (verifyResult?.verified) {
            onPaid?.({ ...data, ...verifyResult });
          } else {
            setError(
              `Hyp לא אישר את העסקה (CCode=${verifyResult?.ccode || data.ccode || '-'}). אל תסגור את הדף — בדוק ב-Hyp dashboard.`,
            );
          }
        } catch (err) {
          console.error('[HypPaymentDialog] hyp-verify error:', err);
          setError(`אימות מול Hyp נכשל: ${err?.message || err}`);
        }
      } else if (data.status === 'success') {
        // Hyp said success but didn't give us an Id — can't verify or record.
        setError(
          `Hyp דיווח על הצלחה אך לא החזיר Id של העסקה. פרמטרים שהתקבלו: ${
            JSON.stringify(data.all_params || {})
          }`,
        );
      } else {
        setError(`Hyp דחה את התשלום (CCode=${data.ccode || '-'})`);
      }
      // small delay so the user briefly sees the result inside the iframe
      setTimeout(() => onOpenChange(false), 1200);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [open, onOpenChange, onPaid, order?.id]);

  const startPayment = async () => {
    setError(null);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('סכום לא תקין');
      return;
    }
    if (numericAmount > remaining + 0.001) {
      setError(`הסכום חורג מהיתרה לתשלום (₪${remaining.toLocaleString()})`);
      return;
    }
    setLoading(true);
    try {
      const data = await base44.functions.invoke('hyp-sign', {
        order_id: order.id,
        amount: numericAmount,
        return_origin: window.location.origin,
      });
      if (!data?.iframe_url) {
        throw new Error(data?.error || 'לא התקבל URL לתשלום');
      }
      setIframeUrl(data.iframe_url);
    } catch (err) {
      setError(err?.message || 'שגיאה ביצירת תשלום');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[1100px] max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            תשלום באשראי
          </DialogTitle>
        </DialogHeader>

        {!iframeUrl ? (
          // Keep the amount form tidy/centered now that the dialog is wide.
          <div className="space-y-4 py-2 w-full max-w-md mx-auto">
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">סה״כ הזמנה:</span>
                <span>₪{Number(order?.total || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">שולם עד כה:</span>
                <span>₪{paid.toLocaleString()}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                <span>יתרה לתשלום:</span>
                <span>₪{remaining.toLocaleString()}</span>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">סכום לחיוב</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground">
                ניתן לשלם את היתרה במלואה או חלקית (מקדמה).
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              סליקה מאובטחת דרך Hyp. פרטי הכרטיס לא נשמרים אצלנו.
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                ביטול
              </Button>
              <Button onClick={startPayment} disabled={loading || remaining <= 0}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
                המשך לתשלום
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <iframe
              src={iframeUrl}
              title="תשלום Hyp"
              className="w-full h-[80vh] max-h-[82vh] border-0 rounded-lg"
              allow="payment"
            />
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
