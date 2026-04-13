import { createServiceClient, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
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

    // Always create ONE assignment task for admins (no rep1 so only admins see it)
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

    const { data: salesTask, error } = await supabase
      .from('sales_tasks')
      .insert(taskData)
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      message: 'Assignment task created successfully',
      task: salesTask,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
