import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Unified VoiceCenter Call Sync
 *
 * This single function handles BOTH:
 * 1. Importing new calls from VoiceCenter CDR API (last 30 minutes)
 * 2. Resolving pending call statuses for calls that were initiated but not yet completed
 *
 * Should run every 15-30 minutes via scheduled automation.
 * Replaces: pollCallStatus.ts, syncVoicenterCalls.ts (old), עדכון סטטוס שיחות
 */

const normalizePhoneNumber = (phone: string | null): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('05') && digits.length === 10) {
    return '972' + digits.substring(1);
  }
  if (digits.startsWith('9725') && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
    return '972' + digits.substring(1);
  }
  if (digits.startsWith('972') && digits.length >= 11) {
    return digits;
  }
  return digits;
};

function mapCallStatus(dialStatus: string | null): string {
  if (!dialStatus) return 'no_answer';
  const status = dialStatus.toLowerCase();
  if (status === 'answer') return 'answered_positive';
  if (status === 'cancel' || status === 'no_answer') return 'no_answer';
  if (status === 'busy') return 'busy';
  return 'no_answer';
}

// XML fallback parsers for pollCallStatus responses
function extractCallResult(xmlData: string): string {
  const statusMatch = xmlData.match(/<CallStatus>([^<]+)<\/CallStatus>/);
  if (!statusMatch) return 'pending';
  const status = statusMatch[1];
  if (status === 'ANSWERED') return 'answered_positive';
  if (status === 'NO_ANSWER') return 'no_answer';
  if (status === 'BUSY') return 'busy';
  if (status === 'FAILED') return 'no_answer';
  return 'pending';
}

function extractCallDuration(xmlData: string): number | null {
  const durationMatch = xmlData.match(/<Duration>(\d+)<\/Duration>/);
  return durationMatch ? parseInt(durationMatch[1]) : null;
}

function extractRecordingUrl(xmlData: string): string | null {
  const recordingMatch = xmlData.match(/<RecordingUrl>([^<]+)<\/RecordingUrl>/);
  return recordingMatch ? recordingMatch[1] : null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const voicenterApiKey = Deno.env.get('VOICENTER_API_KEY');

    if (!voicenterApiKey) {
      throw new Error('VOICENTER_API_KEY not set in environment');
    }

    const results = { newCalls: 0, pendingResolved: 0, errors: 0 };

    // ─── PHASE 1: Import new calls from VoiceCenter CDR ───
    try {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const fromDate = thirtyMinutesAgo.toISOString().slice(0, 19);
      const toDate = now.toISOString().slice(0, 19);

      const apiUrl = new URL('https://46.224.211.60/hub/cdr/');
      apiUrl.searchParams.append('code', voicenterApiKey);
      apiUrl.searchParams.append('fromdate', fromDate);
      apiUrl.searchParams.append('todate', toDate);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: { 'X-Destination': 'voicenter' },
      });

      if (response.ok) {
        const responseText = await response.text();
        let data;
        try { data = JSON.parse(responseText); } catch { data = null; }

        if (data?.CDRList && Array.isArray(data.CDRList) && data.CDRList.length > 0) {
          // Fetch users and leads once for efficient lookup
          const allUsers = await base44.asServiceRole.entities.User.list();
          const allLeads = await base44.asServiceRole.entities.Lead.list();

          for (const call of data.CDRList) {
            try {
              if (!call.callid) continue;

              // Resolve rep by name
              let repEmail = null;
              if (call.representativename) {
                const matchingUser = allUsers.find((user: any) => user.full_name === call.representativename);
                if (matchingUser) repEmail = matchingUser.email;
              }

              // Resolve lead by phone
              let leadId = null;
              const callerNorm = normalizePhoneNumber(call.callernumber);
              const targetNorm = normalizePhoneNumber(call.targetnumber);
              const isOutbound = call.type === 'Extension Outgoing' || call.type?.includes('Click2Call leg2');

              // Try primary phone first, then fallback
              let foundLead = allLeads.find((lead: any) =>
                normalizePhoneNumber(lead.phone) === (isOutbound ? targetNorm : callerNorm)
              );
              if (!foundLead) {
                foundLead = allLeads.find((lead: any) =>
                  normalizePhoneNumber(lead.phone) === (isOutbound ? callerNorm : targetNorm)
                );
              }
              if (foundLead) leadId = foundLead.id;

              await base44.asServiceRole.entities.CallLog.upsert(
                { call_id: call.callid },
                {
                  call_id: call.callid,
                  lead_id: leadId,
                  rep_id: repEmail,
                  call_started_at: call.date ? new Date(call.date).toISOString() : new Date().toISOString(),
                  call_duration_seconds: call.duration ? parseInt(call.duration) : 0,
                  call_ended_at: call.date && call.duration
                    ? new Date(new Date(call.date).getTime() + parseInt(call.duration) * 1000).toISOString()
                    : null,
                  call_result: mapCallStatus(call.dialstatus),
                  call_direction: isOutbound ? 'outbound' : 'inbound',
                  recording_url: call.recordurl || null,
                }
              );
              results.newCalls++;
            } catch {
              results.errors++;
            }
          }
        }
      }
    } catch (phase1Error) {
      // Phase 1 failed but we can still try phase 2
      results.errors++;
    }

    // ─── PHASE 2: Resolve pending call statuses ───
    try {
      const pendingCalls = await base44.asServiceRole.entities.CallLog.filter({
        call_result: 'pending'
      });

      for (const callLog of pendingCalls) {
        if (!callLog.call_id) continue;

        try {
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          const fromDate = startOfToday.toISOString().slice(0, 19);
          const toDate = now.toISOString().slice(0, 19);

          const statusUrl = `https://46.224.211.60/hub/cdr/?callid=${callLog.call_id}&code=${voicenterApiKey}&fromdate=${fromDate}&todate=${toDate}`;

          const statusResponse = await fetch(statusUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-Destination': 'voicenter' },
          });

          const statusText = await statusResponse.text();

          let callResult: string | null = null;
          let callDuration: number | null = null;
          let recordingUrl: string | null = null;

          try {
            const jsonData = JSON.parse(statusText);
            if (jsonData.TOTAL_HITS === 0) continue;
            if (jsonData.CDR_LIST?.length > 0) {
              const call = jsonData.CDR_LIST[0];
              callResult = mapCallStatus(call.dialstatus);
              callDuration = call.duration ? parseInt(call.duration) : null;
              recordingUrl = call.recordurl || null;
            }
          } catch {
            // XML fallback
            callResult = extractCallResult(statusText);
            callDuration = extractCallDuration(statusText);
            recordingUrl = extractRecordingUrl(statusText);
          }

          if (callResult && callResult !== 'pending') {
            const updateData: any = {
              call_result: callResult,
              call_duration_seconds: callDuration || null,
            };
            if (recordingUrl) updateData.recording_url = recordingUrl;
            if (callLog.call_started_at && callDuration) {
              updateData.call_ended_at = new Date(
                new Date(callLog.call_started_at).getTime() + callDuration * 1000
              ).toISOString();
            }

            await base44.asServiceRole.entities.CallLog.update(callLog.id, updateData);
            results.pendingResolved++;
          }
        } catch {
          results.errors++;
        }
      }
    } catch (phase2Error) {
      results.errors++;
    }

    return Response.json({
      success: true,
      message: `Synced ${results.newCalls} new calls, resolved ${results.pendingResolved} pending`,
      ...results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
