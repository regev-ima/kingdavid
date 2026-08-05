/**
 * The primitive "who is this user" predicates — extracted so that BOTH
 * lib/rbac.js and lib/permissions/* can ask the question without importing
 * each other.
 *
 * Why this file exists: the permissions system (lib/permissions) needs the
 * legacy role checks to compute its *baseline* — the grandfather rule that
 * says "whatever a user can do today, they keep". lib/rbac.js in turn needs
 * the permissions resolver so a newly-granted capability actually reaches the
 * screens. Left in one file that is a cycle; duplicated in two files it is the
 * exact drift that lib/leadVisibility.js was written to end. So the primitives
 * live here, alone, and everything else imports downhill from them.
 *
 * lib/rbac.js re-exports every symbol below, so existing
 * `import { isAdmin } from '@/lib/rbac'` call sites keep working unchanged.
 */

export const USER_SCOPES = {
  ADMIN: 'admin',
  SALES: 'sales_user',
  FACTORY: 'factory_user',
  // מנהלת חשבונות: narrow scope that only sees the invoicing area
  // (orders waiting for / with an issued invoice). Detected via
  // `role === 'bookkeeper'` OR `department === 'bookkeeping'` so
  // existing user records can be flagged either way.
  BOOKKEEPER: 'bookkeeper',
  ANON: 'anonymous',
};

export function getUserScope(user) {
  if (!user) return USER_SCOPES.ANON;
  if (user.role === 'admin') return USER_SCOPES.ADMIN;
  if (user.department === 'factory' || user.role === 'factory_user') return USER_SCOPES.FACTORY;
  if (user.department === 'bookkeeping' || user.role === 'bookkeeper') return USER_SCOPES.BOOKKEEPER;
  return USER_SCOPES.SALES;
}

export function isAdmin(user) {
  return getUserScope(user) === USER_SCOPES.ADMIN;
}

export function isSalesUser(user) {
  return getUserScope(user) === USER_SCOPES.SALES;
}

export function isFactoryUser(user) {
  return getUserScope(user) === USER_SCOPES.FACTORY;
}

export function isBookkeeperUser(user) {
  return getUserScope(user) === USER_SCOPES.BOOKKEEPER;
}

/**
 * True when `key` is switched on in the rep's `users.extra_permissions` blob —
 * the original per-rep grant mechanism, managed from "נהל נציג ← הרשאות".
 * Admins implicitly have every grantable permission.
 *
 * These grants are per-user and explicit, so the new permissions system treats
 * them as un-revokable by anything less specific than another per-user
 * decision: a role-level "off" never cancels one. See lib/permissions/resolve.
 */
export function hasExtraPermission(user, key) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return user.extra_permissions?.[key] === true;
}
