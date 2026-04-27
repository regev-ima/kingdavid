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
  NotificationPreferences: 'notification_preferences',
  LeadCounter: 'lead_counters',
  TaskCounter: 'task_counters',
  DashboardCounter: 'dashboard_counters',
  SyncProgress: 'sync_progress',
  UpsellRule: 'upsell_rules',
  UpsellSuggestion: 'upsell_suggestions',
  Representative: 'representatives',
  ClubSignup: 'club_signups',
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
    async list(sort, limit, skip) {
      let query = supabase.from(tableName).select('*');

      if (sort) {
        const desc = sort.startsWith('-');
        const column = desc ? sort.slice(1) : sort;
        query = query.order(column, { ascending: !desc });
      }

      if (skip && limit) {
        query = query.range(skip, skip + limit - 1);
      } else if (limit) {
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

      // Translate one {field: value} or {field: {$op: …}} pair into a
      // PostgREST filter fragment ("field.op.value"). Supports the operator
      // shapes the rest of this file uses: $regex (case-insensitive ILIKE),
      // $eq, $ne, $gte/$lte/$gt/$lt, $in. Used by the $or and (nested) $and
      // branches below.
      const conditionPairToOrFragment = (k, v) => {
        if (v === null) return `${k}.is.null`;
        if (v === '') return `${k}.eq.`;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if (v.$regex != null) return `${k}.ilike.*${v.$regex}*`;
          if (v.$ilike != null) return `${k}.ilike.*${v.$ilike}*`;
          if (v.$in != null) return `${k}.in.(${v.$in.join(',')})`;
          if (v.$gte != null) return `${k}.gte.${v.$gte}`;
          if (v.$lte != null) return `${k}.lte.${v.$lte}`;
          if (v.$gt  != null) return `${k}.gt.${v.$gt}`;
          if (v.$lt  != null) return `${k}.lt.${v.$lt}`;
          if (v.$ne  != null) return `${k}.neq.${v.$ne}`;
          if (v.$eq  != null) return `${k}.eq.${v.$eq}`;
        }
        if (Array.isArray(v)) return `${k}.in.(${v.join(',')})`;
        return `${k}.eq.${v}`;
      };

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          // Handle Base44-style operators
          if (key === '$or' && Array.isArray(value)) {
            // $or: [{rep1: 'a'}, {rep2: 'a'}] → .or('rep1.eq.a,rep2.eq.a')
            // Now also handles operator-shaped values like
            //   { full_name: { $regex: 'רגב', $options: 'i' } }
            // → "full_name.ilike.*רגב*", which used to silently degrade to
            // "full_name.eq.[object Object]" and return 0 rows.
            const orParts = value.map(condition => {
              return Object.entries(condition).map(([k, v]) => conditionPairToOrFragment(k, v)).join(',');
            });
            query = query.or(orParts.join(','));
          } else if (key === '$and' && Array.isArray(value)) {
            for (const condition of value) {
              for (const [k, v] of Object.entries(condition)) {
                // Nested $or: [{...}, {...}] inside $and. Translate the
                // sub-conditions through the same helper so a search
                // {$and:[{status:'open'}, {$or:[{full_name:{$regex:..}}, ...]}]}
                // compiles to a real PostgREST .or() filter rather than
                // silently doing query.eq('$or', [array]).
                if (k === '$or' && Array.isArray(v)) {
                  const orParts = v.map(sub => Object.entries(sub).map(([sk, sv]) => conditionPairToOrFragment(sk, sv)).join(','));
                  query = query.or(orParts.join(','));
                } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                  if (v.$gte) query = query.gte(k, v.$gte);
                  if (v.$lte) query = query.lte(k, v.$lte);
                  if (v.$lt) query = query.lt(k, v.$lt);
                  if (v.$gt) query = query.gt(k, v.$gt);
                  if (v.$ne) query = query.neq(k, v.$ne);
                  if (v.$nin) query = query.not(k, 'in', `(${v.$nin.join(',')})`);
                  if (v.$in) query = query.in(k, v.$in);
                  if (v.$regex != null) query = query.ilike(k, `%${v.$regex}%`);
                  if (v.$ilike != null) query = query.ilike(k, `%${v.$ilike}%`);
                } else {
                  if (v === null) query = query.is(k, null);
                  else query = query.eq(k, v);
                }
              }
            }
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Handle operator objects: { status: { $nin: [...] } }
            if (value.$gte) query = query.gte(key, value.$gte);
            if (value.$lte) query = query.lte(key, value.$lte);
            if (value.$lt) query = query.lt(key, value.$lt);
            if (value.$gt) query = query.gt(key, value.$gt);
            if (value.$ne) query = query.neq(key, value.$ne);
            if (value.$nin) query = query.not(key, 'in', `(${value.$nin.join(',')})`);
            if (value.$in) query = query.in(key, value.$in);
            if (value.$regex) query = query.ilike(key, `%${value.$regex}%`);
          } else if (Array.isArray(value)) {
            query = query.in(key, value);
          } else if (value === null) {
            query = query.is(key, null);
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
     * Count rows matching the same {filters} object filter() accepts.
     * Used by /Leads to show "מציג X לידים" when the user applies a filter,
     * since the visible array is capped by `limit` and doesn't reflect the
     * true match count. Server-side count via PostgREST `Prefer: count=exact`
     * + `head: true` (no rows in the response — just the Content-Range count).
     */
    async count(filters) {
      let query = supabase.from(tableName).select('*', { count: 'exact', head: true });

      const conditionPairToOrFragment = (k, v) => {
        if (v === null) return `${k}.is.null`;
        if (v === '') return `${k}.eq.`;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          if (v.$regex != null) return `${k}.ilike.*${v.$regex}*`;
          if (v.$ilike != null) return `${k}.ilike.*${v.$ilike}*`;
          if (v.$in != null) return `${k}.in.(${v.$in.join(',')})`;
          if (v.$gte != null) return `${k}.gte.${v.$gte}`;
          if (v.$lte != null) return `${k}.lte.${v.$lte}`;
          if (v.$gt  != null) return `${k}.gt.${v.$gt}`;
          if (v.$lt  != null) return `${k}.lt.${v.$lt}`;
          if (v.$ne  != null) return `${k}.neq.${v.$ne}`;
          if (v.$eq  != null) return `${k}.eq.${v.$eq}`;
        }
        if (Array.isArray(v)) return `${k}.in.(${v.join(',')})`;
        return `${k}.eq.${v}`;
      };

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === '$or' && Array.isArray(value)) {
            const orParts = value.map(condition =>
              Object.entries(condition).map(([k, v]) => conditionPairToOrFragment(k, v)).join(',')
            );
            query = query.or(orParts.join(','));
          } else if (key === '$and' && Array.isArray(value)) {
            for (const condition of value) {
              for (const [k, v] of Object.entries(condition)) {
                if (k === '$or' && Array.isArray(v)) {
                  const orParts = v.map(sub => Object.entries(sub).map(([sk, sv]) => conditionPairToOrFragment(sk, sv)).join(','));
                  query = query.or(orParts.join(','));
                } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                  if (v.$gte) query = query.gte(k, v.$gte);
                  if (v.$lte) query = query.lte(k, v.$lte);
                  if (v.$lt) query = query.lt(k, v.$lt);
                  if (v.$gt) query = query.gt(k, v.$gt);
                  if (v.$ne) query = query.neq(k, v.$ne);
                  if (v.$nin) query = query.not(k, 'in', `(${v.$nin.join(',')})`);
                  if (v.$in) query = query.in(k, v.$in);
                  if (v.$regex != null) query = query.ilike(k, `%${v.$regex}%`);
                  if (v.$ilike != null) query = query.ilike(k, `%${v.$ilike}%`);
                } else {
                  if (v === null) query = query.is(k, null);
                  else query = query.eq(k, v);
                }
              }
            }
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.$gte) query = query.gte(key, value.$gte);
            if (value.$lte) query = query.lte(key, value.$lte);
            if (value.$lt) query = query.lt(key, value.$lt);
            if (value.$gt) query = query.gt(key, value.$gt);
            if (value.$ne) query = query.neq(key, value.$ne);
            if (value.$nin) query = query.not(key, 'in', `(${value.$nin.join(',')})`);
            if (value.$in) query = query.in(key, value.$in);
            if (value.$regex) query = query.ilike(key, `%${value.$regex}%`);
          } else if (Array.isArray(value)) {
            query = query.in(key, value);
          } else if (value === null) {
            query = query.is(key, null);
          } else {
            query = query.eq(key, value);
          }
        }
      }

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
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

    /**
     * Subscribe to real-time changes (no-op returning unsubscribe function).
     */
    subscribe(callback) {
      // No-op for now - can be wired to Supabase Realtime later
      return () => {};
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
