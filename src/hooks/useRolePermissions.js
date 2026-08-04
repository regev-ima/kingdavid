import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  EDITABLE_ACCESS_LEVELS,
  hydrateRolePermissions,
  getRolePermissions,
} from '@/lib/permissions';

export const ROLE_PERMISSIONS_QUERY_KEY = ['role-permissions'];

/**
 * Reads the per-access-level permission matrix from `role_permissions` and
 * hydrates the synchronous cache in lib/permissions/resolve, so `can()` — which
 * runs inside render paths and inside plain helpers with no access to hooks —
 * can answer without awaiting anything.
 *
 * Same shape as useLeadVisibilityPolicy, and the same failure stance: an
 * unreadable matrix resolves to `{}` rather than throwing. `{}` means "nothing
 * configured", which sends every check back to its legacy gate — so a network
 * blip or a not-yet-applied migration leaves the app behaving exactly as it did
 * before this feature existed, instead of locking the floor out of their work.
 */
export function useRolePermissions() {
  const { data } = useQuery({
    queryKey: ROLE_PERMISSIONS_QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      try {
        const rows = await base44.entities.RolePermission.list();
        const matrix = {};
        for (const row of Array.isArray(rows) ? rows : []) {
          if (EDITABLE_ACCESS_LEVELS.includes(row?.id)) {
            matrix[row.id] = row.permissions || {};
          }
        }
        return hydrateRolePermissions(matrix);
      } catch {
        // Table missing (migration not applied yet) or read denied.
        return hydrateRolePermissions({});
      }
    },
  });

  return data || getRolePermissions();
}
