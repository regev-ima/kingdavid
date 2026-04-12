import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const matanEmail = 'matankingdavid01@gmail.com';

    // ספור לידים משויכים
    const assignedLeads = await base44.entities.Lead.filter({ rep1: matanEmail });
    
    // ספור לידים ממתינים
    const pendingLeads = await base44.entities.Lead.filter({ pending_rep_email: matanEmail });
    
    // ספור לידים שהוא נציג משני
    const rep2Leads = await base44.entities.Lead.filter({ rep2: matanEmail });

    return Response.json({
      success: true,
      data: {
        assigned_as_rep1: assignedLeads.length,
        assigned_as_rep2: rep2Leads.length,
        pending: pendingLeads.length,
        total: assignedLeads.length + rep2Leads.length + pendingLeads.length
      }
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});