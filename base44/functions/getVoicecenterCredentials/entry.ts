import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.voicenter_username || !user.voicenter_password_encrypted) {
      return Response.json({ 
        error: 'VoiceCenter credentials not configured',
        hasCredentials: false 
      }, { status: 400 });
    }

    // Only return username and confirmation that credentials exist
    // Never send password back to frontend - it's only used server-side
    return Response.json({
      username: user.voicenter_username,
      hasCredentials: true
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});