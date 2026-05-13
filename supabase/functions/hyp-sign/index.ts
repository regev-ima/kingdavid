import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

// Step 1 of the Hyp payment flow: ask Hyp to sign a payment URL on the
// server. We never expose Masof/KEY/PassP to the browser — the client only
// receives the signed iframe URL it should load.

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
        { error: 'Hyp credentials not configured (HYP_TERMINAL / HYP_API_KEY / HYP_PASSP)' },
        { status: 500, headers: corsHeaders },
      );
    }

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id;
    const requestedAmount = Number(body?.amount);
    const returnOrigin = body?.return_origin || req.headers.get('origin') || '';

    if (!orderId) {
      return Response.json({ error: 'Missing order_id' }, { status: 400, headers: corsHeaders });
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return Response.json({ error: 'Invalid amount' }, { status: 400, headers: corsHeaders });
    }
    if (!returnOrigin) {
      return Response.json({ error: 'Missing return_origin' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, customer_phone, customer_email, total, amount_paid')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return Response.json({ error: 'Order not found' }, { status: 404, headers: corsHeaders });
    }

    const remaining = Math.max(0, Number(order.total ?? 0) - Number(order.amount_paid ?? 0));
    if (requestedAmount > remaining + 0.001) {
      return Response.json(
        { error: `Amount exceeds remaining balance (${remaining})` },
        { status: 400, headers: corsHeaders },
      );
    }

    const [firstName, ...lastNameParts] = (order.customer_name || '').trim().split(/\s+/);
    const lastName = lastNameParts.join(' ');

    // Each attempt gets a unique Order id for Hyp (they de-duplicate by it).
    // We encode our internal order UUID before the separator so hyp-notify
    // can recover the order without an extra DB lookup.
    const attemptId = `${order.id}__${Date.now().toString(36)}`;

    const returnUrl = `${returnOrigin.replace(/\/$/, '')}/HypReturn`;

    const signParams = new URLSearchParams({
      action: 'APISign',
      What: 'SIGN',
      KEY: apiKey,
      PassP: passp,
      Masof: masof,
      Amount: requestedAmount.toFixed(2),
      CoinID: '1',
      Info: `Order ${order.order_number || order.id}`,
      Order: attemptId,
      UTF8: 'True',
      UTF8out: 'True',
      UserId: '000000000',
      Succesful: `${returnUrl}?status=success&order=${encodeURIComponent(order.id)}`,
      Failed: `${returnUrl}?status=failed&order=${encodeURIComponent(order.id)}`,
      ClientName: firstName || '',
      ClientLName: lastName || '',
      email: order.customer_email || '',
      cell: order.customer_phone || '',
      phone: order.customer_phone || '',
    });

    const hypResp = await fetch(`https://pay.hyp.co.il/p/?${signParams.toString()}`, {
      method: 'GET',
    });
    const signed = (await hypResp.text()).trim();

    if (signed.startsWith('CCode=')) {
      console.error('Hyp APISign rejected:', signed);
      return Response.json(
        { error: 'Hyp rejected the signing request', hyp_response: signed },
        { status: 502, headers: corsHeaders },
      );
    }

    const iframeUrl = `https://pay.hyp.co.il/p/?action=pay&${signed}`;

    return Response.json({ iframe_url: iframeUrl, attempt_id: attemptId }, { headers: corsHeaders });
  } catch (error) {
    console.error('hyp-sign error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message || 'Internal server error' }, { status: 500, headers: getCorsHeaders(req) });
  }
});
