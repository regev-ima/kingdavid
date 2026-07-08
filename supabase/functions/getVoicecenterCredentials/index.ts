import { getUser, getCorsHeaders } from '../_shared/supabase.ts';

// Returns the VoiceCenter SDK login for the live-calls popup.
//
// Hardening (2026-07): the master credentials are handed out ONLY to users who
// actually have a voicenter_extension configured (the telephony users). Before,
// every authenticated user — bookkeeper, factory, anyone — received the master
// username+password even with no extension (hasCredentials=false but the
// secrets were still in the body). The SDK's current login mode requires the
// account credentials; migrating to a scoped per-extension token is tracked in
// docs/improvement-plan.md (B3) and needs live testing against VoiceCenter.
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const extension = user.voicenter_extension || '';
    // No extension → not a telephony user → no credentials at all.
    if (!extension) {
      return Response.json({ hasCredentials: false }, { headers: corsHeaders });
    }

    const username = Deno.env.get('VOICENTER_MASTER_USERNAME') || '';
    const password = Deno.env.get('VOICENTER_MASTER_PASSWORD') || '';
    const hasCredentials = !!(username && password);

    return Response.json({
      username: hasCredentials ? username : '',
      password: hasCredentials ? password : '',
      extension,
      hasCredentials,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
