import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    const { event, data, old_data, payload_too_large } = await req.json();

    let leadData = data;
    let oldLeadData = old_data;

    // If payload is too large, fetch the full lead data
    if (payload_too_large) {
      // For updates, we might want to check what changed. 
      // If old_data is missing due to size, we might miss tracking, 
      // but usually fetching current data is enough to see current state. 
      // Comparing with 'old' state requires fetching the previous version or relying on old_data.
      // Since we don't have easy access to 'previous version' via simple SDK call without specific support,
      // and we want to avoid complexity, we'll assume old_data is present or we skip if strictly needed.
      // However, for critical tracking, we can just log the current state or try to infer.
      // Here we will proceed with what we have.
      leadData = await base44.asServiceRole.entities.Lead.get(event.entity_id);
    }

    if (!leadData) {
      return Response.json({ message: 'No lead data available' });
    }

    if (event.type === 'create') {
      // On create, if rep1 is already set, create an initial task for the rep
      if (leadData.rep1) {
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 3);
        await base44.asServiceRole.entities.SalesTask.create({
          lead_id: leadData.id,
          task_type: 'call',
          task_status: 'not_completed',
          summary: `יש להתקשר ללקוח ${leadData.full_name || ''}`,
          due_date: dueDate.toISOString(),
          work_start_date: new Date().toISOString(),
          rep1: leadData.rep1,
          status: leadData.status || 'new_lead',
        });
        return Response.json({ message: 'Initial task created for assigned rep on lead creation' });
      }
      return Response.json({ message: 'No assignment on creation' });
    }

    if (!oldLeadData) {
      // If it's an update and we don't have old data, treat previous values as empty
      oldLeadData = { rep1: '', rep2: '' };
    }

    const previousRep1 = oldLeadData.rep1;
    const newRep1 = leadData.rep1;
    const previousRep2 = oldLeadData.rep2;
    const newRep2 = leadData.rep2;

    const changes = {};
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

      // Update lead's assignment history
      // We need to fetch the latest lead data again to ensure we don't overwrite concurrent updates to other fields?
      // Or just push to the array. 
      // Since we are inside an automation triggered by update, updating the entity again might trigger a loop 
      // IF the automation triggers on 'update'. 
      // To avoid infinite loops:
      // 1. Check if the update is ONLY assignment_history (hard to know).
      // 2. The automation should probably check if 'rep1' or 'rep2' actually changed in the event.
      // We did check that above.
      // But updating 'assignment_history' is also an update.
      // So this function will run again.
      // In the next run, rep1 and rep2 won't have changed (hopefully), so it will exit early.
      
      const updatedHistory = [...(leadData.assignment_history || []), assignmentRecord];
      
      // Use a specific update that only touches assignment_history to minimize side effects, 
      // though Base44 SDK updates usually merge or replace depending on implementation.
      await base44.asServiceRole.entities.Lead.update(leadData.id, { assignment_history: updatedHistory });

      // Create a LeadActivityLog entry (same entity the frontend reads)
      await base44.asServiceRole.entities.LeadActivityLog.create({
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

      // Task creation (marking assignment tasks done + creating call tasks) is handled
      // client-side in LeadDetails.jsx and Leads.jsx to avoid duplicate tasks.

      return Response.json({ message: 'Lead assignment tracked successfully' });
    }

    return Response.json({ message: 'No assignment changes to track' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});