import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  DEFAULT_LEAD_VISIBILITY,
  hydrateLeadVisibility,
  isValidLeadVisibility,
} from '@/lib/leadVisibility';

export const LEAD_VISIBILITY_QUERY_KEY = ['app-policies', 'lead-visibility'];

/**
 * Reads the global lead-visibility default from app_policies (singleton id = 1)
 * and hydrates the cache in lib/leadVisibility so the synchronous predicates
 * there — canViewLead and friends, which run in render paths and in plain
 * helpers with no access to hooks — can answer without awaiting anything.
 *
 * Returns the live value, so a component that uses it re-renders when an admin
 * flips the setting. Components that only need the boolean should pass this
 * into canSeeAllLeads(user, policy) rather than relying on the cache, so the
 * change actually reaches the screen.
 *
 * On error it resolves to DEFAULT_LEAD_VISIBILITY ('all') rather than throwing.
 * A failed policy read must not blank the leads list: erring toward 'own' would
 * empty the pipeline for the whole floor on a transient network blip, which is
 * a far worse failure than a rep briefly seeing a colleague's lead.
 */
export function useLeadVisibilityPolicy() {
  const { data } = useQuery({
    queryKey: LEAD_VISIBILITY_QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      try {
        const rows = await base44.entities.AppPolicy.filter({ id: 1 });
        const value = Array.isArray(rows) ? rows[0]?.lead_visibility : rows?.lead_visibility;
        return hydrateLeadVisibility(value);
      } catch {
        // Table missing (migration not yet applied) or read denied — fall back
        // rather than surfacing an error the user cannot act on.
        return hydrateLeadVisibility(DEFAULT_LEAD_VISIBILITY);
      }
    },
  });

  return isValidLeadVisibility(data) ? data : DEFAULT_LEAD_VISIBILITY;
}
