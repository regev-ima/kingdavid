import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get the event payload
    const { event, data, payload_too_large } = await req.json();

    // If payload is too large, fetch the lead data
    let leadData = data;
    if (payload_too_large) {
      leadData = await base44.asServiceRole.entities.Lead.filter({ id: event.entity_id }).then(res => res[0]);
    }

    if (!leadData) {
      return Response.json({ error: 'Lead not found' }, { status: 404 });
    }

    // No assignment task is opened for an incoming lead — see the note in
    // supabase/functions/createSalesTaskForNewLead. Handing leads out is the
    // manager's standing job and the unassigned pool is the work list, so a
    // task row per lead was pure queue noise.
    return Response.json({
      message: 'No assignment task created — assignment queue retired'
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});