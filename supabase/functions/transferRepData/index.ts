import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Check admin authorization
    const user = await getUser(req);
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403, headers: corsHeaders });
    }

    const { oldEmail, newEmail } = await req.json();

    if (!oldEmail || !newEmail) {
      return Response.json({ error: 'Missing oldEmail or newEmail' }, { status: 400, headers: corsHeaders });
    }

    if (oldEmail === newEmail) {
      return Response.json({ error: 'Old and new email cannot be the same' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();
    const taskName = `transfer_${oldEmail}_to_${newEmail}_${Date.now()}`;

    // Create progress tracking - this will be processed by automation
    const { data: progressRecord, error } = await supabase
      .from('sync_progress')
      .insert({
        task_name: taskName,
        status: 'in_progress',
        current_offset: 0,
        total_processed: 0,
        metadata: {
          oldEmail,
          newEmail,
          currentEntity: 'leads',
          entityOffset: 0,
          step: 'initializing',
        },
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(
      {
        success: true,
        message: 'Transfer initiated. Processing will continue in background every 5 minutes.',
        taskName,
        progressId: progressRecord.id,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('Transfer initiation error:', error);
    return Response.json(
      { error: (error as Error).message || 'Failed to initiate transfer' },
      { status: 500, headers: corsHeaders },
    );
  }
});
