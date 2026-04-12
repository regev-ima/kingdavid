import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BATCH_SIZE = 20; // Process 20 items per run

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Find in-progress transfer tasks
    const tasks = await base44.asServiceRole.entities.SyncProgress.filter({ 
      status: 'in_progress',
      task_name: { $regex: '^transfer_' }
    });

    if (tasks.length === 0) {
      return Response.json({ message: 'No active transfer tasks' });
    }

    // Process first task
    const task = tasks[0];
    const { oldEmail, newEmail, currentEntity = 'leads', entityOffset = 0 } = task.metadata || {};

    if (!oldEmail || !newEmail) {
      await base44.asServiceRole.entities.SyncProgress.update(task.id, {
        status: 'failed',
        error_message: 'Missing oldEmail or newEmail in metadata'
      });
      return Response.json({ error: 'Invalid task metadata' }, { status: 400 });
    }

    const entities = [
      { name: 'Lead', fields: ['rep1', 'rep2', 'pending_rep_email'] },
      { name: 'SalesTask', fields: ['rep1', 'rep2', 'pending_rep_email'] },
      { name: 'Order', fields: ['rep1', 'rep2'] },
      { name: 'Quote', fields: ['created_by_rep'] },
      { name: 'Customer', fields: ['account_manager', 'pending_rep_email'] },
      { name: 'Commission', fields: ['rep1', 'rep2'] },
      { name: 'SupportTicket', fields: ['assigned_to'] },
      { name: 'CallLog', fields: ['rep_id'] }
    ];

    const currentEntityIndex = entities.findIndex(e => e.name.toLowerCase() === currentEntity.toLowerCase());
    if (currentEntityIndex === -1) {
      await base44.asServiceRole.entities.SyncProgress.update(task.id, {
        status: 'completed',
        current_offset: 100,
        completed_at: new Date().toISOString()
      });
      return Response.json({ message: 'All entities processed' });
    }

    const entity = entities[currentEntityIndex];
    let processed = 0;

    // Process each field for current entity
    for (const field of entity.fields) {
      const filter = { [field]: oldEmail };
      const items = await base44.asServiceRole.entities[entity.name].filter(filter, undefined, BATCH_SIZE, entityOffset);
      
      for (const item of items) {
        await base44.asServiceRole.entities[entity.name].update(item.id, { [field]: newEmail });
        processed++;
      }

      if (items.length < BATCH_SIZE) {
        // Done with this field, continue to next
        continue;
      } else {
        // More items to process in this field
        const progress = Math.round(((currentEntityIndex + 1) / entities.length) * 100);
        await base44.asServiceRole.entities.SyncProgress.update(task.id, {
          current_offset: progress,
          total_processed: (task.total_processed || 0) + processed,
          metadata: {
            oldEmail,
            newEmail,
            currentEntity: entity.name.toLowerCase(),
            entityOffset: entityOffset + BATCH_SIZE,
            step: entity.name.toLowerCase()
          }
        });
        return Response.json({ 
          message: `Processed ${processed} items for ${entity.name}`,
          progress 
        });
      }
    }

    // Move to next entity
    const nextEntityIndex = currentEntityIndex + 1;
    if (nextEntityIndex >= entities.length) {
      // All done!
      await base44.asServiceRole.entities.SyncProgress.update(task.id, {
        status: 'completed',
        current_offset: 100,
        completed_at: new Date().toISOString(),
        metadata: {
          oldEmail,
          newEmail,
          step: 'completed'
        }
      });
      return Response.json({ message: 'Transfer completed successfully!' });
    } else {
      const progress = Math.round(((nextEntityIndex + 1) / entities.length) * 100);
      await base44.asServiceRole.entities.SyncProgress.update(task.id, {
        current_offset: progress,
        total_processed: (task.total_processed || 0) + processed,
        metadata: {
          oldEmail,
          newEmail,
          currentEntity: entities[nextEntityIndex].name.toLowerCase(),
          entityOffset: 0,
          step: entities[nextEntityIndex].name.toLowerCase()
        }
      });
      return Response.json({ 
        message: `Completed ${entity.name}, moving to ${entities[nextEntityIndex].name}`,
        progress 
      });
    }

  } catch (error) {
    console.error('Batch processing error:', error);
    return Response.json({ 
      error: error.message || 'Failed to process batch' 
    }, { status: 500 });
  }
});