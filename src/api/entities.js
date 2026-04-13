import { supabase } from './supabaseClient';

/**
 * Maps PascalCase entity names to snake_case table names in Supabase.
 */
const TABLE_MAP = {
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
 * Creates an entity API object that mimics the Base44 SDK interface:
 *   .list(sort?, limit?)
 *   .filter(filters, sort?, limit?, skip?)
 *   .create(data)
 *   .update(id, data)
 *   .delete(id)
 */
function createEntityAPI(tableName) {
  return {
    /**
     * List all rows, optionally sorted and limited.
     * @param {string} [sort] - e.g. '-created_date' for descending
     * @param {number} [limit] - max rows to return
     */
    async list(sort, limit) {
      let query = supabase.from(tableName).select('*');

      if (sort) {
        const desc = sort.startsWith('-');
        const column = desc ? sort.slice(1) : sort;
        query = query.order(column, { ascending: !desc });
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    /**
     * Filter rows by an object of key-value pairs.
     * @param {Object} filters - e.g. { status: 'new_lead', rep1: 'john@co.il' }
     * @param {string} [sort]
     * @param {number} [limit]
     * @param {number} [skip]
     */
    async filter(filters, sort, limit, skip) {
      let query = supabase.from(tableName).select('*');

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (Array.isArray(value)) {
            query = query.in(key, value);
          } else {
            query = query.eq(key, value);
          }
        }
      }

      if (sort) {
        const desc = sort.startsWith('-');
        const column = desc ? sort.slice(1) : sort;
        query = query.order(column, { ascending: !desc });
      }

      if (skip) {
        query = query.range(skip, skip + (limit || 1000) - 1);
      } else if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    /**
     * Create a new row.
     * @param {Object} data
     */
    async create(data) {
      const { data: result, error } = await supabase
        .from(tableName)
        .insert(data)
        .select()
        .single();
      if (error) throw error;
      return result;
    },

    /**
     * Update a row by ID.
     * @param {string} id
     * @param {Object} data
     */
    async update(id, data) {
      const { data: result, error } = await supabase
        .from(tableName)
        .update(data)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return result;
    },

    /**
     * Delete a row by ID.
     * @param {string} id
     */
    async delete(id) {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
  };
}

/**
 * Proxy that creates entity APIs on demand.
 * Usage: entities.Lead.list(), entities.Order.filter({...}), etc.
 * Mimics base44.entities.* interface.
 */
export const entities = new Proxy({}, {
  get(_, entityName) {
    const tableName = TABLE_MAP[entityName];
    if (!tableName) {
      throw new Error(`Unknown entity: ${entityName}. Add it to TABLE_MAP in entities.js`);
    }
    return createEntityAPI(tableName);
  }
});
