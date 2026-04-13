import { createServiceClient, corsHeaders, getUser } from '../_shared/supabase.ts';

// Create JWT for FCM v1 API authentication
async function getAccessToken(): Promise<string> {
  const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}');
  const { client_email, private_key } = serviceAccount;

  if (!client_email || !private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  // Import private key and sign JWT
  const pemContent = private_key.replace(/-----BEGIN PRIVATE KEY-----\n?/, '').replace(/\n?-----END PRIVATE KEY-----\n?/, '').replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, signatureInput);
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${header}.${payload}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

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
    let query = supabase.from('users').select('id, push_token, email');
    if (user_email) query = query.eq('email', user_email);
    else if (user_id) query = query.eq('id', user_id);
    else return Response.json({ error: 'Missing user_email or user_id' }, { status: 400, headers: corsHeaders });

    const { data: users } = await query;
    const tokens = (users || []).filter(u => u.push_token).map(u => u.push_token);

    if (tokens.length === 0) {
      // Save as in-app notification even without push
      await supabase.from('notifications').insert({
        user_id: user_email || user_id,
        message: `${title}: ${body || ''}`,
        type: 'push',
        read: false,
      });
      return Response.json({ success: true, sent: 0, message: 'No push tokens, saved as notification' }, { headers: corsHeaders });
    }

    const accessToken = await getAccessToken();
    const projectId = 'kingdavid-crm';
    let sent = 0;
    let failed = 0;

    for (const token of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title,
              body: body || '',
            },
            webpush: {
              fcm_options: {
                link: link || 'https://kingdavid-one.vercel.app/',
              },
              notification: {
                icon: 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png',
                badge: 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png',
                dir: 'rtl',
                lang: 'he',
              },
            },
            data: data || {},
          },
        }),
      });

      if (res.ok) sent++;
      else failed++;
    }

    // Save as in-app notification too
    await supabase.from('notifications').insert({
      user_id: user_email || user_id,
      message: `${title}: ${body || ''}`,
      type: 'push',
      read: false,
    });

    return Response.json({ success: true, sent, failed }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
