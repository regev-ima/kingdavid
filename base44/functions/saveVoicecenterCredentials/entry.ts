import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username, password } = await req.json();

    if (!username || !password) {
      return Response.json({ error: 'Missing username or password' }, { status: 400 });
    }

    // Simple base64 encoding for now (you can enhance with proper encryption later)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const base64Password = btoa(String.fromCharCode(...data));

    // Update user with VoiceCenter credentials
    await base44.auth.updateMe({
      voicenter_username: username,
      voicenter_password_encrypted: base64Password
    });

    return Response.json({ 
      success: true,
      message: 'פרטי ההתחברות נשמרו בהצלחה'
    });

  } catch (error) {
    // Error logged for debugging
    return Response.json({ error: error.message }, { status: 500 });
  }
});