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
//
// Setting a password (manual or temp fallback) goes through setRepPassword(),
// which does NOT trust users.auth_id blindly. That column is frequently null
// or stale: a rep invited while Supabase SMTP was down never got an auth user
// created, so the profile row exists ("pending") with auth_id = null, and the
// older "resolve auth_id → give up if null" logic made the reset fail with
// no_auth_account. setRepPassword instead resolves the auth account by e-mail
// and CREATES + links it when missing, so an admin setting a password always
// ends up with a login that works.

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

// The JS admin SDK has no server-side e-mail filter, so scan the user pages.
// A CRM has at most a few hundred users, so this stays cheap; the page cap is
// just a safety bound against an unbounded loop.
async function findAuthUserByEmail(svc: any, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    const hit = users.find((u: { email?: string }) => (u.email || '').toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) break; // last page reached
  }
  return null;
}

const isMissingUserError = (msg?: string) => {
  const s = (msg || '').toLowerCase();
  return s.includes('not found') || s.includes('does not exist') || s.includes('user_not_found');
};

// Ensure an auth account exists for `email` with the given password and return
// its id. Tries, in order: the stored auth_id; a lookup by e-mail (auth_id was
// null or drifted); creating a fresh confirmed account. Throws with the raw
// Auth error message on genuine failure.
async function setRepPassword(
  svc: any,
  email: string,
  profile: { auth_id?: string | null; full_name?: string } | null,
  password: string,
): Promise<string> {
  // 1) Stored auth_id — the common, healthy case.
  const storedId = profile?.auth_id || null;
  if (storedId) {
    const { error } = await svc.auth.admin.updateUserById(storedId, { password });
    if (!error) return storedId;
    if (!isMissingUserError(error.message)) throw new Error(error.message);
    // Stored id points at a deleted/absent auth user → fall through.
  }

  // 2) Look the account up by e-mail (auth_id was null or stale).
  const foundId = await findAuthUserByEmail(svc, email);
  if (foundId) {
    const { error } = await svc.auth.admin.updateUserById(foundId, { password });
    if (!error) return foundId;
    if (!isMissingUserError(error.message)) throw new Error(error.message);
  }

  // 3) No auth account exists yet → create one with this password, confirmed so
  //    the rep can log in immediately (the whole point of an admin-set password).
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: profile?.full_name ? { full_name: profile.full_name } : undefined,
  });
  if (!error && data?.user?.id) return data.user.id;

  // Race: created between our lookup and now → find it and set the password.
  if (error && /already|registered|exists/i.test(error.message || '')) {
    const raceId = await findAuthUserByEmail(svc, email);
    if (raceId) {
      const { error: upErr } = await svc.auth.admin.updateUserById(raceId, { password });
      if (upErr) throw new Error(upErr.message);
      return raceId;
    }
  }
  throw new Error(error?.message || 'could not create auth account');
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    let user: { role?: string } | null = null;
    try { user = await getUser(req); } catch { user = null; }
    if (!user) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
    if (user.role !== 'admin') return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: cors });

    const { email, userId, redirectTo, newPassword } = await req.json().catch(() => ({}));
    if (!email || typeof email !== 'string') {
      return Response.json({ ok: false, error: 'email_required' }, { status: 400, headers: cors });
    }

    const svc = createServiceClient();

    // Load the rep's CRM profile (id for re-linking, auth_id as the first guess,
    // full_name for the auth metadata if we end up creating the account). Prefer
    // the explicit userId, falling back to the e-mail.
    const loadProfile = async (): Promise<{ id?: string; auth_id?: string | null; full_name?: string } | null> => {
      if (userId) {
        const { data } = await svc.from('users').select('id, auth_id, full_name').eq('id', userId).maybeSingle();
        if (data) return data;
      }
      const { data } = await svc.from('users').select('id, auth_id, full_name').eq('email', email).maybeSingle();
      return data || null;
    };

    // Persist the resolved/created auth id back onto the profile so future
    // logins and resets resolve without another lookup.
    const linkAuthId = async (authId: string, profileId?: string) => {
      const query = svc.from('users').update({ auth_id: authId });
      const { error } = profileId ? await query.eq('id', profileId) : await query.eq('email', email);
      if (error) console.error('[sendPasswordReset] auth_id link failed', error.message);
    };

    // 0) Explicit: admin sets a specific password for the rep (no e-mail). Ends
    //    with a working login even for a rep that never had an auth account.
    if (typeof newPassword === 'string' && newPassword.length > 0) {
      if (newPassword.length < 6) {
        return Response.json({ ok: false, error: 'password_too_short' }, { status: 400, headers: cors });
      }
      const profile = await loadProfile();
      try {
        const authId = await setRepPassword(svc, email, profile, newPassword);
        await linkAuthId(authId, profile?.id);
        return Response.json({ ok: true, mode: 'set' }, { headers: cors });
      } catch (e) {
        const message = (e as any)?.message || 'set_password_failed';
        console.error('[sendPasswordReset] set password failed', message);
        return Response.json({ ok: false, error: message }, { status: 500, headers: cors });
      }
    }

    // 1) Preferred: e-mail a recovery link via Resend.
    const emailed = await emailRecoveryLink(email, redirectTo, svc);
    if (emailed.ok) {
      return Response.json({ ok: true, mode: 'email', emailed: true }, { headers: cors });
    }
    console.warn('[sendPasswordReset] link/email path failed, falling back to temp password:', emailed.genError);

    // 2) Fallback: set a temporary password directly (no e-mail dependency),
    //    creating/linking the auth account if the rep never had one.
    const profile = await loadProfile();
    const tempPassword = randomPassword();
    try {
      const authId = await setRepPassword(svc, email, profile, tempPassword);
      await linkAuthId(authId, profile?.id);
      return Response.json(
        { ok: true, mode: 'temp', emailed: false, temp_password: tempPassword, reason: emailed.genError },
        { headers: cors },
      );
    } catch (e) {
      const message = (e as any)?.message || 'temp_password_failed';
      console.error('[sendPasswordReset] temp password failed', message);
      return Response.json(
        { ok: false, error: message, detail: emailed.genError },
        { status: 500, headers: cors },
      );
    }
  } catch (error) {
    console.error('[sendPasswordReset] error', error);
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500, headers: cors });
  }
});
