import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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
      headers: {
        'X-Destination': 'voicenter',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
      },
    });

    const responseData = await response.text();
    if (!response.ok) return Response.json({ error: 'Failed to initiate call', status: response.status, details: responseData }, { status: 502, headers: corsHeaders });

    let callId: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    try {
      const jsonResponse = JSON.parse(responseData);
      callId = jsonResponse.callid || jsonResponse.CallId || jsonResponse.call_id || jsonResponse.CALLID || null;
      errorCode = jsonResponse.errorcode ?? jsonResponse.ERRORCODE ?? null;
      errorMessage = jsonResponse.errormessage ?? jsonResponse.ERRORMESSAGE ?? null;
    } catch {
      const callMatch = responseData.match(/<name>CALLID<\/name>\s*<value>\s*<string>([^<]*)<\/string>/i);
      callId = callMatch ? callMatch[1] : null;
      const codeMatch = responseData.match(/<name>ERRORCODE<\/name>\s*<value>\s*<(?:int|string|i4)>([^<]+)<\/(?:int|string|i4)>/i);
      errorCode = codeMatch ? codeMatch[1] : null;
      const msgMatch = responseData.match(/<name>ERRORMESSAGE<\/name>\s*<value>\s*<string>([^<]*)<\/string>/i);
      errorMessage = msgMatch ? msgMatch[1] : null;
    }

    if ((errorCode !== null && errorCode !== '0') || !callId) {
      return Response.json({
        error: errorMessage || 'Voicenter rejected the call',
        errorCode,
        details: responseData,
      }, { status: 502, headers: corsHeaders });
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
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message || 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
