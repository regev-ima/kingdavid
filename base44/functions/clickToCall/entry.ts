import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
      const base44 = createClientFromRequest(req);
      const user = await base44.auth.me();

      if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { customerPhone, leadId } = await req.json();

      if (!customerPhone) {
        return Response.json({ error: 'Missing customerPhone' }, { status: 400 });
      }

      if (!user.voicenter_extension) {
        return Response.json({
          error: 'שדה voicenter_extension חסר במשתמש. יש לעדכן את פרטי המשתמש.'
        }, { status: 400 });
      }

      // Build the URL with query parameters
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

      if (!response.ok) {
        return Response.json({
          error: 'Failed to initiate call',
          details: responseData,
          status: response.status
        }, { status: 500 });
      }

      // Try to parse response as JSON first, then fall back to XML
      let callId = null;
      try {
        const jsonResponse = JSON.parse(responseData);

        // VoiceCenter might return the callid in different fields
        callId = jsonResponse.callid || jsonResponse.CallId || jsonResponse.call_id;

        if (!callId && jsonResponse.TOTAL_HITS > 0 && jsonResponse.CDR_LIST) {
          // If it's a CDR response, get the first call ID
          callId = jsonResponse.CDR_LIST[0]?.callid;
        }
      } catch (e) {
        // Fall back to XML parsing
        const callIdMatch = responseData.match(/<name>CALLID<\/name>\s*<value>\s*<string>([^<]+)<\/string>/);
        callId = callIdMatch ? callIdMatch[1] : null;
      }

      // Create CallLog record if leadId is provided
      if (leadId && callId) {
        try {
          await base44.entities.CallLog.create({
            lead_id: leadId,
            rep_id: user.email,
            call_id: callId,
            call_started_at: new Date().toISOString(),
            call_direction: 'outbound',
            call_result: 'pending' // Will be updated when polling completes
          });
        } catch (logError) {
          // Non-critical: log creation failed but call was initiated
        }
      }

      return Response.json({
        success: true,
        message: 'השיחה התחילה בהצלחה',
        callId: callId
      });

    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  });
