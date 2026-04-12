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

    // Check if an assignment task already exists for this lead (prevent duplicates)
    const existingTasks = await base44.asServiceRole.entities.SalesTask.filter({ lead_id: leadData.id });
    const hasAssignmentTask = existingTasks.some(t => t.task_type === 'assignment');
    if (hasAssignmentTask) {
      return Response.json({
        message: 'Assignment task already exists for this lead',
        task_id: existingTasks.find(t => t.task_type === 'assignment').id
      });
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

    const salesTask = await base44.asServiceRole.entities.SalesTask.create(taskData);

    return Response.json({
      message: 'Assignment task created successfully',
      task: salesTask
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});