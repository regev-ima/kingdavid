import { useCallback, useEffect, useMemo } from 'react';
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
  hydrateSuperAdmin,
} from '@/lib/permissions';

export const SUPER_ADMIN_QUERY_KEY = ['super-admin', 'self'];
export const SUPER_ADMIN_EXISTS_QUERY_KEY = ['super-admin', 'any'];

// Postgres/PostgREST for "that relation or column isn't there" — 42P01 is
// undefined_table, 42703 undefined_column, PGRST20x PostgREST's own schema
// cache misses.
export function isMissingSchemaError(err) {
  if (!err) return false;
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(err.code)) return true;
  const message = err.message || '';
  return /super_admins|access_level|permission_overrides|role_permissions/.test(message)
    && /does not exist|could not find|schema cache/i.test(message);
}

/**
 * Is the SIGNED-IN user a super admin?
 *
 * Answered by selecting from `public.super_admins`, whose RLS returns rows
 * only to members. A non-member gets an empty list — indistinguishable from an
 * empty table, which is exactly the property that keeps the membership secret.
 * There is no query, here or anywhere, that answers this about anybody else.
 *
 * The result is pushed into the resolver's cache (bound to this user's
 * identity) so the synchronous `can()` helpers in lib/rbac can see it without
 * awaiting.
 */
export function useIsSuperAdmin(user) {
  const identity = user?.email || user?.id || null;

  const { data } = useQuery({
    queryKey: [...SUPER_ADMIN_QUERY_KEY, identity],
    enabled: Boolean(identity),
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const rows = await base44.entities.SuperAdmin.list();
        return Array.isArray(rows) && rows.length > 0;
      } catch {
        // Unreadable for any reason — not a member, table missing, network.
        // "No" is the only safe answer to a question about your own privilege.
        return false;
      }
    },
  });

  const isSuperAdmin = data === true;

  useEffect(() => {
    hydrateSuperAdmin(user, isSuperAdmin);
  }, [user, isSuperAdmin]);

  return isSuperAdmin;
}

/**
 * Does ANY super admin exist? Existence only — never identity.
 *
 * A plain SELECT cannot answer this for a non-member (they see zero rows
 * either way), so it goes through the `any_super_admin_exists()` SECURITY
 * DEFINER function, which returns a bare boolean.
 *
 * Two failure modes, two answers:
 *
 *   • the function or table does not exist — the migration has not run, so
 *     there provably is no super admin and the bootstrap window is exactly the
 *     situation it was written for. Answering `true` here would hide the
 *     screen from everyone until a deploy, including on a preview build, where
 *     reviewing it is the entire point.
 *   • anything else — answer `true` and keep the gate shut, because we do not
 *     know, and this is the fallback that loosens it.
 *
 * Either way the database is the real gate: writes are checked by
 * can_manage_permissions() in RLS, so an over-eager `false` here opens a
 * screen whose saves are still refused.
 */
export function useSuperAdminExists() {
  const { data } = useQuery({
    queryKey: SUPER_ADMIN_EXISTS_QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data: exists, error } = await base44.supabase.rpc('any_super_admin_exists');
      if (error) {
        if (isMissingSchemaError(error) || /function .* does not exist/i.test(error.message || '')) {
          return false;
        }
        return true;
      }
      return exists === true;
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
  const isSuperAdmin = useIsSuperAdmin(effectiveUser);
  const superAdminExists = useSuperAdminExists();

  // Every call carries the confidential answer explicitly, so nothing depends
  // on the module cache having been hydrated first.
  const options = useMemo(
    () => ({ matrix, isSuperAdmin, superAdminExists }),
    [matrix, isSuperAdmin, superAdminExists],
  );

  const can = useCallback((key) => canFn(effectiveUser, key, options), [effectiveUser, options]);
  const canAny = useCallback((keys) => canAnyFn(effectiveUser, keys, options), [effectiveUser, options]);
  const explain = useCallback((key) => explainFn(effectiveUser, key, options), [effectiveUser, options]);

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
      isSuperAdmin,
      superAdminExists,
      canManagePermissions: canManagePermissions(effectiveUser, options),
      canManageUserPermissions: canManageUserPermissions(effectiveUser, options),
    }),
    [user, effectiveUser, isLoading, isImpersonating, matrix, can, canAny, explain,
     isSuperAdmin, superAdminExists, options],
  );
}

export default usePermissions;
