import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';
import { applyBulkFilter } from '../_shared/bulkFilter.ts';

const COUNT_BATCH = 500;

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

/**
 * Build a Supabase query with optional filters, sorting, limit, and offset.
 */
function buildQuery(
  supabase: ReturnType<typeof createServiceClient>,
  tableName: string,
  filter: Record<string, unknown> | null,
  limit: number,
  offset: number,
) {
  // The previous version handled only Array→in / scalar→eq. The frontend
  // (BulkUpdate.jsx → buildFilter) actually emits `{$and:[...]}`,
  // `{phone: {$regex:'…'}}`, `{$or:[...]}`, etc — so the old loop turned
  // a `{$and:[...]}` into `eq('$and', [array])` and counted 0 rows on
  // every filtered query. applyBulkFilter mirrors the operator handling
  // in src/api/entities.js so the Edge Function understands the same
  // shapes the rest of the app uses.
  let query = supabase.from(tableName).select('*');

  if (filter && Object.keys(filter).length > 0) {
    query = applyBulkFilter(query, filter);
  }

  query = query.order('created_date', { ascending: false });

  if (offset > 0) {
    query = query.range(offset, offset + limit - 1);
  } else {
    query = query.limit(limit);
  }

  return query;
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

    const { entityName, filter, updates, mode } = await req.json();

    if (!entityName || !mode) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: corsHeaders });
    }

    const tableName = TABLE_MAP[entityName];
    if (!tableName) {
      return Response.json({ error: `Unknown entity: ${entityName}` }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();
    const hasFilter = filter && Object.keys(filter).length > 0;

    if (mode === 'count') {
      let count = 0;
      let offset = 0;
      while (true) {
        const { data: batch, error } = await buildQuery(supabase, tableName, hasFilter ? filter : null, COUNT_BATCH, offset);
        if (error) throw error;
        count += (batch ?? []).length;
        if ((batch ?? []).length < COUNT_BATCH) break;
        offset += COUNT_BATCH;
      }
      return Response.json({ count }, { headers: corsHeaders });
    }

    if (mode === 'execute') {
      if (!updates || Object.keys(updates).length === 0) {
        return Response.json({ error: 'No updates specified' }, { status: 400, headers: corsHeaders });
      }

      // Count first
      let totalCount = 0;
      let offset = 0;
      while (true) {
        const { data: batch, error } = await buildQuery(supabase, tableName, hasFilter ? filter : null, COUNT_BATCH, offset);
        if (error) throw error;
        totalCount += (batch ?? []).length;
        if ((batch ?? []).length < COUNT_BATCH) break;
        offset += COUNT_BATCH;
      }

      const taskName = `bulk_update_${entityName.toLowerCase()}_${Date.now()}`;

      const { error: createError } = await supabase
        .from('sync_progress')
        .insert({
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

      if (createError) throw createError;

      return Response.json({ taskName, totalCount }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Invalid mode' }, { status: 400, headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
