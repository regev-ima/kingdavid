import { getUser, getCorsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const username = Deno.env.get('VOICENTER_MASTER_USERNAME') || '';
    const password = Deno.env.get('VOICENTER_MASTER_PASSWORD') || '';
    const extension = user.voicenter_extension || '';
    const hasCredentials = !!(username && password && extension);

    return Response.json({
      username,
      password,
      extension,
      hasCredentials,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
