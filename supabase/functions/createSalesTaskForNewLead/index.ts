import { createServiceClient, getCorsHeaders } from '../_shared/supabase.ts';
import { sendFcmToTokens } from '../_shared/fcm.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // This function is triggered by DB (pg_net) - validate service role
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!token || token !== serviceRoleKey) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();

    // Get the event payload (automation trigger - no auth needed)
    const { event, data, payload_too_large } = await req.json();

    // If payload is too large, fetch the lead data
    let leadData = data;
    if (payload_too_large && event?.entity_id) {
      const { data: fetched } = await supabase
        .from('leads')
        .select('*')
        .eq('id', event.entity_id)
        .single();
      leadData = fetched;
    }

    if (!leadData) {
      return Response.json({ error: 'Lead not found' }, { status: 404, headers: corsHeaders });
    }

    // Check if an assignment task already exists for this lead (prevent duplicates)
    const { data: existingTasks } = await supabase
      .from('sales_tasks')
      .select('*')
      .eq('lead_id', leadData.id);

    const hasAssignmentTask = existingTasks?.some((t: any) => t.task_type === 'assignment');
    if (hasAssignmentTask) {
      return Response.json({
        message: 'Assignment task already exists for this lead',
        task_id: existingTasks!.find((t: any) => t.task_type === 'assignment').id,
      }, { headers: corsHeaders });
    }

    // A lead that arrives with rep1 already on it was typed in by hand
    // (/NewLead, /NewQuote), and the form assigns it to whoever typed it — so
    // there is nobody to assign it TO, and "יש לשייך את הליד לנציג" would just
    // be busywork an admin has to close. trackLeadAssignment creates that rep's
    // follow-up call task off the same INSERT; here we only drop the admin
    // prompt and keep the FYI notification below.
    //
    // Gated on rep1 ALONE, deliberately. A lead that comes in through the API
    // lands unassigned by design (see the note in upsertLead) and carries
    // `pending_rep_email` only as a hint of who the integration meant it for —
    // it still needs a manager to triage it, so it still gets this task.
    const assignedRep = String(leadData.rep1 || '').trim();

    let salesTask = null;
    if (!assignedRep) {
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 3);

      const taskData = {
        lead_id: leadData.id,
        task_type: 'assignment',
        task_status: 'not_completed',
        summary: `יש לשייך את הליד ${leadData.full_name || 'החדש'} לנציג`,
        due_date: dueDate.toISOString(),
        work_start_date: new Date().toISOString(),
      };

      const { data: inserted, error } = await supabase
        .from('sales_tasks')
        .insert(taskData)
        .select()
        .single();

      if (error) throw error;
      salesTask = inserted;
    }

    // Notify all admins about the new lead (in-app bell + mobile push)
    try {
      const { data: admins } = await supabase
        .from('users')
        .select('id, email, push_token')
        .eq('role', 'admin');

      if (admins && admins.length > 0) {
        const adminIds = admins.map((a: any) => a.id);

        const { data: prefsRows } = await supabase
          .from('notification_preferences')
          .select('user_id, new_lead_alerts')
          .in('user_id', adminIds);

        const prefsByUser = new Map<string, any>();
        (prefsRows || []).forEach((p: any) => prefsByUser.set(p.user_id, p));

        const leadName = leadData.full_name || 'ליד חדש';
        const leadSource = leadData.source || leadData.utm_source || '';
        const title = `ליד חדש: ${leadName}`;

        // Admins still hear about every new lead — that's what new_lead_alerts
        // is for — but a self-assigned one is an FYI, not a call to action, so
        // it must not say "ממתין לשיוך".
        let assignedRepName = assignedRep;
        if (assignedRep) {
          const { data: repRow } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', assignedRep)
            .maybeSingle();
          assignedRepName = repRow?.full_name || assignedRep;
        }

        const message = assignedRep
          ? `נוצר ליד חדש ידנית ושויך ל${assignedRepName}`
          : leadSource
            ? `התקבל ליד חדש ממקור ${leadSource} וממתין לשיוך לנציג`
            : `התקבל ליד חדש וממתין לשיוך לנציג`;
        const link = `/LeadDetails?id=${leadData.id}`;

        // Admins who haven't explicitly disabled new_lead_alerts
        const optedInAdmins = admins.filter((admin: any) => {
          const prefs = prefsByUser.get(admin.id);
          return !prefs || prefs.new_lead_alerts !== false;
        });

        // 1) In-app notifications (drives the notification bell)
        if (optedInAdmins.length > 0) {
          const notificationsToInsert = optedInAdmins.map((admin: any) => ({
            user_id: admin.id,
            user_email: admin.email,
            type: 'new_lead_assigned',
            title,
            message,
            link,
            entity_type: 'lead',
            entity_id: leadData.id,
            is_read: false,
          }));

          const { error: notifError } = await supabase
            .from('notifications')
            .insert(notificationsToInsert);
          if (notifError) console.error('Failed to insert admin notifications:', notifError);
        }

        // 2) Mobile/web push via FCM for admins that have a push_token
        const pushTokens = optedInAdmins
          .map((admin: any) => admin.push_token)
          .filter((t: any) => typeof t === 'string' && t.length > 0);

        if (pushTokens.length > 0) {
          const pushResult = await sendFcmToTokens(pushTokens, {
            title,
            body: message,
            link,
            data: { entity_type: 'lead', entity_id: String(leadData.id), type: 'new_lead_assigned' },
          });
          console.log('FCM push result for new lead:', pushResult);
        }
      }
    } catch (notifyErr) {
      // Do not fail the task creation if notifications fail
      console.error('Admin notification error:', notifyErr);
    }

    return Response.json({
      message: assignedRep
        ? `Lead already assigned to ${assignedRep} on creation — no assignment task needed`
        : 'Assignment task created successfully',
      task: salesTask,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
