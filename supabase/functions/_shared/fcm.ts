/**
 * Firebase Cloud Messaging (FCM) v1 API helper.
 * Shared between sendPushNotification and any Edge Function that
 * needs to fire a push (e.g. createSalesTaskForNewLead).
 */

const FCM_PROJECT_ID = 'kingdavid-crm';
const DEFAULT_LINK = 'https://kingdavid-one.vercel.app/';
const DEFAULT_ICON = 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png';

export async function getFcmAccessToken(): Promise<string> {
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

  const pemContent = private_key
    .replace(/-----BEGIN PRIVATE KEY-----\n?/, '')
    .replace(/\n?-----END PRIVATE KEY-----\n?/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );

  const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, signatureInput);
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${header}.${payload}.${signatureB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

export interface FcmPayload {
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, string>;
}

/**
 * Send a push to the given FCM tokens. Returns counts.
 * Never throws - errors are logged and counted as failed.
 */
export async function sendFcmToTokens(tokens: string[], payload: FcmPayload) {
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken();
  } catch (err) {
    console.error('FCM access token error:', err);
    return { sent: 0, failed: tokens.length };
  }

  let sent = 0;
  let failed = 0;
  for (const token of tokens) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body || '' },
            webpush: {
              fcm_options: { link: payload.link || DEFAULT_LINK },
              notification: {
                icon: DEFAULT_ICON,
                badge: DEFAULT_ICON,
                dir: 'rtl',
                lang: 'he',
              },
            },
            data: payload.data || {},
          },
        }),
      });
      if (res.ok) sent++;
      else { failed++; console.error('FCM send failed:', res.status, await res.text()); }
    } catch (err) {
      failed++;
      console.error('FCM send error:', err);
    }
  }
  return { sent, failed };
}
