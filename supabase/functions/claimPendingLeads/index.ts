import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const supabase = createServiceClient();
    const email = user.email;

    // 1. Claim pending leads
    const { data: pendingLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('pending_rep_email', email)
      .limit(BATCH_SIZE);

    let leadsUpdated = 0;
    if (pendingLeads && pendingLeads.length > 0) {
      const ids = pendingLeads.map((l: any) => l.id);
      const { error } = await supabase
        .from('leads')
        .update({ rep1: email, pending_rep_email: '' })
        .in('id', ids);
      if (!error) leadsUpdated = ids.length;
    }

    // 2. Claim pending tasks
    const { data: pendingTasks } = await supabase
      .from('sales_tasks')
      .select('id')
      .eq('pending_rep_email', email)
      .limit(BATCH_SIZE);

    let tasksUpdated = 0;
    if (pendingTasks && pendingTasks.length > 0) {
      const ids = pendingTasks.map((t: any) => t.id);
      const { error } = await supabase
        .from('sales_tasks')
        .update({ rep1: email, pending_rep_email: '' })
        .in('id', ids);
      if (!error) tasksUpdated = ids.length;
    }

    return Response.json({
      success: true,
      data: {
        representative: email,
        leads_updated: leadsUpdated,
        tasks_updated: tasksUpdated,
      },
      message: `Sync complete. Assigned ${leadsUpdated} leads and ${tasksUpdated} tasks.`,
    }, { headers: corsHeaders });
  } catch (err) {
    console.error('Function error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
