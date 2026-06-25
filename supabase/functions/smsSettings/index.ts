// smsSettings — admin-only management of the 019 SMS account from the Settings
// screen. The browser never sees the raw token: this function reads/writes the
// locked-down sms_settings table with the service role and only ever returns a
// masked hint (••••1234).
//
// Actions (POST body { action }):
//   'get'   – status for the UI: { configured, source, username, sender,
//             token_set, token_hint, updated_date, updated_by }
//   'save'  – { username, sender, token? } → upsert. token is updated only when
//             a non-empty value is provided, so editing the sender/username
//             without re-typing the token keeps the saved one.
//   'test'  – { phone, message? } → send one real SMS via the resolved config.

import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';
import { getSms019Config, send019Sms, toInternational } from '../_shared/sms019.ts';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    let user: { role?: string; email?: string } | null = null;
    try {
      user = await getUser(req);
    } catch {
      user = null;
    }
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    }
    if (user.role !== 'admin') {
      return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action || 'get';
    const svc = createServiceClient();

    if (action === 'get') {
      const { data } = await svc
        .from('sms_settings')
        .select('username, sender, token, updated_date, updated_by')
        .eq('id', 1)
        .maybeSingle();

      const dbToken: string = data?.token || '';
      const dbConfigured = !!(dbToken && data?.username);
      const envToken = Deno.env.get('SMS_019_TOKEN');
      const envUsername = Deno.env.get('SMS_019_USERNAME');
      const source = dbConfigured ? 'db' : (envToken && envUsername ? 'env' : 'none');

      return Response.json({
        ok: true,
        configured: source !== 'none',
        source,
        username: data?.username || (source === 'env' ? envUsername : '') || '',
        sender: data?.sender || Deno.env.get('SMS_019_SENDER') || 'KingDavid',
        token_set: !!dbToken,
        token_hint: dbToken ? `••••${dbToken.slice(-4)}` : '',
        updated_date: data?.updated_date || null,
        updated_by: data?.updated_by || null,
      }, { headers: cors });
    }

    if (action === 'save') {
      const username = String(body.username || '').trim();
      const sender = String(body.sender || '').trim() || 'KingDavid';
      const token = typeof body.token === 'string' ? body.token.trim() : '';

      if (!username) {
        return Response.json({ ok: false, error: 'username_required' }, { status: 400, headers: cors });
      }

      // Keep the existing token when the admin leaves the token field blank
      // (i.e. they're only changing the sender/username).
      let nextToken = token;
      if (!nextToken) {
        const { data: existing } = await svc
          .from('sms_settings')
          .select('token')
          .eq('id', 1)
          .maybeSingle();
        nextToken = existing?.token || '';
      }

      const { error } = await svc.from('sms_settings').upsert({
        id: 1,
        provider: '019',
        username,
        sender,
        token: nextToken,
        updated_by: user.email || null,
        updated_date: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (error) {
        console.error('[smsSettings] save failed', error);
        return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
      }
      return Response.json({ ok: true, token_saved: !!token }, { headers: cors });
    }

    if (action === 'test') {
      const phone = toInternational(String(body.phone || ''));
      if (!phone) {
        return Response.json({ ok: false, error: 'phone_required' }, { status: 400, headers: cors });
      }
      const cfg = await getSms019Config();
      if (cfg.source === 'none') {
        return Response.json({ ok: false, configured: false, reason: 'sms_provider_not_configured' }, { headers: cors });
      }
      const message = String(body.message || 'הודעת בדיקה ממערכת King David ✅');
      const { providerOk, providerStatus, httpStatus, result } = await send019Sms(cfg, [phone], message);
      if (!providerOk) {
        console.error('[smsSettings] test send failed', { httpStatus, result });
        return Response.json(
          { ok: false, configured: true, error: 'sms_send_failed', provider_status: providerStatus ?? httpStatus, details: result },
          { status: 502, headers: cors },
        );
      }
      return Response.json({ ok: true, configured: true, source: cfg.source, result }, { headers: cors });
    }

    return Response.json({ ok: false, error: 'unknown_action' }, { status: 400, headers: cors });
  } catch (error) {
    console.error('[smsSettings] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
