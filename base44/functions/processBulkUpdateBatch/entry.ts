import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BATCH_SIZE = 20;
const UPDATE_DELAY = 200;

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(fn: () => Promise<any>, retries = 3, backoff = 3000) {
  try {
    return await fn();
  } catch (error) {
    const isRateLimit = error.message?.includes('Rate limit') || error.status === 429;
    if (isRateLimit && retries > 0) {
      console.warn(`Rate limit hit. Waiting ${backoff / 1000}s and retrying...`);
      await delay(backoff);
      return fetchWithRetry(fn, retries - 1, backoff * 2);
    }
    throw error;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskName } = await req.json();
    if (!taskName) {
      return Response.json({ error: 'Missing taskName' }, { status: 400 });
    }

    // Load task
    const tasks = await base44.asServiceRole.entities.SyncProgress.filter({
      task_name: taskName,
    }, '-created_date', 1);

    if (tasks.length === 0) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    const task = tasks[0];

    // Check if cancelled
    if (task.status !== 'in_progress') {
      return Response.json({
        hasMore: false,
        processed: 0,
        successCount: task.metadata?.successCount || 0,
        errorCount: task.metadata?.errorCount || 0,
        cancelled: task.status === 'cancelled',
      });
    }

    const { entityName, filter, hasFilter, updates, totalCount, batchOffset = 0 } = task.metadata;
    let { successCount = 0, errorCount = 0, errors = [] } = task.metadata;

    const entity = base44.asServiceRole.entities[entityName];

    // Fetch batch - use filter() or list() depending on whether we have a filter
    const items = await fetchWithRetry(() => {
      if (hasFilter && filter && Object.keys(filter).length > 0) {
        return entity.filter(filter, '-created_date', BATCH_SIZE, batchOffset);
      } else {
        return entity.list('-created_date', BATCH_SIZE, batchOffset);
      }
    });

    let batchProcessed = 0;

    for (const item of items) {
      try {
        await fetchWithRetry(() => entity.update(item.id, updates));
        successCount++;
      } catch (err) {
        errorCount++;
        if (errors.length < 100) {
          errors.push({ id: item.id, error: err.message || 'Unknown error' });
        }
      }
      batchProcessed++;
      if (batchProcessed < items.length) {
        await delay(UPDATE_DELAY);
      }
    }

    const newOffset = batchOffset + items.length;
    const hasMore = items.length === BATCH_SIZE;
    const isCompleted = !hasMore;

    const progressPercent = totalCount > 0
      ? Math.round((newOffset / totalCount) * 100)
      : 100;

    await base44.asServiceRole.entities.SyncProgress.update(task.id, {
      status: isCompleted ? 'completed' : 'in_progress',
      current_offset: progressPercent,
      total_processed: successCount + errorCount,
      ...(isCompleted ? { completed_at: new Date().toISOString() } : {}),
      metadata: {
        ...task.metadata,
        batchOffset: newOffset,
        successCount,
        errorCount,
        errors,
      },
    });

    return Response.json({
      hasMore,
      processed: batchProcessed,
      successCount,
      errorCount,
      totalCount,
      progress: progressPercent,
    });
  } catch (error) {
    console.error('processBulkUpdateBatch error:', error);
    return Response.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
});
