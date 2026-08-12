import { createServiceClient } from '../_shared/supabase.ts';
import {
  readErrorMessage,
  readIdNumber,
  readPaymentsCount,
  recordPaymentAttempt,
  updateOrderWithSchemaFallback,
} from '../_shared/hyp.ts';

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
    // Installments and the payer's ת.ז., both printed on the order PDF.
    const paymentsCount = readPaymentsCount(params);
    const idNumber = readIdNumber(params);

    console.log('hyp-notify received', {
      Order: orderParam,
      CCode: ccode,
      Id: transactionId,
      Amount: amount,
    });

    // Order param shape from hyp-sign: "<order_uuid>__<timestampBase36>".
    const orderId = orderParam.split('__')[0];
    if (!orderId) {
      console.warn('hyp-notify: could not extract order_id from Order param', orderParam);
      return ok();
    }

    const supabase = createServiceClient();

    // A declined card used to end here — "non-success CCode, nothing to apply"
    // — and vanish. This is the reliable channel: Hyp posts it server to
    // server, so it arrives even when the browser closed, 404'd on the return
    // URL, or lost the network. It is the one place a failure is guaranteed to
    // be heard, so it is the one place worth writing it down.
    if (ccode !== '0') {
      const { data: failedOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (failedOrder) {
        await recordPaymentAttempt(supabase, failedOrder, {
          hyp_transaction_id: transactionId || null,
          hyp_attempt_id: orderParam,
          status: 'declined',
          ccode,
          err_msg: readErrorMessage(params) || null,
          amount: Number.isFinite(amount) && amount > 0 ? amount : null,
          source: 'hyp-notify',
          recorded_by: 'hyp-notify',
          hyp_params: Object.fromEntries(params),
        });
      }
      console.log('hyp-notify: declined attempt recorded', { orderId, transactionId, ccode });
      return ok();
    }

    if (!orderParam || !transactionId || !Number.isFinite(amount) || amount <= 0) {
      console.warn('hyp-notify: missing required fields');
      return ok();
    }

    const verified = await verifyTransactionWithHyp(params);
    if (!verified) {
      // Hyp said CCode=0 but our confirmation call didn't agree. Refusing to
      // book the money is right — but staying silent about it was not: this is
      // the exact state a rep needs flagged, because the card may well have
      // been charged.
      const { data: unresolvedOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (unresolvedOrder) {
        await recordPaymentAttempt(supabase, unresolvedOrder, {
          hyp_transaction_id: transactionId,
          hyp_attempt_id: orderParam,
          status: 'unknown',
          ccode,
          err_msg: readErrorMessage(params) || null,
          amount,
          source: 'hyp-notify',
          recorded_by: 'hyp-notify',
          hyp_params: Object.fromEntries(params),
        });
      }
      console.warn('hyp-notify: Hyp verify failed, payment not applied — logged as unresolved', { orderId, transactionId });
      return ok();
    }

    // `*` rather than a column list: naming customer_id_number explicitly would
    // make the whole lookup — and with it the payment — fail on a database that
    // hasn't run the migration yet.
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
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
      hyp_payments_count: paymentsCount,
      hyp_user_id: idNumber,
    };

    const updatedPayments = [...existingPayments, paymentEntry];
    const newStatus = calcPaymentStatus(updatedPayments, Number(order.total ?? 0));

    // amount_paid is not a real column on this schema (derived from the
    // payments JSONB by the UI). Writing it PostgREST-errors out.
    const orderUpdate: Record<string, unknown> = {
      payments: updatedPayments,
      payment_status: newStatus,
    };
    // Same rule as hyp-verify: the first charge that carries a ת.ז. fills the
    // order's field, and a later one never overwrites it.
    if (idNumber && !String(order.customer_id_number || '').trim()) {
      orderUpdate.customer_id_number = idNumber;
    }

    const updateErr = await updateOrderWithSchemaFallback(supabase, order.id, orderUpdate);

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
