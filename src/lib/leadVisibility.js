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
 * kind of bug: rows fetched but then filtered out, or shown in a list and then
 * refused on the detail page.
 *
 * Everything now routes through this module. It is deliberately the only place
 * the policy is written down, so the permissions screen can later change the
 * behaviour by changing what resolveLeadVisibility() reads, without touching a
 * single call site.
 */

/** Every lead in the system, regardless of who the rep is. */
export const LEAD_VISIBILITY_ALL = 'all';
/** Only leads where the user is rep1, rep2 or the pending rep. */
export const LEAD_VISIBILITY_OWN = 'own';

/**
 * The policy in force when nothing overrides it.
 *
 * This is 'all': the sales floor works a shared pipeline, and reps were losing
 * leads simply because the lead had been created under someone else's name.
 * Admins were already unrestricted, so this only changes what non-admin sales
 * users see.
 */
export const DEFAULT_LEAD_VISIBILITY = LEAD_VISIBILITY_ALL;

/**
 * Resolve the policy for a user.
 *
 * `settings` is the per-role configuration the permissions screen will write —
 * shaped `{ leadVisibilityByRole: { user: 'all', admin: 'all' } }`. It is
 * optional, and while it is absent every caller gets DEFAULT_LEAD_VISIBILITY,
 * which is what makes the shared-pipeline behaviour live today without a
 * database round-trip on every render.
 *
 * Admins are not consulted against settings at all: an admin who cannot see a
 * lead cannot administer it, and letting the screen express that would only
 * create a way to lock yourself out.
 */
export function resolveLeadVisibility(user, settings = null) {
  if (!user) return LEAD_VISIBILITY_OWN;
  if (user.role === 'admin') return LEAD_VISIBILITY_ALL;

  // Per-rep grant, stored in users.extra_permissions and toggled from the
  // existing "נהל נציג → הרשאות" tab. It can only widen access, never narrow
  // it, so it stays meaningful whichever way the default points: today the
  // default is already 'all' and the grant is a no-op; flip the default to
  // 'own' and this becomes the per-rep exception without touching call sites.
  if (user.extra_permissions?.view_all_leads === true) return LEAD_VISIBILITY_ALL;

  const byRole = settings?.leadVisibilityByRole;
  const configured = byRole ? byRole[user.role] : undefined;

  if (configured === LEAD_VISIBILITY_ALL || configured === LEAD_VISIBILITY_OWN) {
    return configured;
  }
  return DEFAULT_LEAD_VISIBILITY;
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
export function canSeeAllLeads(user, settings = null) {
  return resolveLeadVisibility(user, settings) === LEAD_VISIBILITY_ALL;
}
