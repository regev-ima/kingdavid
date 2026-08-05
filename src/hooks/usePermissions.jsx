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

// Postgres/PostgREST for "that column isn't there" — 42703 is
// undefined_column, PGRST204 is PostgREST's own schema-cache miss.
function isMissingColumnError(err) {
  if (!err) return false;
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  return /access_level/.test(err.message || '') && /does not exist|could not find/i.test(err.message || '');
}

/**
 * Whether anybody at all is marked `access_level = 'super_admin'`.
 *
 * Feeds the bootstrap escape hatch in canManagePermissions(): until somebody
 * is appointed, a legacy admin may open the permissions screen, otherwise a
 * fresh environment has nobody who can reach it.
 *
 * Two failure modes, two answers:
 *
 *   • the column does not exist — the migration has not run, so there
 *     provably is no super admin and the bootstrap window is exactly the
 *     situation it was written for. Answering `true` here would hide the
 *     screen from everyone until a deploy, including on a preview build,
 *     where reviewing it is the entire point.
 *   • anything else — answer `true` and keep the gate shut, because we do not
 *     know, and this is the fallback that loosens it.
 *
 * Either way the database is the real gate: role_permissions writes are
 * checked by can_manage_permissions() in RLS, so an over-eager `false` here
 * opens a screen whose saves would still be refused.
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
      } catch (err) {
        return !isMissingColumnError(err);
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
