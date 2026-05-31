// sendSms — outbound SMS via 019 (019sms.co.il), the provider chosen for the
// first phase of the Service Center self-service flow.
//
// The rest of the app is provider-agnostic: it calls
//   base44.functions.invoke('sendSms', { phone, message })
// and only cares about the { ok, configured } shape of the response. Swapping
// 019 for another gateway later is a change to THIS file alone.
//
// Configuration (Supabase project secrets):
//   SMS_019_TOKEN     — API token created under 019 → settings → "ניהול טוקן API"
//   SMS_019_USERNAME  — the 019 account username
//   SMS_019_SENDER    — approved sender id / name shown to the recipient
//
// When the secrets are absent we DON'T fail — we return { ok:false,
// configured:false } with HTTP 200 so the UI can gracefully fall back to
// showing a copyable link + a WhatsApp button instead of a hard error.

import { getCorsHeaders, getUser } from '../_shared/supabase.ts';

const ENDPOINT = 'https://019sms.co.il/api';

// Normalise an Israeli number to 972XXXXXXXXX (no plus, no leading zero),
// which is what the 019 API expects for `destinations.phone`.
function toInternational(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // Only authenticated staff can trigger outbound SMS.
    const user = await getUser(req);
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    }

    const body = await req.json().catch(() => ({}));
    const message: string = (body.message || '').toString();
    const rawPhones: string[] = Array.isArray(body.phones)
      ? body.phones
      : body.phone
        ? [body.phone]
        : [];

    const phones = rawPhones.map(toInternational).filter(Boolean);

    if (!message.trim()) {
      return Response.json({ ok: false, error: 'message is required' }, { status: 400, headers: cors });
    }
    if (phones.length === 0) {
      return Response.json({ ok: false, error: 'at least one valid phone is required' }, { status: 400, headers: cors });
    }

    const token = Deno.env.get('SMS_019_TOKEN');
    const username = Deno.env.get('SMS_019_USERNAME');
    const sender = Deno.env.get('SMS_019_SENDER') || 'KingDavid';

    if (!token || !username) {
      // Unconfigured — let the caller fall back to a manual link.
      console.log(`[sendSms] 019 not configured — would send ${phones.length} SMS, message length=${message.length}`);
      return Response.json(
        { ok: false, configured: false, reason: 'sms_provider_not_configured' },
        { headers: cors },
      );
    }

    // 019 JSON request shape (their XML schema expressed as JSON): an `sms`
    // envelope carrying the account user, the approved source, the
    // destinations list and the message body.
    const payload = {
      sms: {
        user: { username },
        source: sender,
        destinations: { phone: phones.map((p) => ({ _: p })) },
        message,
      },
    };

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      result = { raw: text };
    }

    // 019 returns status 0 on success in its JSON body.
    const providerStatus = (result as { status?: number | string })?.status;
    const providerOk = res.ok && (providerStatus === 0 || providerStatus === '0' || providerStatus === undefined);

    if (!providerOk) {
      console.error('[sendSms] 019 send failed', { httpStatus: res.status, result });
      return Response.json(
        { ok: false, configured: true, error: 'sms_send_failed', provider_status: providerStatus ?? res.status, details: result },
        { status: 502, headers: cors },
      );
    }

    return Response.json({ ok: true, configured: true, provider: '019', sent: phones.length, result }, { headers: cors });
  } catch (error) {
    console.error('[sendSms] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
