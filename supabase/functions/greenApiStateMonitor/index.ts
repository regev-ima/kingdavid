// greenApiStateMonitor — poll every rep's Green API instance and alert the team
// group about any WhatsApp that has dropped off.
//
// This is the BACKSTOP, not the primary mechanism. The live path is the
// stateInstanceChanged webhook (greenApiWebhook), which fires the moment a
// phone unlinks. This sweep exists for the cases that webhook can't cover:
// the instance stopped delivering webhooks, the webhook config drifted, or the
// state changed while our function was unavailable. It also closes out
// recoveries the same way.
//
// Deployed with --no-verify-jwt like the rest, so it authenticates itself.
// Three accepted callers:
//   * x-monitor-token / body.token  == whatsapp_alert_settings.monitor_token
//     (what the scheduled GitHub Action uses)
//   * Authorization: Bearer <service-role key>
//   * a signed-in admin (the "בדוק עכשיו" button in the settings screen)
//
// GET is a liveness probe only — it never sweeps and never sends.

import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';
import { loadAlertSettings, sweepAccounts } from '../_shared/whatsappAlerts.ts';

/** Constant-time-ish compare so a wrong token can't be narrowed by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(req: Request): string {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    return Response.json({ ok: true, service: 'greenApiStateMonitor' }, { headers: cors });
  }
  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: cors });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const svc = createServiceClient();
    const settings = await loadAlertSettings(svc);

    const presented = String(req.headers.get('x-monitor-token') || body.token || '').trim();
    const token = bearer(req);

    let authorized = false;
    let caller = '';

    if (settings?.monitor_token && presented && tokensMatch(presented, settings.monitor_token)) {
      authorized = true;
      caller = 'monitor_token';
    } else if (token && tokensMatch(token, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')) {
      authorized = true;
      caller = 'service_role';
    } else if (token) {
      // Fall back to a real session — an admin can trigger a sweep by hand.
      let user: { role?: string; email?: string } | null = null;
      try { user = await getUser(req); } catch { user = null; }
      if (user?.role === 'admin') {
        authorized = true;
        caller = `admin:${user.email || ''}`;
      }
    }

    if (!authorized) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: cors });
    }

    const summary = await sweepAccounts(svc, caller.startsWith('admin') ? 'ui' : 'sweep');
    console.log('[greenApiStateMonitor] sweep', caller, JSON.stringify({
      checked: summary.checked,
      unreachable: summary.unreachable,
      disconnected: summary.disconnected,
      sent: summary.sent,
      recovered: summary.recovered,
      failed: summary.failed,
    }));

    return Response.json({ ok: true, ...summary }, { headers: cors });
  } catch (error) {
    console.error('[greenApiStateMonitor] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
