import { createServiceClient, corsHeaders, getUser } from '../_shared/supabase.ts';
import { sendFcmToTokens } from '../_shared/fcm.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  try {
    const { user_email, user_id, title, body, link, data } = await req.json();

    if (!title) {
      return Response.json({ error: 'Missing title' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    // Find user's push token
    let query = supabase.from('users').select('id, email, push_token');
    if (user_email) query = query.eq('email', user_email);
    else if (user_id) query = query.eq('id', user_id);
    else return Response.json({ error: 'Missing user_email or user_id' }, { status: 400, headers: corsHeaders });

    const { data: users } = await query;
    const targetUser = (users || [])[0];
    const tokens = (users || []).filter(u => u.push_token).map(u => u.push_token);

    // Always record an in-app notification (regardless of whether FCM is configured)
    if (targetUser) {
      await supabase.from('notifications').insert({
        user_id: targetUser.id,
        user_email: targetUser.email,
        title,
        message: body || '',
        link: link || null,
        type: 'push',
        is_read: false,
      });
    }

    if (tokens.length === 0) {
      return Response.json({ success: true, sent: 0, message: 'No push tokens, saved as notification' }, { headers: corsHeaders });
    }

    const { sent, failed } = await sendFcmToTokens(tokens, { title, body, link, data });
    return Response.json({ success: true, sent, failed }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
