import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { phoneTail } from '@/utils/phoneUtils';

// Re-exported so the WhatsApp components keep importing it from here.
export { phoneTail };

const OPEN_TICKET_STATUSES = new Set(['open', 'in_progress', 'pending', 'waiting', 'new', 'assigned']);
export function isOpenTicket(t) {
  const s = (t?.status || '').toLowerCase();
  if (!s) return true;
  return OPEN_TICKET_STATUSES.has(s) || !['closed', 'resolved', 'done', 'cancelled', 'canceled'].includes(s);
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

  return useQuery({
    queryKey: ['wa-context', tail],
    enabled: !!tail && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [leads, customers, orders, tickets] = await Promise.all([
        base44.entities.Lead.filter({ phone: { $regex: tail } }, '-created_date', 5).catch(() => []),
        base44.entities.Customer.filter({ phone: { $regex: tail } }, '-created_date', 5).catch(() => []),
        base44.entities.Order.filter({ customer_phone: { $regex: tail } }, '-created_date', 10).catch(() => []),
        base44.entities.SupportTicket.filter({ customer_phone: { $regex: tail } }, '-created_date', 10).catch(() => []),
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
