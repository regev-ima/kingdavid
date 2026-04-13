import { createServiceClient, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_email, user_id, title, body, link, data } = await req.json();

    if (!title) {
      return Response.json({ error: 'Missing title' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    // Find user's push token
    let query = supabase.from('users').select('id, push_token, email');
    if (user_email) query = query.eq('email', user_email);
    else if (user_id) query = query.eq('id', user_id);
    else return Response.json({ error: 'Missing user_email or user_id' }, { status: 400, headers: corsHeaders });

    const { data: users } = await query;
    const tokens = (users || []).filter(u => u.push_token).map(u => u.push_token);

    if (tokens.length === 0) {
      return Response.json({ success: false, message: 'No push tokens found' }, { headers: corsHeaders });
    }

    // Get Firebase service account or use server key
    const fcmServerKey = Deno.env.get('FCM_SERVER_KEY');

    if (!fcmServerKey) {
      return Response.json({ error: 'FCM_SERVER_KEY not configured' }, { status: 500, headers: corsHeaders });
    }

    let sent = 0;
    let failed = 0;

    for (const token of tokens) {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${fcmServerKey}`,
        },
        body: JSON.stringify({
          to: token,
          notification: {
            title,
            body: body || '',
            icon: 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png',
            click_action: link || 'https://kingdavid-one.vercel.app/',
          },
          data: data || {},
        }),
      });

      if (res.ok) sent++;
      else failed++;
    }

    // Also save as in-app notification
    if (user_email || user_id) {
      await supabase.from('notifications').insert({
        user_id: user_email || user_id,
        message: `${title}: ${body || ''}`,
        type: 'push',
        read: false,
      });
    }

    return Response.json({ success: true, sent, failed }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: corsHeaders });
  }
});
