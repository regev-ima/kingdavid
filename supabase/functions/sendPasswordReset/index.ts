// sendPasswordReset — an ADMIN resets a rep's password from the CRM.
//
// Why this exists instead of supabase.auth.resetPasswordForEmail(): the public
// recover endpoint sends through Supabase's built-in mailer, which on this
// project fails with "Unable to process request" (rate-limited / not wired to
// custom SMTP). Here we generate the recovery link with the service role and
// send it via Resend — the same reliable path the rest of the CRM already uses
// for e-mail. This is immune to the built-in mailer AND, by falling back to the
// default Site URL, to a redirect_to that isn't in the project's allow-list.

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

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    let user: { role?: string } | null = null;
    try { user = await getUser(req); } catch { user = null; }
    if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    // Admin-only: resetting a rep's password is a management action.
    if (user.role !== 'admin') return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });

    const { email, redirectTo } = await req.json().catch(() => ({}));
    if (!email || typeof email !== 'string') {
      return Response.json({ ok: false, error: 'email_required' }, { status: 400, headers: cors });
    }

    const svc = createServiceClient();

    // Generate the recovery link ourselves (service role) — no Supabase mail.
    const generate = (options?: Record<string, unknown>) =>
      svc.auth.admin.generateLink({ type: 'recovery', email, options } as any);

    let { data, error } = await generate(redirectTo ? { redirectTo } : undefined);
    if (error && redirectTo) {
      // redirect_to may not be in the project's allow-list → retry with the
      // default (Site URL), so we still get a usable link.
      console.warn('[sendPasswordReset] generateLink with redirectTo failed, retrying without', error.message);
      ({ data, error } = await generate(undefined));
    }
    if (error) {
      console.error('[sendPasswordReset] generateLink failed', error.message);
      return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
    }

    const actionLink = (data as any)?.properties?.action_link;
    if (!actionLink) {
      return Response.json({ ok: false, error: 'no_action_link' }, { status: 500, headers: cors });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'King David CRM <noreply@kingdavid.co.il>';
    if (!resendApiKey) {
      // No mailer configured — hand the link back so the admin can pass it on.
      return Response.json({ ok: true, emailed: false, action_link: actionLink }, { headers: cors });
    }

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
      console.error('[sendPasswordReset] resend failed', res.status, details);
      return Response.json({ ok: false, error: 'email_send_failed' }, { status: 500, headers: cors });
    }

    return Response.json({ ok: true, emailed: true }, { headers: cors });
  } catch (error) {
    console.error('[sendPasswordReset] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
