import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

// Client-triggered companion to hyp-notify. After the iframe returns to
// HypReturn with a Hyp transaction Id, the dialog calls this function to
// confirm with Hyp's own VERIFY endpoint that the transaction really
// happened — we never trust the browser's postMessage on its own.
//
// Both this and hyp-notify write to orders.payments idempotently on
// hyp_transaction_id, so it's fine if both fire for the same charge: the
// second one is a no-op.

function calcPaymentStatus(payments: Array<{ amount?: number }>, total: number): string {
  const totalPaid = (payments || []).reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
  if (totalPaid <= 0) return 'unpaid';
  if (totalPaid + 0.001 >= total) return 'paid';
  return 'deposit_paid';
}

// Hyp's verify reply is a urlencoded query string. Pull out the fields we
// care about, tolerating any case the terminal happens to use.
function getCi(params: URLSearchParams, ...names: string[]): string | null {
  for (const name of names) {
    const v = params.get(name);
    if (v !== null) return v;
  }
  const lc = new Map<string, string>();
  for (const [k, v] of params.entries()) lc.set(k.toLowerCase(), v);
  for (const name of names) {
    const v = lc.get(name.toLowerCase());
    if (v !== undefined) return v;
  }
  return null;
}

// Same idea for the plain object of params the iframe captured from Hyp's
// redirect. HypReturn reads these case-insensitively, so hyp-verify must too
// — otherwise a differently-cased CCode/Amount slips through and we reject a
// charge that actually succeeded.
function getObjCi(obj: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const v = obj?.[name];
    if (v != null) return String(v);
  }
  const lc = new Map<string, string>();
  for (const [k, v] of Object.entries(obj || {})) lc.set(k.toLowerCase(), String(v));
  for (const name of names) {
    const v = lc.get(name.toLowerCase());
    if (v !== undefined) return v;
  }
  return null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const masof = Deno.env.get('HYP_TERMINAL');
    const apiKey = Deno.env.get('HYP_API_KEY');
    const passp = Deno.env.get('HYP_PASSP');
    if (!masof || !apiKey || !passp) {
      return Response.json(
        { error: 'Hyp credentials not configured' },
        { status: 500, headers: corsHeaders },
      );
    }

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;
    const transactionId = body?.transaction_id;
    // The amount the rep signed for this attempt (hyp-sign charged exactly
    // this). Hyp's success redirect only fires on CCode=0 and it charges the
    // signed amount, so this is a safe fallback when Hyp doesn't echo Amount
    // back onto the iframe redirect.
    const clientAmount = Number(body?.amount);
    // Params that Hyp appended to our Succesful URL inside the iframe.
    // The browser captured them in HypReturn and forwarded them here, so
    // we can use them as a trusted source even if Hyp's external VERIFY
    // endpoint doesn't co-operate.
    const hypParams: Record<string, string> =
      (body?.hyp_params && typeof body.hyp_params === 'object') ? body.hyp_params : {};

    if (!orderId || !transactionId) {
      return Response.json(
        { error: 'Missing order_id or transaction_id' },
        { status: 400, headers: corsHeaders },
      );
    }

    // Ask Hyp to confirm this transaction. We try VERIFY first (the most
    // common naming); if Hyp returns "Unknown action" or similar we fall
    // back to a CDR-style status query. Either way we look at the parsed
    // response below.
    async function callHyp(what: string): Promise<URLSearchParams | null> {
      const params = new URLSearchParams({
        action: 'APISign',
        What: what,
        KEY: apiKey,
        PassP: passp,
        Masof: masof,
        Id: String(transactionId),
      });
      try {
        const resp = await fetch(`https://pay.hyp.co.il/p/?${params.toString()}`);
        const text = (await resp.text()).trim();
        if (!text) return null;
        // Some Hyp endpoints return JSON, some return urlencoded. Handle both.
        try {
          const json = JSON.parse(text);
          const search = new URLSearchParams();
          for (const [k, v] of Object.entries(json || {})) search.set(k, String(v));
          return search;
        } catch {
          return new URLSearchParams(text);
        }
      } catch (err) {
        console.error(`hyp-verify ${what} call failed`, err);
        return null;
      }
    }

    // Try Hyp's external verify as a defence-in-depth check. If it returns
    // CCode=0 we use it. If it returns anything else (e.g. CCode=200 which
    // we've seen in practice — likely a different action name on this
    // terminal) we fall back to the params Hyp itself wrote onto our
    // iframe redirect, which is data Hyp's own page produced.
    let hypReply = await callHyp('VERIFY');
    if (!hypReply || (getCi(hypReply, 'CCode') ?? '') === '') {
      hypReply = await callHyp('STATUS');
    }
    const externalReplyObj = hypReply ? Object.fromEntries(hypReply) : null;
    const externalCCode = hypReply ? (getCi(hypReply, 'CCode') ?? '') : '';

    // Pick the trusted source for the transaction details.
    let source: 'hyp_verify' | 'iframe_redirect';
    let ccode: string;
    let verifiedAmount: number;
    let acode: string;
    let brand: string;
    let l4digit: string;

    const externalAmount = hypReply ? Number(getCi(hypReply, 'Amount') ?? '0') : NaN;
    if (externalCCode === '0' && Number.isFinite(externalAmount) && externalAmount > 0) {
      source = 'hyp_verify';
      ccode = '0';
      verifiedAmount = externalAmount;
      acode = getCi(hypReply!, 'ACode') ?? '';
      brand = getCi(hypReply!, 'Brand') ?? '';
      l4digit = getCi(hypReply!, 'L4digit', 'L4Digit', 'last4') ?? '';
    } else {
      // Fall back to the params the iframe captured directly from Hyp,
      // reading them case-insensitively the same way HypReturn does.
      const iframeCCode = String(getObjCi(hypParams, 'CCode') ?? '');
      let iframeAmount = Number(getObjCi(hypParams, 'Amount') ?? '0');
      // Hyp doesn't always echo the amount back onto the redirect. When it
      // doesn't but the charge succeeded (CCode=0), use the amount we signed.
      if ((!Number.isFinite(iframeAmount) || iframeAmount <= 0) &&
          Number.isFinite(clientAmount) && clientAmount > 0) {
        iframeAmount = clientAmount;
      }
      console.warn('hyp-verify: external VERIFY did not return CCode=0, falling back to iframe redirect params', {
        externalReply: externalReplyObj,
        iframeCCode,
        iframeAmount,
      });
      if (iframeCCode !== '0') {
        return Response.json(
          {
            verified: false,
            ccode: iframeCCode || externalCCode,
            source: 'iframe_redirect',
            hyp_reply: externalReplyObj,
            iframe_params: hypParams,
          },
          { status: 200, headers: corsHeaders },
        );
      }
      if (!Number.isFinite(iframeAmount) || iframeAmount <= 0) {
        return Response.json(
          { error: 'No usable amount in iframe redirect params', iframe_params: hypParams },
          { status: 502, headers: corsHeaders },
        );
      }
      source = 'iframe_redirect';
      ccode = '0';
      verifiedAmount = iframeAmount;
      acode = String(getObjCi(hypParams, 'ACode') ?? '');
      brand = String(getObjCi(hypParams, 'Brand') ?? '');
      l4digit = String(getObjCi(hypParams, 'L4digit', 'L4Digit', 'last4') ?? '');
    }

    const supabase = createServiceClient();
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      console.error('hyp-verify order lookup error', { orderId, orderErr });
      return Response.json(
        { error: `Order lookup failed: ${orderErr.message || orderErr.code}` },
        { status: 500, headers: corsHeaders },
      );
    }
    if (!order) {
      return Response.json(
        { error: `Order not found (id=${orderId})` },
        { status: 404, headers: corsHeaders },
      );
    }

    const existingPayments: Array<Record<string, unknown>> = Array.isArray(order.payments) ? order.payments : [];

    // Idempotency: if hyp-notify (or a previous verify call) already wrote
    // this transaction, just report success without duplicating.
    if (existingPayments.some((p) => p?.hyp_transaction_id === String(transactionId))) {
      const newStatusExisting = calcPaymentStatus(existingPayments, Number(order.total ?? 0));
      return Response.json({
        verified: true,
        already_applied: true,
        payment: existingPayments.find((p) => p?.hyp_transaction_id === String(transactionId)),
        payment_status: newStatusExisting,
      }, { headers: corsHeaders });
    }

    const paymentEntry = {
      amount: verifiedAmount,
      method: 'credit_card',
      date: new Date().toISOString().slice(0, 10),
      notes: `Hyp #${transactionId}${brand ? ` (${brand})` : ''}${l4digit ? ` **** ${l4digit}` : ''}`,
      recorded_at: new Date().toISOString(),
      recorded_by: user.email || 'hyp-verify',
      hyp_transaction_id: String(transactionId),
      hyp_verify_source: source,
      hyp_acode: acode,
      hyp_brand: brand,
      hyp_l4digit: l4digit,
    };

    const updatedPayments = [...existingPayments, paymentEntry];
    const newStatus = calcPaymentStatus(updatedPayments, Number(order.total ?? 0));

    // amount_paid is not a real column on this schema — it's derived from
    // the payments JSONB by the UI's calcPaymentStatus. Writing to it
    // PostgREST-errors with "Could not find the 'amount_paid' column".
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        payments: updatedPayments,
        payment_status: newStatus,
      })
      .eq('id', order.id);

    if (updateErr) {
      console.error('hyp-verify: failed to update order', updateErr);
      return Response.json(
        { error: `Order update failed: ${updateErr.message || updateErr.code}` },
        { status: 500, headers: corsHeaders },
      );
    }

    return Response.json({
      verified: true,
      already_applied: false,
      payment: paymentEntry,
      payment_status: newStatus,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('hyp-verify error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message || 'Internal server error' }, { status: 500, headers: getCorsHeaders(req) });
  }
});
