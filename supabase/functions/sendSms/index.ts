// sendSms — outbound SMS via 019 (019sms.co.il).
//
// The rest of the app is provider-agnostic: it calls
//   base44.functions.invoke('sendSms', { phone, message })
// and only cares about the { ok, configured } shape of the response.
//
// Credentials are resolved by getSms019Config() (see _shared/sms019.ts):
//   1. the sms_settings table  — set by an admin from Settings → "שליחת SMS"
//   2. Supabase project secrets — SMS_019_TOKEN / SMS_019_USERNAME / SMS_019_SENDER
//      (legacy fallback, so existing deployments keep working unchanged)
//
// When neither is configured we DON'T fail — we return { ok:false,
// configured:false } with HTTP 200 so the UI can gracefully fall back to
// showing a copyable link + a WhatsApp button instead of a hard error.

import { getCorsHeaders, getUser } from '../_shared/supabase.ts';
import { getSms019Config, send019Sms, toInternational } from '../_shared/sms019.ts';

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

    const cfg = await getSms019Config();
    if (cfg.source === 'none') {
      // Unconfigured — let the caller fall back to a manual link.
      console.log(`[sendSms] 019 not configured — would send ${phones.length} SMS, message length=${message.length}`);
      return Response.json(
        { ok: false, configured: false, reason: 'sms_provider_not_configured' },
        { headers: cors },
      );
    }

    const { providerOk, providerStatus, httpStatus, result } = await send019Sms(cfg, phones, message);

    if (!providerOk) {
      console.error('[sendSms] 019 send failed', { httpStatus, result });
      return Response.json(
        { ok: false, configured: true, error: 'sms_send_failed', provider_status: providerStatus ?? httpStatus, details: result },
        { status: 502, headers: cors },
      );
    }

    return Response.json({ ok: true, configured: true, provider: '019', sent: phones.length, result }, { headers: cors });
  } catch (error) {
    console.error('[sendSms] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
