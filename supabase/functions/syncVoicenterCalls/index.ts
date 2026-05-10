import { createServiceClient, getCorsHeaders } from '../_shared/supabase.ts';

/**
 * Unified VoiceCenter Call Sync
 *
 * This single function handles BOTH:
 * 1. Importing new calls from VoiceCenter CDR API (last 30 minutes)
 * 2. Resolving pending call statuses for calls that were initiated but not yet completed
 *
 * Should run every 15-30 minutes via scheduled invocation (pg_cron or external).
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
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();
    const voicenterApiKey = Deno.env.get('VOICENTER_API_KEY');

    if (!voicenterApiKey) {
      throw new Error('VOICENTER_API_KEY not set in environment');
    }

    const results = { newCalls: 0, pendingResolved: 0, errors: 0 };

    // --- PHASE 1: Import new calls from VoiceCenter CDR ---
    try {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const fromDate = thirtyMinutesAgo.toISOString().slice(0, 19);
      const toDate = now.toISOString().slice(0, 19);

      const apiUrl = new URL('http://46.224.211.60/hub/cdr/');
      apiUrl.searchParams.append('code', voicenterApiKey);
      apiUrl.searchParams.append('fromdate', fromDate);
      apiUrl.searchParams.append('todate', toDate);

      console.log('[sync] CDR fetch:', apiUrl.toString());

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: { 'X-Destination': 'voicenter' },
      });

      console.log('[sync] CDR status:', response.status);

      if (response.ok) {
        const responseText = await response.text();
        console.log('[sync] CDR body (first 1000 chars):', responseText.slice(0, 1000));
        let data: any;
        try { data = JSON.parse(responseText); } catch { data = null; }

        const cdrList = data?.CDR_LIST ?? data?.CDRList;

        if (!data) {
          console.log('[sync] CDR response was not JSON');
        } else if (!cdrList) {
          console.log('[sync] CDR JSON keys:', Object.keys(data));
        } else {
          console.log('[sync] CDR_LIST length:', cdrList.length);
        }

        if (cdrList && Array.isArray(cdrList) && cdrList.length > 0) {
          // Fetch users and leads once for efficient lookup. PostgREST caps
          // each .select() at 1000 rows, so we paginate until we have all of
          // them — otherwise leads beyond row 1000 silently fail to match.
          async function fetchAll(table: string, columns: string) {
            const pageSize = 1000;
            const all: any[] = [];
            let from = 0;
            for (;;) {
              const { data, error } = await supabase
                .from(table)
                .select(columns)
                .range(from, from + pageSize - 1);
              if (error) throw error;
              if (!data || data.length === 0) break;
              all.push(...data);
              if (data.length < pageSize) break;
              from += pageSize;
            }
            return all;
          }
          const allUsers = await fetchAll('users', 'email,full_name,voicenter_extension');
          const allLeads = await fetchAll('leads', 'id,phone');
          console.log('[sync] loaded', allUsers.length, 'users and', allLeads.length, 'leads');

          for (const call of cdrList) {
            try {
              if (!call.callid) continue;

              // Click2Call leg1 is the "ring the rep" half: same conversation as
              // leg2 but no recording and inverted caller/target. Skip it so we
              // store one row per actual call with the recording URL.
              if (call.type === 'Click2Call leg1') continue;

              // Resolve rep — prefer matching the Voicenter extension stored on
              // the user (stable, language-agnostic) over the free-text name
              // representativename, which doesn't always equal users.full_name.
              const isOutbound = call.type === 'Extension Outgoing' || call.type?.includes('Click2Call leg2');
              const repExtension = isOutbound ? call.callerextension : call.targetextension;

              let repEmail: string | null = null;
              if (repExtension) {
                const byExtension = (allUsers || []).find((user: any) =>
                  user.voicenter_extension && String(user.voicenter_extension) === String(repExtension)
                );
                if (byExtension) repEmail = byExtension.email;
              }
              if (!repEmail && call.representativename) {
                const byName = (allUsers || []).find((user: any) =>
                  user.full_name && user.full_name.trim() === String(call.representativename).trim()
                );
                if (byName) repEmail = byName.email;
              }

              // Resolve lead by phone. The customer number is in `targetnumber`
              // for outbound and `callernumber` for inbound.
              const customerNorm = normalizePhoneNumber(isOutbound ? call.targetnumber : call.callernumber);
              const otherNorm = normalizePhoneNumber(isOutbound ? call.callernumber : call.targetnumber);

              let leadId: string | null = null;
              let foundLead = (allLeads || []).find((lead: any) =>
                normalizePhoneNumber(lead.phone) === customerNorm
              );
              if (!foundLead && otherNorm) {
                foundLead = (allLeads || []).find((lead: any) =>
                  normalizePhoneNumber(lead.phone) === otherNorm
                );
              }
              if (foundLead) leadId = foundLead.id;

              if (!leadId || !repEmail) {
                console.log('[sync] unmatched call', JSON.stringify({
                  callid: call.callid,
                  type: call.type,
                  callernumber: call.callernumber,
                  targetnumber: call.targetnumber,
                  callerextension: call.callerextension,
                  targetextension: call.targetextension,
                  representativename: call.representativename,
                  customerNorm,
                  repExtension,
                  matchedLead: !!leadId,
                  matchedRep: !!repEmail,
                }));
              }

              // Upsert: check if call_id exists, then insert or update
              const { data: existingCall } = await supabase
                .from('call_logs')
                .select('id')
                .eq('call_id', call.callid)
                .limit(1);

              const callData = {
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
              };

              if (existingCall && existingCall.length > 0) {
                await supabase
                  .from('call_logs')
                  .update(callData)
                  .eq('id', existingCall[0].id);
              } else {
                await supabase
                  .from('call_logs')
                  .insert(callData);
              }
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

    // --- PHASE 2: Resolve pending call statuses ---
    try {
      const { data: pendingCalls } = await supabase
        .from('call_logs')
        .select('*')
        .eq('call_result', 'pending');

      for (const callLog of pendingCalls || []) {
        if (!callLog.call_id) continue;

        try {
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          const fromDate = startOfToday.toISOString().slice(0, 19);
          const toDate = now.toISOString().slice(0, 19);

          const statusUrl = `http://46.224.211.60/hub/cdr/?callid=${callLog.call_id}&code=${voicenterApiKey}&fromdate=${fromDate}&todate=${toDate}`;

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
            const updateData: Record<string, any> = {
              call_result: callResult,
              call_duration_seconds: callDuration || null,
            };
            if (recordingUrl) updateData.recording_url = recordingUrl;
            if (callLog.call_started_at && callDuration) {
              updateData.call_ended_at = new Date(
                new Date(callLog.call_started_at).getTime() + callDuration * 1000
              ).toISOString();
            }

            await supabase
              .from('call_logs')
              .update(updateData)
              .eq('id', callLog.id);
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
      ...results,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
