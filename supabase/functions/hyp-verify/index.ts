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

    let hypReply = await callHyp('VERIFY');
    if (!hypReply || (getCi(hypReply, 'CCode') ?? '') === '') {
      hypReply = await callHyp('STATUS');
    }

    if (!hypReply) {
      return Response.json(
        { error: 'Hyp verify call failed' },
        { status: 502, headers: corsHeaders },
      );
    }

    const ccode = getCi(hypReply, 'CCode');
    const verifiedAmount = Number(getCi(hypReply, 'Amount') ?? '0');
    const acode = getCi(hypReply, 'ACode') ?? '';
    const brand = getCi(hypReply, 'Brand') ?? '';
    const l4digit = getCi(hypReply, 'L4digit', 'L4Digit', 'last4') ?? '';

    if (ccode !== '0') {
      console.warn('hyp-verify: Hyp says transaction did not succeed', {
        transactionId,
        ccode,
        hypReply: Object.fromEntries(hypReply),
      });
      return Response.json(
        { verified: false, ccode, hyp_reply: Object.fromEntries(hypReply) },
        { status: 200, headers: corsHeaders },
      );
    }
    if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      return Response.json(
        { error: 'Hyp returned no usable amount', hyp_reply: Object.fromEntries(hypReply) },
        { status: 502, headers: corsHeaders },
      );
    }

    const supabase = createServiceClient();
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, total, payments, amount_paid')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return Response.json(
        { error: 'Order not found' },
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
      hyp_acode: acode,
      hyp_brand: brand,
      hyp_l4digit: l4digit,
    };

    const updatedPayments = [...existingPayments, paymentEntry];
    const totalPaid = updatedPayments.reduce((sum, p) => sum + (Number((p as any)?.amount) || 0), 0);
    const newStatus = calcPaymentStatus(updatedPayments, Number(order.total ?? 0));

    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        payments: updatedPayments,
        amount_paid: totalPaid,
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
