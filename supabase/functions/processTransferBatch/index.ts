import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

const BATCH_SIZE = 20; // Process 20 items per run

const TABLE_MAP: Record<string, string> = {
  Lead: 'leads',
  SalesTask: 'sales_tasks',
  Order: 'orders',
  Quote: 'quotes',
  Customer: 'customers',
  Commission: 'commissions',
  SupportTicket: 'support_tickets',
  CallLog: 'call_logs',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await getUser(req);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    // Find in-progress transfer tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('sync_progress')
      .select('*')
      .eq('status', 'in_progress')
      .like('task_name', 'transfer_%');

    if (tasksError) throw tasksError;

    if (!tasks || tasks.length === 0) {
      return Response.json({ message: 'No active transfer tasks' }, { headers: corsHeaders });
    }

    // Process first task
    const task = tasks[0];
    const { oldEmail, newEmail, currentEntity = 'leads', entityOffset = 0 } = task.metadata || {};

    if (!oldEmail || !newEmail) {
      await supabase
        .from('sync_progress')
        .update({
          status: 'failed',
          error_message: 'Missing oldEmail or newEmail in metadata',
        })
        .eq('id', task.id);
      return Response.json({ error: 'Invalid task metadata' }, { status: 400, headers: corsHeaders });
    }

    const entities = [
      { name: 'Lead', fields: ['rep1', 'rep2', 'pending_rep_email'] },
      { name: 'SalesTask', fields: ['rep1', 'rep2', 'pending_rep_email'] },
      { name: 'Order', fields: ['rep1', 'rep2'] },
      { name: 'Quote', fields: ['created_by_rep'] },
      { name: 'Customer', fields: ['account_manager', 'pending_rep_email'] },
      { name: 'Commission', fields: ['rep1', 'rep2'] },
      { name: 'SupportTicket', fields: ['assigned_to'] },
      { name: 'CallLog', fields: ['rep_id'] },
    ];

    const currentEntityIndex = entities.findIndex(
      (e) => e.name.toLowerCase() === currentEntity.toLowerCase(),
    );

    if (currentEntityIndex === -1) {
      await supabase
        .from('sync_progress')
        .update({
          status: 'completed',
          current_offset: 100,
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);
      return Response.json({ message: 'All entities processed' }, { headers: corsHeaders });
    }

    const entity = entities[currentEntityIndex];
    const tableName = TABLE_MAP[entity.name];
    if (!tableName) throw new Error(`Unknown entity: ${entity.name}`);

    let processed = 0;

    // Process each field for current entity
    for (const field of entity.fields) {
      const { data: items, error: filterError } = await supabase
        .from(tableName)
        .select('*')
        .eq(field, oldEmail)
        .range(entityOffset, entityOffset + BATCH_SIZE - 1);

      if (filterError) throw filterError;

      for (const item of items ?? []) {
        const { error: updateError } = await supabase
          .from(tableName)
          .update({ [field]: newEmail })
          .eq('id', item.id);
        if (updateError) throw updateError;
        processed++;
      }

      if ((items ?? []).length < BATCH_SIZE) {
        // Done with this field, continue to next
        continue;
      } else {
        // More items to process in this field
        const progress = Math.round(((currentEntityIndex + 1) / entities.length) * 100);
        await supabase
          .from('sync_progress')
          .update({
            current_offset: progress,
            total_processed: (task.total_processed || 0) + processed,
            metadata: {
              oldEmail,
              newEmail,
              currentEntity: entity.name.toLowerCase(),
              entityOffset: entityOffset + BATCH_SIZE,
              step: entity.name.toLowerCase(),
            },
          })
          .eq('id', task.id);
        return Response.json(
          {
            message: `Processed ${processed} items for ${entity.name}`,
            progress,
          },
          { headers: corsHeaders },
        );
      }
    }

    // Move to next entity
    const nextEntityIndex = currentEntityIndex + 1;
    if (nextEntityIndex >= entities.length) {
      // All done!
      await supabase
        .from('sync_progress')
        .update({
          status: 'completed',
          current_offset: 100,
          completed_at: new Date().toISOString(),
          metadata: {
            oldEmail,
            newEmail,
            step: 'completed',
          },
        })
        .eq('id', task.id);
      return Response.json({ message: 'Transfer completed successfully!' }, { headers: corsHeaders });
    } else {
      const progress = Math.round(((nextEntityIndex + 1) / entities.length) * 100);
      await supabase
        .from('sync_progress')
        .update({
          current_offset: progress,
          total_processed: (task.total_processed || 0) + processed,
          metadata: {
            oldEmail,
            newEmail,
            currentEntity: entities[nextEntityIndex].name.toLowerCase(),
            entityOffset: 0,
            step: entities[nextEntityIndex].name.toLowerCase(),
          },
        })
        .eq('id', task.id);
      return Response.json(
        {
          message: `Completed ${entity.name}, moving to ${entities[nextEntityIndex].name}`,
          progress,
        },
        { headers: corsHeaders },
      );
    }
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
