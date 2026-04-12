import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Check admin authorization
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { oldEmail, newEmail } = await req.json();

    if (!oldEmail || !newEmail) {
      return Response.json({ error: 'Missing oldEmail or newEmail' }, { status: 400 });
    }

    if (oldEmail === newEmail) {
      return Response.json({ error: 'Old and new email cannot be the same' }, { status: 400 });
    }

    const taskName = `transfer_${oldEmail}_to_${newEmail}_${Date.now()}`;
    
    // Create progress tracking - this will be processed by automation
    const progressRecord = await base44.asServiceRole.entities.SyncProgress.create({
      task_name: taskName,
      status: 'in_progress',
      current_offset: 0,
      total_processed: 0,
      metadata: { 
        oldEmail, 
        newEmail, 
        currentEntity: 'leads',
        entityOffset: 0,
        step: 'initializing' 
      }
    });

    return Response.json({
      success: true,
      message: 'Transfer initiated. Processing will continue in background every 5 minutes.',
      taskName,
      progressId: progressRecord.id
    });

  } catch (error) {
    console.error('Transfer initiation error:', error);
    return Response.json({ 
      error: error.message || 'Failed to initiate transfer' 
    }, { status: 500 });
  }
});