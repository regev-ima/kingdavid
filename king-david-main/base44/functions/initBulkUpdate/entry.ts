import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COUNT_BATCH = 500;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { entityName, filter, updates, mode } = await req.json();

    if (!entityName || !mode) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const entity = base44.asServiceRole.entities[entityName];
    if (!entity) {
      return Response.json({ error: `Unknown entity: ${entityName}` }, { status: 400 });
    }

    const hasFilter = filter && Object.keys(filter).length > 0;

    // Helper: fetch a batch of records respecting filter or listing all
    const fetchBatch = async (limit, offset) => {
      if (hasFilter) {
        return await entity.filter(filter, '-created_date', limit, offset);
      } else {
        return await entity.list('-created_date', limit, offset);
      }
    };

    if (mode === 'count') {
      let count = 0;
      let offset = 0;
      while (true) {
        const batch = await fetchBatch(COUNT_BATCH, offset);
        count += batch.length;
        if (batch.length < COUNT_BATCH) break;
        offset += COUNT_BATCH;
      }
      return Response.json({ count });
    }

    if (mode === 'execute') {
      if (!updates || Object.keys(updates).length === 0) {
        return Response.json({ error: 'No updates specified' }, { status: 400 });
      }

      // Count first
      let totalCount = 0;
      let offset = 0;
      while (true) {
        const batch = await fetchBatch(COUNT_BATCH, offset);
        totalCount += batch.length;
        if (batch.length < COUNT_BATCH) break;
        offset += COUNT_BATCH;
      }

      const taskName = `bulk_update_${entityName.toLowerCase()}_${Date.now()}`;

      await base44.asServiceRole.entities.SyncProgress.create({
        task_name: taskName,
        status: 'in_progress',
        current_offset: 0,
        total_processed: 0,
        metadata: {
          entityName,
          filter: hasFilter ? filter : {},
          hasFilter,
          updates,
          totalCount,
          successCount: 0,
          errorCount: 0,
          errors: [],
          initiatedBy: user.email,
          batchOffset: 0,
        },
      });

      return Response.json({ taskName, totalCount });
    }

    return Response.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (error) {
    console.error('initBulkUpdate error:', error);
    return Response.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
});
