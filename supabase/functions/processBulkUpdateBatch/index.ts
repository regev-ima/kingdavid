import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

const BATCH_SIZE = 20;
const UPDATE_DELAY = 200;

const TABLE_MAP: Record<string, string> = {
  Lead: 'leads',
  User: 'users',
  Customer: 'customers',
  Order: 'orders',
  Quote: 'quotes',
  SalesTask: 'sales_tasks',
  Product: 'products',
  ProductVariation: 'product_variations',
  ProductAddon: 'product_addons',
  ProductAddonPrice: 'product_addon_prices',
  ProductCatalog: 'product_catalogs',
  ProductSize: 'product_sizes',
  ProductSizePrice: 'product_size_prices',
  GlobalSize: 'global_sizes',
  ExtraCharge: 'extra_charges',
  InventoryItem: 'inventory_items',
  InventoryMovement: 'inventory_movements',
  DeliveryShipment: 'delivery_shipments',
  DeliveryRoute: 'delivery_routes',
  Commission: 'commissions',
  MarketingCost: 'marketing_costs',
  SupportTicket: 'support_tickets',
  ReturnRequest: 'return_requests',
  LeadActivityLog: 'lead_activity_logs',
  CallLog: 'call_logs',
  AuditLog: 'audit_logs',
  CommunicationLog: 'communication_logs',
  WhatsAppMessageLog: 'whatsapp_message_logs',
  Notification: 'notifications',
  NotificationPreference: 'notification_preferences',
  LeadCounter: 'lead_counters',
  TaskCounter: 'task_counters',
  DashboardCounter: 'dashboard_counters',
  SyncProgress: 'sync_progress',
  UpsellRule: 'upsell_rules',
  UpsellSuggestion: 'upsell_suggestions',
  Representative: 'representatives',
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 3, backoff = 3000): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const msg = (error as Error).message ?? '';
    const isRateLimit = msg.includes('Rate limit') || (error as any).status === 429;
    if (isRateLimit && retries > 0) {
      console.warn(`Rate limit hit. Waiting ${backoff / 1000}s and retrying...`);
      await delay(backoff);
      return fetchWithRetry(fn, retries - 1, backoff * 2);
    }
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await getUser(req);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { taskName } = await req.json();
    if (!taskName) {
      return Response.json({ error: 'Missing taskName' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    // Load task
    const { data: tasks, error: taskError } = await supabase
      .from('sync_progress')
      .select('*')
      .eq('task_name', taskName)
      .order('created_date', { ascending: false })
      .limit(1);

    if (taskError) throw taskError;
    if (!tasks || tasks.length === 0) {
      return Response.json({ error: 'Task not found' }, { status: 404, headers: corsHeaders });
    }

    const task = tasks[0];

    // Check if cancelled
    if (task.status !== 'in_progress') {
      return Response.json(
        {
          hasMore: false,
          processed: 0,
          successCount: task.metadata?.successCount || 0,
          errorCount: task.metadata?.errorCount || 0,
          cancelled: task.status === 'cancelled',
        },
        { headers: corsHeaders },
      );
    }

    const { entityName, filter, hasFilter, updates, totalCount, batchOffset = 0 } = task.metadata;
    let { successCount = 0, errorCount = 0, errors = [] } = task.metadata;

    const tableName = TABLE_MAP[entityName];
    if (!tableName) throw new Error(`Unknown entity: ${entityName}`);

    // Fetch batch
    const items = await fetchWithRetry(async () => {
      let query = supabase.from(tableName).select('*');

      if (hasFilter && filter && Object.keys(filter).length > 0) {
        for (const [key, value] of Object.entries(filter)) {
          if (Array.isArray(value)) {
            query = query.in(key, value as string[]);
          } else {
            query = query.eq(key, value as string);
          }
        }
      }

      query = query.order('created_date', { ascending: false });

      if (batchOffset > 0) {
        query = query.range(batchOffset, batchOffset + BATCH_SIZE - 1);
      } else {
        query = query.limit(BATCH_SIZE);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    });

    let batchProcessed = 0;

    for (const item of items) {
      try {
        await fetchWithRetry(async () => {
          const { error: updateError } = await supabase
            .from(tableName)
            .update(updates)
            .eq('id', item.id);
          if (updateError) throw updateError;
        });
        successCount++;
      } catch (err) {
        errorCount++;
        if (errors.length < 100) {
          errors.push({ id: item.id, error: (err as Error).message || 'Unknown error' });
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

    const { error: progressError } = await supabase
      .from('sync_progress')
      .update({
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
      })
      .eq('id', task.id);

    if (progressError) throw progressError;

    return Response.json(
      {
        hasMore,
        processed: batchProcessed,
        successCount,
        errorCount,
        totalCount,
        progress: progressPercent,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
