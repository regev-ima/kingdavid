import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

// Hard-delete a user: removes both the CRM profile row (public.users) and the
// Supabase Auth account, so the person can no longer sign in and is gone from
// the reps list. Admin-only.
//
// IMPORTANT: lead/quote/order/customer reassignment is done on the CLIENT
// *before* this is called, so the lead-activity trigger attributes the
// transfer to the acting admin (a service-role write here would log as
// "system"). This function only performs the destructive removal.
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getUser(req);
    if (!caller || caller.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.userId;
    const email: string | undefined = body.email?.trim();

    if (!userId && !email) {
      return Response.json({ error: 'Missing required field: userId or email' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    // Resolve the profile row so we have its auth_id and can run safety checks.
    let lookup = supabase.from('users').select('id, email, auth_id, role');
    lookup = userId ? lookup.eq('id', userId) : lookup.eq('email', email!);
    const { data: rows, error: lookupErr } = await lookup.limit(1);
    if (lookupErr) {
      return Response.json({ error: `Lookup failed: ${lookupErr.message}` }, { status: 500, headers: corsHeaders });
    }
    const profile = rows?.[0];
    if (!profile) {
      return Response.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
    }

    // Never let an admin delete the account they're currently signed in with.
    if (profile.email && caller.email && profile.email.toLowerCase() === caller.email.toLowerCase()) {
      return Response.json({ error: 'אי אפשר למחוק את המשתמש שאיתו אתה מחובר' }, { status: 400, headers: corsHeaders });
    }

    // 1. Remove the Auth account (best-effort — a missing auth user shouldn't
    //    block removing the profile row).
    if (profile.auth_id) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(profile.auth_id);
      if (authErr && !/not[\s_]*found/i.test(authErr.message || '')) {
        console.error('[deleteUser] auth account delete failed', authErr.message);
      }
    }

    // 2. Remove the CRM profile row.
    const { error: delErr } = await supabase.from('users').delete().eq('id', profile.id);
    if (delErr) {
      return Response.json({ error: `Profile delete failed: ${delErr.message}` }, { status: 500, headers: corsHeaders });
    }

    console.log('[deleteUser] done', { deletedId: profile.id, hadAuth: !!profile.auth_id });
    return Response.json({ success: true, deleted_email: profile.email }, { headers: corsHeaders });
  } catch (e) {
    console.error('[deleteUser] error', e);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
