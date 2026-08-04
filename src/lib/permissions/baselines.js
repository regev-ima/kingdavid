/**
 * Baselines — "what can this user already do, today, before anybody touched
 * the new permissions screen?"
 *
 * This is the heart of the no-regression promise. Every permission in the
 * catalog that corresponds to a gate that already exists in the app carries a
 * `baseline` id from this file. When nothing explicit has been configured for
 * a permission, the resolver falls back to the baseline — so on the day this
 * ships every user resolves to exactly the access they had the day before, and
 * the הרשאות screen is a *view* of the status quo rather than a replacement
 * for it.
 *
 * Each baseline is split in two, and the split matters:
 *
 *   personal(user) — the capability came from a per-user grant that an admin
 *                    switched on for this specific person (users.extra_
 *                    permissions, users.can_manage_service). A role-level
 *                    "off" must NOT cancel it: the grant is the more specific
 *                    decision, and silently dropping it is exactly the
 *                    regression the brief rules out. Only an explicit per-user
 *                    override can take it away.
 *
 *   role(user)     — the capability came from the user's legacy role/scope.
 *                    This is a default, so the role matrix outranks it.
 *
 * Neither one ever denies. `false` here means "this baseline has nothing to
 * say", and the resolver moves on to the access level's default.
 */

import {
  isAdmin,
  isSalesUser,
  isFactoryUser,
  isBookkeeperUser,
} from '@/lib/userScope';
import { getLeadVisibilityPolicy, LEAD_VISIBILITY_ALL } from '@/lib/leadVisibility';

export const BASELINE = {
  /** Everyone who is signed in — screens with no gate at all today. */
  ANY: 'any',
  /** isAdmin() — the `role === 'admin'` gate used by most admin-only screens. */
  ADMIN: 'admin',
  /** canAccessSalesWorkspace() — admin or sales rep. */
  SALES: 'sales',
  /** canAccessFactoryWorkspace() — admin or factory user. */
  FACTORY: 'factory',
  /** canAccessBookkeepingWorkspace() — admin or bookkeeper. */
  BOOKKEEPING: 'bookkeeping',
  /** canViewOrdersWorkspace() — sales, admin or bookkeeper. */
  ORDERS: 'orders',
  /** canAccessSupportWorkspace() — admin, factory or sales. */
  SUPPORT: 'support',
  /** canViewFinanceWorkspace() — admin, bookkeeper, or the `view_finance` grant. */
  FINANCE: 'finance',
  /** canManageService() — admin, `can_manage_service`, or the grant. */
  SERVICE_MANAGE: 'service_manage',
  /** canUseBulkUpdate() — admin or the `bulk_update` grant. */
  BULK_UPDATE: 'bulk_update',
  /** canEditSchedule() — admin or the `edit_schedule` grant. */
  EDIT_SCHEDULE: 'edit_schedule',
  /** canSeeAllLeads() — the app_policies default plus the per-rep grant. */
  VIEW_ALL_LEADS: 'view_all_leads',
  /** Nothing grants this today — the capability is new. */
  NONE: 'none',
};

// Mirrors of the composite gates in lib/rbac.js, re-derived from the same
// lib/userScope primitives rather than imported — lib/rbac.js imports this
// module's resolver, so importing it back would be a cycle. See the header of
// lib/userScope.js for why the primitives were extracted.
const inSales = (user) => isAdmin(user) || isSalesUser(user);
const inFactory = (user) => isAdmin(user) || isFactoryUser(user);
const inBookkeeping = (user) => isAdmin(user) || isBookkeeperUser(user);
const inSupport = (user) => isAdmin(user) || isFactoryUser(user) || isSalesUser(user);

const grant = (user, key) => user?.extra_permissions?.[key] === true;

const NOTHING = () => false;

const BASELINE_FNS = {
  [BASELINE.ANY]: { role: (user) => Boolean(user), personal: NOTHING },
  [BASELINE.ADMIN]: { role: isAdmin, personal: NOTHING },
  [BASELINE.SALES]: { role: inSales, personal: NOTHING },
  [BASELINE.FACTORY]: { role: inFactory, personal: NOTHING },
  [BASELINE.BOOKKEEPING]: { role: inBookkeeping, personal: NOTHING },
  [BASELINE.ORDERS]: { role: (user) => inSales(user) || isBookkeeperUser(user), personal: NOTHING },
  [BASELINE.SUPPORT]: { role: inSupport, personal: NOTHING },
  [BASELINE.FINANCE]: {
    role: (user) => isAdmin(user) || isBookkeeperUser(user),
    personal: (user) => grant(user, 'view_finance'),
  },
  [BASELINE.SERVICE_MANAGE]: {
    role: isAdmin,
    personal: (user) => user?.can_manage_service === true || grant(user, 'manage_service'),
  },
  [BASELINE.BULK_UPDATE]: {
    role: isAdmin,
    personal: (user) => grant(user, 'bulk_update'),
  },
  [BASELINE.EDIT_SCHEDULE]: {
    role: isAdmin,
    personal: (user) => grant(user, 'edit_schedule'),
  },
  [BASELINE.VIEW_ALL_LEADS]: {
    // Mirrors resolveLeadVisibility(): admins always, otherwise the global
    // app_policies default — with the per-rep grant carried as `personal` so a
    // role-level "off" cannot revoke it, exactly as leadVisibility promises
    // ("הרשאה פרטנית תמיד מרחיבה ולעולם אינה מצמצמת").
    role: (user) => isAdmin(user) || getLeadVisibilityPolicy() === LEAD_VISIBILITY_ALL,
    personal: (user) => grant(user, 'view_all_leads'),
  },
  [BASELINE.NONE]: { role: NOTHING, personal: NOTHING },
};

/**
 * Baselines that describe *which workspace a user belongs to* rather than what
 * they are allowed to do inside it.
 *
 * These are the boundaries that `users.role` and `users.department` draw:
 * a factory user is not in the sales workspace, a bookkeeper is not in the
 * support workspace, and no access level is supposed to change that. It
 * matters because inferAccessLevel() maps every non-admin to נציג — a factory
 * user and a sales rep land on the same tier — while the נציג tier defaults in
 * the catalog are written for a sales rep. Without this list, giving the נציג
 * tier `leads.view` by default would quietly hand the whole pipeline to the
 * factory floor.
 *
 * Moving somebody between workspaces is still a `role` / `department` change,
 * exactly as it is today.
 */
const WORKSPACE_BASELINES = new Set([
  BASELINE.SALES,
  BASELINE.FACTORY,
  BASELINE.BOOKKEEPING,
  BASELINE.ORDERS,
  BASELINE.SUPPORT,
]);

export function isWorkspaceBaseline(baselineId) {
  return WORKSPACE_BASELINES.has(baselineId);
}

/** True when a per-user grant already gives this user the capability. */
export function personalBaseline(user, baselineId) {
  if (!user || !baselineId) return false;
  return Boolean(BASELINE_FNS[baselineId]?.personal(user));
}

/** True when the user's legacy role/scope already gives them the capability. */
export function roleBaseline(user, baselineId) {
  if (!user || !baselineId) return false;
  return Boolean(BASELINE_FNS[baselineId]?.role(user));
}

/** Either source — "can they do this today?" without caring which rule said so. */
export function evaluateBaseline(user, baselineId) {
  return personalBaseline(user, baselineId) || roleBaseline(user, baselineId);
}
