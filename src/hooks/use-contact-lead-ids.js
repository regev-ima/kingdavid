import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Every lead row belonging to this lead's person, its own included.
 *
 * A repeat enquiry deliberately gets its own lead row so the daily count
 * matches what the ad networks report, and a database trigger ties them all to
 * one contact by normalized phone. Everything hanging off a lead — calls,
 * orders, quotes — therefore hangs off whichever row happened to be current at
 * the time, and asking one row about "this person's history" gets you a slice
 * of it at best.
 *
 * So anything on the lead screen that answers a question about the PERSON
 * ("have we spoken to him?", "has he bought before?") resolves the contact's
 * rows through here first, and queries all of them.
 *
 * Falls back to `[leadId]` — a lead with no contact_id is its own history.
 */
export function useContactLeadIds(lead) {
  const leadId = lead?.id || null;
  const contactId = lead?.contact_id || null;

  const { data } = useQuery({
    queryKey: ['contact-lead-ids', leadId, contactId],
    enabled: !!leadId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!contactId) return [leadId];
      const rows = await base44.entities.Lead.filter({ contact_id: contactId });
      if (!Array.isArray(rows)) return [leadId];
      // The lead's own id first, so callers that care about ordering see the
      // row the rep is actually looking at ahead of its siblings.
      return [...new Set([leadId, ...rows.map((r) => r?.id).filter(Boolean)])];
    },
  });

  return data || (leadId ? [leadId] : []);
}

export default useContactLeadIds;
