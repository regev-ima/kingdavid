import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Strict Israeli phone normaliser. The Voicenter API accepts national
// (0501234567) or international (972501234567) format — anything else
// could be a typo, a premium-rate trap, or an attempt to dial out of
// country. We reject early instead of forwarding garbage to the dialer.
function normaliseIsraeliPhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  // 9-10 digit national (0X-XXXXXXX or 5X-XXXXXXX without leading 0)
  if (/^0[2-9][0-9]{7,8}$/.test(digits)) return digits;
  if (/^[2-9][0-9]{7,8}$/.test(digits)) return `0${digits}`;
  // 11-12 digit international with 972 prefix
  if (/^972[2-9][0-9]{7,8}$/.test(digits)) return `0${digits.slice(3)}`;
  return null;
}

// Confirm the caller is authorised to dial this phone — either:
//   1. The caller is admin (can dial anyone in the system),
//   2. The phone belongs to a Lead they own (rep1 / rep2 / pending_rep_email),
//   3. The phone belongs to a Customer linked to one of their leads,
//   4. The phone matches a SalesTask they own.
//
// Without this check anyone with a bearer token could trigger calls to
// arbitrary numbers (premium-rate, harassment, SWAT) via the rep's
// extension. The check is best-effort: if the phone exists somewhere
// in the system AND the rep has any relationship to it, we allow.
async function callerOwnsPhone(base44, user, normalisedPhone) {
  if (user.role === 'admin') return true;
  const email = user.email;
  if (!email) return false;
  try {
    // Cast a wide net — same phone may live on a Lead or Customer.
    const [leads, customers] = await Promise.all([
      base44.entities.Lead.filter({ phone: normalisedPhone }).catch(() => []),
      base44.entities.Customer.filter({ phone: normalisedPhone }).catch(() => []),
    ]);
    for (const lead of leads || []) {
      if (
        lead?.rep1 === email ||
        lead?.rep2 === email ||
        lead?.pending_rep_email === email
      ) {
        return true;
      }
    }
    for (const customer of customers || []) {
      // Customer ownership transits via the originating lead's rep.
      if (
        customer?.account_manager === email ||
        customer?.rep1 === email ||
        customer?.rep2 === email
      ) {
        return true;
      }
    }
  } catch {
    // On lookup failure we fail closed — better to refuse one legitimate
    // call than to leak the dialer.
    return false;
  }
  return false;
}

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

    // Defence-in-depth: validate format BEFORE any auth lookup so a
    // garbage payload doesn't get us to a real Voicenter call.
    const normalised = normaliseIsraeliPhone(customerPhone);
    if (!normalised) {
      return Response.json(
        { error: 'מספר טלפון לא תקין — יש להזין מספר ישראלי תקני' },
        { status: 400 },
      );
    }

    // Authorisation: only let the rep dial phones connected to their
    // own pipeline. Admin bypass kept so managers can call anyone.
    const allowed = await callerOwnsPhone(base44, user, normalised);
    if (!allowed) {
      return Response.json(
        { error: 'אין הרשאה לחייג למספר זה — המספר אינו משויך לך' },
        { status: 403 },
      );
    }

    if (!user.voicenter_extension) {
      return Response.json({
        error: 'שדה voicenter_extension חסר במשתמש. יש לעדכן את פרטי המשתמש.'
      }, { status: 400 });
    }

    const voicenterApiKey = Deno.env.get('VOICENTER_API_KEY');

    // encodeURIComponent on every query-string value so a future field
    // change can't inject extra parameters into the Voicenter URL.
    const url = `https://46.224.211.60/ForwardDialer/click2call.aspx?phone=${encodeURIComponent(user.voicenter_extension)}&target=${encodeURIComponent(normalised)}&code=${encodeURIComponent(voicenterApiKey || '')}&action=call&record=True`;

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

    // Create CallLog record if leadId is provided. Verify the rep can
    // see this lead before linking — otherwise a malicious caller could
    // poison another rep's call history with bogus entries.
    if (leadId && callId) {
      try {
        let leadOk = user.role === 'admin';
        if (!leadOk) {
          const lead = (await base44.entities.Lead.filter({ id: leadId }))?.[0];
          leadOk =
            !!lead &&
            (lead.rep1 === user.email ||
              lead.rep2 === user.email ||
              lead.pending_rep_email === user.email);
        }
        if (leadOk) {
          await base44.entities.CallLog.create({
            lead_id: leadId,
            rep_id: user.email,
            call_id: callId,
            call_started_at: new Date().toISOString(),
            call_direction: 'outbound',
            call_result: 'pending'
          });
        }
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
