import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { username, password } = await req.json();
    if (!username || !password) return Response.json({ error: 'Missing username or password' }, { status: 400, headers: corsHeaders });

    const supabase = createServiceClient();
    const encoded = btoa(password);

    const { error } = await supabase
      .from('users')
      .update({ voicenter_username: username, voicenter_password_encrypted: encoded })
      .eq('id', user.id);

    if (error) throw error;

    return Response.json({ success: true, message: 'פרטי VoiceCenter נשמרו בהצלחה' }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
