import { useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// Hyp redirects the iframe to this page after a payment attempt. We extract
// the result from the query string, forward it to the parent window via
// postMessage so HypPaymentDialog can close itself, and render a small
// confirmation in case anyone is looking at the iframe directly.

export default function HypReturn() {
  const params = useMemo(
    () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    [],
  );

  const status = params.get('status') || 'unknown';
  const orderId = params.get('order') || '';
  const ccode = params.get('CCode') || '';
  const transactionId = params.get('Id') || '';

  useEffect(() => {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) {
      return;
    }
    try {
      window.parent.postMessage(
        {
          source: 'hyp-return',
          status,
          order: orderId,
          ccode,
          transaction_id: transactionId,
        },
        window.location.origin,
      );
    } catch {
      // ignore — parent on a different origin would block postMessage, but
      // our flow keeps everything on the same origin.
    }
  }, [status, orderId, ccode, transactionId]);

  const isSuccess = status === 'success';

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
      {isSuccess ? (
        <>
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <p className="font-medium">התשלום הושלם</p>
          <p className="text-xs text-muted-foreground">החלון ייסגר אוטומטית.</p>
        </>
      ) : status === 'failed' ? (
        <>
          <XCircle className="h-12 w-12 text-red-500" />
          <p className="font-medium">התשלום נכשל</p>
          {ccode && (
            <p className="text-xs text-muted-foreground">קוד שגיאה: {ccode}</p>
          )}
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">מעבד תשלום…</p>
        </>
      )}
    </div>
  );
}
