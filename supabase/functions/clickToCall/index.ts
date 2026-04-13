import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { customerPhone, leadId } = await req.json();
    if (!customerPhone) return Response.json({ error: 'Missing customerPhone' }, { status: 400, headers: corsHeaders });

    if (!user.voicenter_extension) {
      return Response.json({ error: 'שדה voicenter_extension חסר במשתמש. יש לעדכן את פרטי המשתמש.' }, { status: 400, headers: corsHeaders });
    }

    const voicenterApiKey = Deno.env.get('VOICENTER_API_KEY');
    const url = `https://46.224.211.60/ForwardDialer/click2call.aspx?phone=${user.voicenter_extension}&target=${customerPhone}&code=${voicenterApiKey}&action=call&record=True`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html,application/xhtml+xml,application/xml' },
    });

    const responseData = await response.text();
    if (!response.ok) return Response.json({ error: 'Failed to initiate call', details: responseData }, { status: 500, headers: corsHeaders });

    let callId = null;
    try {
      const jsonResponse = JSON.parse(responseData);
      callId = jsonResponse.callid || jsonResponse.CallId || jsonResponse.call_id;
    } catch {
      const match = responseData.match(/<name>CALLID<\/name>\s*<value>\s*<string>([^<]+)<\/string>/);
      callId = match ? match[1] : null;
    }

    if (leadId && callId) {
      try {
        const supabase = createServiceClient();
        await supabase.from('call_logs').insert({
          lead_id: leadId,
          phone_number: customerPhone,
          call_type: 'outbound',
          duration_seconds: 0,
          notes: `Call ID: ${callId}`,
        });
      } catch {}
    }

    return Response.json({ success: true, message: 'השיחה התחילה בהצלחה', callId }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
