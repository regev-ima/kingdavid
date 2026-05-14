import { createServiceClient } from '../_shared/supabase.ts';

// Server-to-server callback from Hyp. The notify URL configured in the Hyp
// dashboard points to this function. Hyp POSTs (or in some configurations
// GETs) the transaction outcome here independently of the user's browser, so
// we don't have to trust postMessage from the iframe.
//
// We verify the transaction by asking Hyp's own APISign endpoint to confirm
// the result for the given Id — that way we don't have to reverse-engineer
// the exact Sign-hash algorithm, and we're protected against a forged POST
// to this URL.

const PAYMENT_STATUS_PAID = 'paid';
const PAYMENT_STATUS_DEPOSIT = 'deposit_paid';
const PAYMENT_STATUS_UNPAID = 'unpaid';

function calcPaymentStatus(payments: Array<{ amount?: number }>, total: number): string {
  const totalPaid = (payments || []).reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
  if (totalPaid <= 0) return PAYMENT_STATUS_UNPAID;
  if (totalPaid + 0.001 >= total) return PAYMENT_STATUS_PAID;
  return PAYMENT_STATUS_DEPOSIT;
}

async function parseIncomingParams(req: Request): Promise<URLSearchParams> {
  const url = new URL(req.url);
  // Hyp sometimes uses GET (query string) and sometimes POST
  // (form-urlencoded). Cover both.
  if (req.method === 'GET') return url.searchParams;
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await req.text();
    return new URLSearchParams(body);
  }
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body || {})) params.set(k, String(v));
    return params;
  }
  // Last-resort: try query string anyway.
  return url.searchParams;
}

async function verifyTransactionWithHyp(params: URLSearchParams): Promise<boolean> {
  const masof = Deno.env.get('HYP_TERMINAL');
  const apiKey = Deno.env.get('HYP_API_KEY');
  const passp = Deno.env.get('HYP_PASSP');
  const transactionId = params.get('Id');
  if (!masof || !apiKey || !passp || !transactionId) return false;

  // Hyp's verify endpoint: ask them to confirm the transaction. The exact
  // What value may need tweaking ('VERIFY' / 'STATUS') based on the
  // terminal's contract — start with VERIFY which is the most common.
  const verifyParams = new URLSearchParams({
    action: 'APISign',
    What: 'VERIFY',
    KEY: apiKey,
    PassP: passp,
    Masof: masof,
    Id: transactionId,
  });
  try {
    const resp = await fetch(`https://pay.hyp.co.il/p/?${verifyParams.toString()}`);
    const text = (await resp.text()).trim();
    // A successful verify response includes CCode=0 somewhere in the
    // returned query string.
    if (text.startsWith('CCode=0') || text.includes('&CCode=0') || text.includes('CCode=0&')) {
      return true;
    }
    console.warn('Hyp verify did not return CCode=0:', text.slice(0, 300));
    return false;
  } catch (err) {
    console.error('Hyp verify call failed:', err);
    return false;
  }
}

Deno.serve(async (req) => {
  // Hyp is a server, not a browser — no CORS needed. Always respond 200 with
  // a short body so Hyp doesn't keep retrying on unexpected statuses.
  const ok = () => new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });

  if (req.method === 'OPTIONS') return ok();

  try {
    const params = await parseIncomingParams(req);
    const orderParam = params.get('Order') || '';
    const ccode = params.get('CCode');
    const transactionId = params.get('Id') || '';
    const amount = Number(params.get('Amount') || '0');
    const l4digit = params.get('L4digit') || '';
    const brand = params.get('Brand') || '';
    const acode = params.get('ACode') || '';

    console.log('hyp-notify received', {
      Order: orderParam,
      CCode: ccode,
      Id: transactionId,
      Amount: amount,
    });

    if (ccode !== '0') {
      console.log('hyp-notify: non-success CCode, nothing to apply');
      return ok();
    }
    if (!orderParam || !transactionId || !Number.isFinite(amount) || amount <= 0) {
      console.warn('hyp-notify: missing required fields');
      return ok();
    }

    // Order param shape from hyp-sign: "<order_uuid>__<timestampBase36>".
    const orderId = orderParam.split('__')[0];
    if (!orderId) {
      console.warn('hyp-notify: could not extract order_id from Order param', orderParam);
      return ok();
    }

    const verified = await verifyTransactionWithHyp(params);
    if (!verified) {
      console.warn('hyp-notify: Hyp verify failed, refusing to apply payment', { orderId, transactionId });
      return ok();
    }

    const supabase = createServiceClient();
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, total, payments')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      console.warn('hyp-notify: order not found', { orderId, error: orderErr });
      return ok();
    }

    const existingPayments: Array<Record<string, unknown>> = Array.isArray(order.payments) ? order.payments : [];

    // Idempotency: if Hyp retries the notify, don't add the same transaction
    // twice. The Hyp transaction Id is globally unique per terminal.
    if (existingPayments.some((p) => p?.hyp_transaction_id === transactionId)) {
      console.log('hyp-notify: transaction already recorded, skipping', { transactionId });
      return ok();
    }

    const paymentEntry = {
      amount,
      method: 'credit_card',
      date: new Date().toISOString().slice(0, 10),
      notes: `Hyp #${transactionId}${brand ? ` (${brand})` : ''}${l4digit ? ` **** ${l4digit}` : ''}`,
      recorded_at: new Date().toISOString(),
      recorded_by: 'hyp-notify',
      hyp_transaction_id: transactionId,
      hyp_attempt_id: orderParam,
      hyp_acode: acode,
      hyp_brand: brand,
      hyp_l4digit: l4digit,
    };

    const updatedPayments = [...existingPayments, paymentEntry];
    const newStatus = calcPaymentStatus(updatedPayments, Number(order.total ?? 0));

    // amount_paid is not a real column on this schema (derived from the
    // payments JSONB by the UI). Writing it PostgREST-errors out.
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        payments: updatedPayments,
        payment_status: newStatus,
      })
      .eq('id', order.id);

    if (updateErr) {
      console.error('hyp-notify: failed to update order', updateErr);
      return ok();
    }

    console.log('hyp-notify: applied payment', {
      orderId: order.id,
      amount,
      transactionId,
      newStatus,
    });
    return ok();
  } catch (error) {
    console.error('hyp-notify error:', error);
    return ok();
  }
});
