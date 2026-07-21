// sendPasswordReset — an ADMIN resets a rep's password from the CRM.
//
// The project's Supabase Auth e-mail/link subsystem is unreliable
// (supabase.auth.resetPasswordForEmail → "Unable to process request";
// admin.generateLink → empty 500). So this function is defensive with a
// two-step strategy, preferring the nicest flow but always ending with one
// that works:
//
//   1. PREFERRED — generate a recovery link (service role) and e-mail it via
//      Resend (our reliable mailer). The rep clicks it and picks their own
//      password. Used only if generateLink actually returns a link.
//   2. FALLBACK — if the link can't be generated/sent, set a TEMPORARY
//      password directly with admin.updateUserById (a pure DB write — no
//      e-mail, no SMTP, no link, so it cannot fail the way the above do) and
//      return it so the admin can hand it to the rep. This guarantees the
//      reset always succeeds even while Auth e-mail is down.

import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';

const LOGO = 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png';

function buildResetEmail(actionLink: string) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">
    <div style="background:#1e293b;border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <img src="${LOGO}" alt="King David" style="height:44px;">
    </div>
    <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:28px 24px;text-align:center;">
      <h1 style="font-size:20px;color:#0f172a;margin:0 0 12px;">איפוס סיסמה</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
        התקבלה בקשה לאיפוס הסיסמה שלך במערכת King David CRM.<br>
        לחצו על הכפתור כדי לבחור סיסמה חדשה. אם לא ביקשתם זאת — אפשר להתעלם מהמייל.
      </p>
      <a href="${actionLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:8px;">
        בחירת סיסמה חדשה
      </a>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:24px 0 0;">
        אם הכפתור לא עובד, העתיקו את הקישור לדפדפן:<br>
        <span style="color:#4f46e5;word-break:break-all;">${actionLink}</span>
      </p>
    </div>
  </div>
</body></html>`;
}

// A readable, reasonably strong temporary password (letters + digits).
function randomPassword() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let b64 = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, '');
  while (b64.length < 8) b64 += 'x';
  return `Kd${b64.slice(0, 10)}9`; // ≥ min length, has letters + digits
}

async function emailRecoveryLink(email: string, redirectTo: string | undefined, svc: any): Promise<{ ok: boolean; genError?: string }> {
  const generate = (options?: Record<string, unknown>) =>
    svc.auth.admin.generateLink({ type: 'recovery', email, options } as any);

  let data: any = null;
  let error: any = null;
  try {
    ({ data, error } = await generate(redirectTo ? { redirectTo } : undefined));
    if (error && redirectTo) {
      // redirect_to may not be allow-listed → retry with the default Site URL.
      ({ data, error } = await generate(undefined));
    }
  } catch (e) {
    return { ok: false, genError: String((e as any)?.message || e) };
  }
  if (error) return { ok: false, genError: error.message || 'generateLink failed' };

  const actionLink = data?.properties?.action_link;
  if (!actionLink) return { ok: false, genError: 'no_action_link' };

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) return { ok: false, genError: 'resend_not_configured' };
  const fromEmail = Deno.env.get('FROM_EMAIL') || 'King David CRM <noreply@kingdavid.co.il>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: 'איפוס סיסמה — King David CRM',
      html: buildResetEmail(actionLink),
      text: `לאיפוס הסיסמה שלך במערכת King David CRM, פתחו את הקישור: ${actionLink}`,
    }),
  });
  if (!res.ok) {
    const details = await res.text();
    return { ok: false, genError: `resend_${res.status}: ${details.slice(0, 120)}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    let user: { role?: string } | null = null;
    try { user = await getUser(req); } catch { user = null; }
    if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    if (user.role !== 'admin') return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });

    const { email, userId, redirectTo } = await req.json().catch(() => ({}));
    if (!email || typeof email !== 'string') {
      return Response.json({ ok: false, error: 'email_required' }, { status: 400, headers: cors });
    }

    const svc = createServiceClient();

    // 1) Preferred: e-mail a recovery link via Resend.
    const emailed = await emailRecoveryLink(email, redirectTo, svc);
    if (emailed.ok) {
      return Response.json({ ok: true, mode: 'email', emailed: true }, { headers: cors });
    }
    console.warn('[sendPasswordReset] link/email path failed, falling back to temp password:', emailed.genError);

    // 2) Fallback: set a temporary password directly (no e-mail dependency).
    let authId: string | null = null;
    if (userId) {
      const { data } = await svc.from('users').select('auth_id').eq('id', userId).maybeSingle();
      authId = data?.auth_id || null;
    }
    if (!authId) {
      const { data } = await svc.from('users').select('auth_id').eq('email', email).maybeSingle();
      authId = data?.auth_id || null;
    }
    if (!authId) {
      return Response.json(
        { ok: false, error: 'no_auth_account', detail: emailed.genError },
        { status: 400, headers: cors },
      );
    }

    const tempPassword = randomPassword();
    const { error: upErr } = await svc.auth.admin.updateUserById(authId, { password: tempPassword });
    if (upErr) {
      console.error('[sendPasswordReset] updateUserById failed', upErr.message);
      return Response.json({ ok: false, error: upErr.message }, { status: 500, headers: cors });
    }

    return Response.json(
      { ok: true, mode: 'temp', emailed: false, temp_password: tempPassword, reason: emailed.genError },
      { headers: cors },
    );
  } catch (error) {
    console.error('[sendPasswordReset] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
