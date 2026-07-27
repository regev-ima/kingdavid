/**
 * Who sees which leads — the single switch.
 *
 * Lead visibility used to be decided in four separate places that had drifted
 * into near-copies of each other:
 *
 *   1. buildLeadsQuery() in pages/LeadManagement.jsx  — the server-side filter
 *      that decides which rows are even fetched (the one that actually matters)
 *   2. the KPI count query in the same file, repeating rule 1 by hand
 *   3. canViewLead() in lib/rbac.js                   — the per-lead guard
 *   4. canViewLead() in components/shared/rbac.jsx    — a second copy of rule 3
 *
 * All four hardcoded "admin sees everything, everyone else sees only leads
 * where their email is rep1, rep2 or pending_rep_email". Changing that policy
 * meant editing four files and hoping none was missed — and #1 is a database
 * query while #3 and #4 are in-memory predicates, so a miss produced the worst
 * kind of bug: rows fetched but then filtered out, or a lead shown in the list
 * that then refuses to open.
 *
 * Everything now routes through this module.
 *
 * Two inputs decide the answer, in order:
 *   • users.extra_permissions.view_all_leads — a per-rep grant, toggled from
 *     the existing "נהל נציג ← הרשאות" tab. Only ever widens.
 *   • app_policies.lead_visibility — the global default, set from
 *     Settings ← הרשאות צפייה, and cached here by hydrateLeadVisibility().
 */

/** Every lead in the system, regardless of who the rep is. */
export const LEAD_VISIBILITY_ALL = 'all';
/** Only leads where the user is rep1, rep2 or the pending rep. */
export const LEAD_VISIBILITY_OWN = 'own';

/**
 * Used until the real policy arrives from the database, and if the fetch ever
 * fails. 'all' is the safer default of the two *for this app*: the failure it
 * produces is a rep seeing a colleague's lead, whereas defaulting to 'own'
 * would silently empty the pipeline for the whole sales floor on a transient
 * network error — a far louder and more damaging failure.
 */
export const DEFAULT_LEAD_VISIBILITY = LEAD_VISIBILITY_ALL;

export function isValidLeadVisibility(value) {
  return value === LEAD_VISIBILITY_ALL || value === LEAD_VISIBILITY_OWN;
}

// ── Cached global policy ────────────────────────────────────────────────────
// canViewLead() is a synchronous predicate called from render paths and from
// plain helpers that have no access to hooks, so the policy has to be readable
// without awaiting anything. useLeadVisibilityPolicy() owns the fetch and calls
// hydrateLeadVisibility(); this module just remembers the answer.
let cachedPolicy = DEFAULT_LEAD_VISIBILITY;

export function hydrateLeadVisibility(value) {
  cachedPolicy = isValidLeadVisibility(value) ? value : DEFAULT_LEAD_VISIBILITY;
  return cachedPolicy;
}

export function getLeadVisibilityPolicy() {
  return cachedPolicy;
}

/**
 * Resolve the policy for a user.
 *
 * `policy` may be passed explicitly by a component that already holds the live
 * value from the query — that path re-renders when an admin flips the setting.
 * Callers that omit it get the cached value, which is correct but only updates
 * on the next render triggered by something else.
 *
 * Admins are never consulted against the policy: an admin who cannot see a lead
 * cannot administer it, and honouring 'own' for them would only create a way to
 * lock yourself out of your own data.
 */
export function resolveLeadVisibility(user, policy = null) {
  if (!user) return LEAD_VISIBILITY_OWN;
  if (user.role === 'admin') return LEAD_VISIBILITY_ALL;

  // Per-rep grant. Only ever widens, never narrows — so it stays meaningful
  // whichever way the global default points. While the default is 'all' it is
  // a no-op; flip the default to 'own' and it becomes the per-rep exception,
  // without touching a single call site.
  if (user.extra_permissions?.view_all_leads === true) return LEAD_VISIBILITY_ALL;

  const effective = isValidLeadVisibility(policy) ? policy : cachedPolicy;
  return isValidLeadVisibility(effective) ? effective : DEFAULT_LEAD_VISIBILITY;
}

/**
 * True when the user should not be narrowed to their own leads.
 *
 * Note what this does NOT do: it says nothing about whether the user belongs in
 * the sales workspace at all. Factory and bookkeeping users are excluded from
 * leads by canAccessSalesWorkspace() upstream, and that stays exactly as it
 * was — opening the pipeline to the sales floor is not the same as opening it
 * to the whole company.
 */
export function canSeeAllLeads(user, policy = null) {
  return resolveLeadVisibility(user, policy) === LEAD_VISIBILITY_ALL;
}
