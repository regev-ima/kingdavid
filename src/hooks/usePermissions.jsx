import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import {
  can as canFn,
  canAny as canAnyFn,
  explain as explainFn,
  canManagePermissions,
  canManageUserPermissions,
  getAccessLevel,
  isSuperAdmin,
} from '@/lib/permissions';

export const SUPER_ADMIN_EXISTS_QUERY_KEY = ['super-admin-exists'];

/**
 * Whether anybody at all is marked `access_level = 'super_admin'`.
 *
 * Feeds the bootstrap escape hatch in canManagePermissions(): until somebody
 * is appointed, a legacy admin may open the permissions screen, otherwise a
 * fresh environment has nobody who can reach it. Defaults to `true` on error —
 * the safer direction, since the fallback is what loosens the gate.
 */
export function useSuperAdminExists() {
  const { data } = useQuery({
    queryKey: SUPER_ADMIN_EXISTS_QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const rows = await base44.entities.User.filter({ access_level: 'super_admin' });
        return Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
      } catch {
        return true;
      }
    },
  });
  return data !== false;
}

/**
 * The one hook screens use to ask what the signed-in user may do.
 *
 *   const { can } = usePermissions();
 *   {can('finance.view') && <FinanceCard />}
 *
 * Subscribing to useRolePermissions() here is what makes the answers live: the
 * resolver reads the matrix from a module-level cache, and this query is what
 * fills it and re-renders the tree when an admin saves a change.
 */
export function usePermissions() {
  const { user, effectiveUser, isLoading, isImpersonating } = useEffectiveCurrentUser();
  const matrix = useRolePermissions();
  const superAdminExists = useSuperAdminExists();

  const can = useCallback(
    (key) => canFn(effectiveUser, key, { matrix }),
    [effectiveUser, matrix],
  );

  const canAny = useCallback(
    (keys) => canAnyFn(effectiveUser, keys, { matrix }),
    [effectiveUser, matrix],
  );

  const explain = useCallback(
    (key) => explainFn(effectiveUser, key, { matrix }),
    [effectiveUser, matrix],
  );

  return useMemo(
    () => ({
      user,
      effectiveUser,
      isLoading,
      isImpersonating,
      matrix,
      can,
      canAny,
      explain,
      accessLevel: getAccessLevel(effectiveUser),
      isSuperAdmin: isSuperAdmin(effectiveUser),
      superAdminExists,
      canManagePermissions: canManagePermissions(effectiveUser, { superAdminExists }),
      canManageUserPermissions: canManageUserPermissions(effectiveUser, { superAdminExists }),
    }),
    [user, effectiveUser, isLoading, isImpersonating, matrix, can, canAny, explain, superAdminExists],
  );
}

export default usePermissions;
