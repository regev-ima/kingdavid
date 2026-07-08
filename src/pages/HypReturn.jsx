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

  // Hyp uses inconsistent casing across deployments — read the key in any
  // case so we don't miss the transaction Id just because it's `id` or
  // `TransId` instead of `Id`.
  const get = (name) => {
    const direct = params.get(name);
    if (direct !== null) return direct;
    const target = name.toLowerCase();
    for (const [k, v] of params.entries()) {
      if (k.toLowerCase() === target) return v;
    }
    return null;
  };

  const ccode = get('CCode') || '';
  const transactionId = get('Id') || get('TransId') || get('TransactionId') || '';
  // Hyp drops the query string we put on Succesful/Failed and replaces it
  // with its own params, so the `status` we set in hyp-sign never makes it
  // back. Compute it from CCode instead — Hyp's source of truth.
  const explicitStatus = get('status');
  const status = explicitStatus || (ccode === '0' ? 'success' : ccode ? 'failed' : 'unknown');
  const orderId = get('order') || '';
  const allParams = useMemo(() => Object.fromEntries(params.entries()), [params]);

  useEffect(() => {
    // Keep a copy of everything for support / devtools.
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
          all_params: allParams,
        },
        window.location.origin,
      );
    } catch {
      // ignore — parent on a different origin would block postMessage, but
      // our flow keeps everything on the same origin.
    }
  }, [status, orderId, ccode, transactionId, allParams]);

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
      {Object.keys(allParams).length > 0 && (
        <details className="mt-3 text-[10px] text-muted-foreground/70 max-w-xs">
          <summary className="cursor-pointer">פרטי טכניים</summary>
          <pre className="text-start whitespace-pre-wrap break-all" dir="ltr">
            {JSON.stringify(allParams, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
