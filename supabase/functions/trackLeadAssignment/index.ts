import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();

    // Try to get the user (may be an automation trigger without auth)
    let user: any = null;
    try {
      user = await getUser(req);
    } catch {
      // No auth - running as automation trigger
    }

    const { event, data, old_data, payload_too_large } = await req.json();

    let leadData = data;
    let oldLeadData = old_data;

    // If payload is too large, fetch the full lead data
    if (payload_too_large && event?.entity_id) {
      const { data: fetched } = await supabase
        .from('leads')
        .select('*')
        .eq('id', event.entity_id)
        .single();
      leadData = fetched;
    }

    if (!leadData) {
      return Response.json({ message: 'No lead data available' }, { headers: corsHeaders });
    }

    if (event.type === 'create') {
      // On create, if rep1 is already set, create an initial task for the rep
      if (leadData.rep1) {
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 3);
        await supabase
          .from('sales_tasks')
          .insert({
            lead_id: leadData.id,
            task_type: 'call',
            task_status: 'not_completed',
            summary: `יש להתקשר ללקוח ${leadData.full_name || ''}`,
            due_date: dueDate.toISOString(),
            work_start_date: new Date().toISOString(),
            rep1: leadData.rep1,
            status: leadData.status || 'new_lead',
          });
        return Response.json({ message: 'Initial task created for assigned rep on lead creation' }, { headers: corsHeaders });
      }
      return Response.json({ message: 'No assignment on creation' }, { headers: corsHeaders });
    }

    if (!oldLeadData) {
      // If it's an update and we don't have old data, treat previous values as empty
      oldLeadData = { rep1: '', rep2: '' };
    }

    const previousRep1 = oldLeadData.rep1;
    const newRep1 = leadData.rep1;
    const previousRep2 = oldLeadData.rep2;
    const newRep2 = leadData.rep2;

    const changes: Record<string, any> = {};
    if (previousRep1 !== newRep1) {
      changes.previous_rep1 = previousRep1;
      changes.new_rep1 = newRep1;
    }
    if (previousRep2 !== newRep2) {
      changes.previous_rep2 = previousRep2;
      changes.new_rep2 = newRep2;
    }

    if (Object.keys(changes).length > 0) {
      const assignmentRecord = {
        timestamp: new Date().toISOString(),
        changed_by: user ? user.email : 'system',
        ...changes,
      };

      const updatedHistory = [...(leadData.assignment_history || []), assignmentRecord];

      await supabase
        .from('leads')
        .update({ assignment_history: updatedHistory })
        .eq('id', leadData.id);

      // Create a LeadActivityLog entry
      await supabase
        .from('lead_activity_logs')
        .insert({
          lead_id: leadData.id,
          action_type: 'rep_changed',
          action_description: `שינוי שיוך נציג עבור ${leadData.full_name}`,
          performed_by: user ? user.email : 'system',
          performed_by_name: user?.full_name || user?.email || 'מערכת',
          field_name: changes.new_rep1 ? 'rep1' : 'rep2',
          old_value: changes.previous_rep1 || changes.previous_rep2 || null,
          new_value: changes.new_rep1 || changes.new_rep2 || null,
          metadata: assignmentRecord,
        });

      return Response.json({ message: 'Lead assignment tracked successfully' }, { headers: corsHeaders });
    }

    return Response.json({ message: 'No assignment changes to track' }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
