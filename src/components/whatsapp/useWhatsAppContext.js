import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { phoneTail, normalizeIsraeliPhone } from '@/utils/phoneUtils';

// Re-exported so the WhatsApp components keep importing it from here.
export { phoneTail };

const OPEN_TICKET_STATUSES = new Set(['open', 'in_progress', 'pending', 'waiting', 'new', 'assigned']);
export function isOpenTicket(t) {
  const s = (t?.status || '').toLowerCase();
  if (!s) return true;
  return OPEN_TICKET_STATUSES.has(s) || !['closed', 'resolved', 'done', 'cancelled', 'canceled'].includes(s);
}

/**
 * One phone lookup, done the fast way.
 *
 * This used to ask for `phone ILIKE '%<last 9 digits>%'`. A leading wildcard
 * makes an index unusable, so every click on a conversation triggered a FULL
 * SEQUENTIAL SCAN of leads, customers, orders and support_tickets — four of
 * them, each with row security on top. That is what made the "פרטי לקוח" panel
 * sit on a spinner for seconds.
 *
 * `phone_normalized` is a GENERATED STORED column (972XXXXXXXXX, from
 * public.normalize_il_phone) with an index behind it, so an equality match on
 * it is a single index lookup — and it is also the column the database itself
 * treats as contact identity, which makes it MORE accurate than a substring
 * match, not less.
 *
 * The ILIKE path stays as a fallback for one reason: `phone_normalized` reaches
 * orders / support_tickets in migration 20260805000003, and this file ships to
 * the browser before that migration necessarily runs. If the column isn't there
 * yet PostgREST answers 400, we retry the old way, and the panel is correct
 * either way.
 */
async function byPhone(entity, normalizedField, rawField, norm, tail, limit) {
  if (norm) {
    try {
      return await entity.filter({ [normalizedField]: norm }, '-created_date', limit);
    } catch {
      /* column not there yet — fall through to the substring match */
    }
  }
  if (!tail) return [];
  return entity.filter({ [rawField]: { $regex: tail } }, '-created_date', limit).catch(() => []);
}

/**
 * Resolve the full CRM context for a WhatsApp contact's phone number:
 * matching leads, customers, orders, quotes (linked via the matched leads),
 * and service tickets. RLS-scoped, so a rep only ever sees their own records.
 *
 * Each sub-query is independently fault-tolerant (→ []), so one failing table
 * never blanks the whole panel.
 */
export function useWhatsAppContext(phone, enabled = true) {
  const tail = phoneTail(phone);
  const norm = normalizeIsraeliPhone(phone) || '';

  return useQuery({
    queryKey: ['wa-context', norm || tail],
    enabled: !!tail && enabled,
    staleTime: 5 * 60_000,
    // The panel is per-contact and the underlying CRM rows rarely change while
    // a rep reads one conversation. Keeping the previous answer in cache is
    // what makes going back to a chat instant instead of another round trip.
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const [leads, customers, orders, tickets] = await Promise.all([
        byPhone(base44.entities.Lead, 'phone_normalized', 'phone', norm, tail, 5),
        byPhone(base44.entities.Customer, 'phone_normalized', 'phone', norm, tail, 5),
        byPhone(base44.entities.Order, 'customer_phone_normalized', 'customer_phone', norm, tail, 10),
        byPhone(base44.entities.SupportTicket, 'customer_phone_normalized', 'customer_phone', norm, tail, 10),
      ]);

      // Quotes have no phone column — link them through the matched leads.
      const leadIds = (leads || []).map((l) => l.id).filter(Boolean);
      let quotes = [];
      if (leadIds.length) {
        quotes = await base44.entities.Quote
          .filter({ lead_id: { $in: leadIds } }, '-created_date', 10)
          .catch(() => []);
      }

      const safe = (a) => (Array.isArray(a) ? a : []);
      return {
        leads: safe(leads),
        customers: safe(customers),
        orders: safe(orders),
        tickets: safe(tickets),
        quotes: safe(quotes),
      };
    },
  });
}
