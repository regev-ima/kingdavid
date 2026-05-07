import { getUser, getCorsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const hasCredentials = !!(user.voicenter_username && user.voicenter_password_encrypted);
    let password = '';
    if (hasCredentials) {
      try { password = atob(user.voicenter_password_encrypted); } catch { password = ''; }
    }

    return Response.json({
      username: user.voicenter_username || '',
      password,
      hasCredentials,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
