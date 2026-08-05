/**
 * The resolver — one function, `can(user, key)`, that every gate in the app
 * can call.
 *
 * Decision order for a single permission
 * ──────────────────────────────────────
 *   0. Super admin                     → allowed, always. Full stop.
 *   1. An ancestor permission is denied → denied. This is what makes "block
 *      the whole ההגדרות area" also block every section and sub-section
 *      inside it, with no per-node bookkeeping.
 *   2. Explicit per-user override      → decisive, true or false. The most
 *      specific decision anyone can make, so it wins over everything below.
 *   3. Per-user legacy grant           → allowed. An admin already switched
 *      this on for this person (users.extra_permissions); a role-level "off"
 *      is a blunter instrument and must not silently revoke it.
 *   4. Role matrix for the user's access level → decisive, true or false.
 *   5. Baseline                        → the legacy role gate, OR-ed with the
 *      access level's default. Never narrower than either.
 *
 * Step 5 is why nothing changes on rollout: with an empty role matrix and no
 * per-user overrides — the state of the world the moment this ships — every
 * answer is the legacy answer.
 *
 * The role matrix is read from a module-level cache rather than passed in,
 * for the same reason lib/leadVisibility caches its policy: `can()` is called
 * from render paths and from plain helpers that cannot await or use hooks.
 * hooks/useRolePermissions owns the fetch and calls hydrateRolePermissions().
 */

import { getPermission, getAncestorKeys, permissionExists } from './catalog';
import { personalBaseline, roleBaseline, isWorkspaceBaseline } from './baselines';
import {
  ACCESS_LEVELS,
  EDITABLE_ACCESS_LEVELS,
  getAccessLevel,
  accessLevelRank,
  isStorableAccessLevel,
} from './roles';

// ── Super-admin status ──────────────────────────────────────────────────────
// Deliberately NOT derived from the user object. Membership lives in
// `public.super_admins`, which only members may read, so the only person whose
// status this process can know is the one holding the session.
//
// The cache is bound to that identity. Without the binding, a `can()` call
// about somebody else — the rep being previewed in נהל נציג ← הרשאות — would
// silently inherit the signed-in super admin's answer and show every switch as
// granted.
let superAdminIdentity = null;
let superAdminFlag = false;

function identityOf(user) {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  return email || (user?.id != null ? `id:${user.id}` : '');
}

/** Called by hooks/usePermissions once the confidential lookup resolves. */
export function hydrateSuperAdmin(user, value) {
  superAdminIdentity = identityOf(user);
  superAdminFlag = Boolean(value) && Boolean(superAdminIdentity);
  return superAdminFlag;
}

export function clearSuperAdmin() {
  superAdminIdentity = null;
  superAdminFlag = false;
}

/**
 * True when `user` is the signed-in user AND they are a super admin.
 *
 * Returns false for everybody else — including an actual super admin who
 * happens to be the subject of the question rather than the asker. That is
 * correct: this process has no way to know, and guessing would leak.
 */
export function isSuperAdmin(user, options = {}) {
  if (typeof options.isSuperAdmin === 'boolean') return options.isSuperAdmin;
  if (!user || !superAdminFlag) return false;
  const identity = identityOf(user);
  return Boolean(identity) && identity === superAdminIdentity;
}

// ── Role matrix cache ──────────────────────────────────────────────────────
// Shape: { [accessLevel]: { [permissionKey]: true | false } }. Absent key =
// "not configured", which is different from `false` and falls through to the
// baseline. Only ever written by hydrateRolePermissions().
let cachedMatrix = {};

export function hydrateRolePermissions(matrix) {
  cachedMatrix = normalizeMatrix(matrix);
  return cachedMatrix;
}

export function getRolePermissions() {
  return cachedMatrix;
}

/** Drops unknown levels, unknown permission keys and non-boolean values. */
export function normalizeMatrix(matrix) {
  const out = {};
  if (!matrix || typeof matrix !== 'object') return out;
  for (const level of EDITABLE_ACCESS_LEVELS) {
    const raw = matrix[level];
    if (!raw || typeof raw !== 'object') continue;
    const clean = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'boolean' && permissionExists(key)) clean[key] = value;
    }
    if (Object.keys(clean).length) out[level] = clean;
  }
  return out;
}

/** Per-user overrides, same shape as one row of the matrix. */
export function normalizeOverrides(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'boolean' && permissionExists(key)) out[key] = value;
  }
  return out;
}

// ── Sources, for the "why?" the UI shows next to every toggle ──────────────
export const SOURCE = {
  SUPER_ADMIN: 'super_admin',
  ANCESTOR: 'ancestor',
  USER_OVERRIDE: 'user_override',
  USER_GRANT: 'user_grant',
  ROLE_MATRIX: 'role_matrix',
  ACCESS_LEVEL: 'access_level',
  LEGACY_ROLE: 'legacy_role',
  LEVEL_DEFAULT: 'level_default',
  UNKNOWN: 'unknown',
};

export const SOURCE_LABELS = {
  [SOURCE.SUPER_ADMIN]: 'סופר אדמין — גישה מלאה',
  [SOURCE.ANCESTOR]: 'חסום כי סעיף האב חסום',
  [SOURCE.USER_OVERRIDE]: 'הוגדר ידנית לנציג הזה',
  [SOURCE.USER_GRANT]: 'הרשאה אישית קיימת (נהל נציג ← הרשאות)',
  [SOURCE.ROLE_MATRIX]: 'לפי רמת ההרשאה',
  [SOURCE.ACCESS_LEVEL]: 'הוסר כשרמת ההרשאה הורדה',
  [SOURCE.LEGACY_ROLE]: 'לפי התפקיד הקיים במערכת',
  [SOURCE.LEVEL_DEFAULT]: 'ברירת המחדל של רמת ההרשאה',
  [SOURCE.UNKNOWN]: 'הרשאה לא מוכרת',
};

/**
 * Was this user deliberately moved DOWN from the level their legacy role
 * implies?
 *
 * `access_level` is seeded to match the role for everybody (admin → מנהל ראשי,
 * everyone else → נציג), so this is false for every account until a human
 * opens נהל נציג ← הרשאות and picks something lower. That makes it a reliable
 * signal of intent rather than an accident of the rollout.
 */
function wasDemoted(user) {
  if (!user || !isStorableAccessLevel(user.access_level)) return false;
  const implied = user.role === 'admin' ? ACCESS_LEVELS.CHIEF_MANAGER : ACCESS_LEVELS.REP;
  return accessLevelRank(user.access_level) < accessLevelRank(implied);
}

/**
 * True when the only reason the user holds this capability is that they are a
 * legacy `role === 'admin'` — and they have been demoted.
 *
 * Without this, moving somebody from מנהל to מנהל חנות changes nothing at all:
 * every admin-gated capability keeps resolving true through the ADMIN baseline
 * no matter what tier they sit at, so the demotion is a label. Dropping the
 * admin-derived grant is the whole point of demoting somebody.
 *
 * Scoped tightly, and in two ways. It only fires for a deliberate demotion,
 * and it only removes what being an admin was granting: the baseline is
 * re-evaluated as if they were an ordinary user, so workspace membership
 * (sales, orders, support) survives untouched — a demoted admin is a manager
 * with less power, not a person locked out of the sales floor. Per-user grants
 * are decided earlier and are not affected at all.
 */
function deniedByDemotion(user, node) {
  if (!wasDemoted(user)) return false;
  return !roleBaseline({ ...user, role: 'user' }, node.baseline);
}

function levelDefault(node, level) {
  if (level === ACCESS_LEVELS.SUPER_ADMIN) return true;
  const value = node.tiers?.[level];
  // No explicit tier value: managers get the benefit of the doubt, reps don't.
  // Every node the app actually gates on states its tiers, so this only ever
  // applies to a permission added to the catalog without them.
  return typeof value === 'boolean'
    ? value
    : level === ACCESS_LEVELS.CHIEF_MANAGER;
}

/**
 * Resolve one permission, ignoring ancestors. Returns { allowed, source }.
 * Exported for the UI, which shows the reason beside each toggle; app code
 * should call can() so ancestor blocking is applied.
 */
export function resolveOwn(user, key, options = {}) {
  const node = getPermission(key);
  if (!node) return { allowed: false, source: SOURCE.UNKNOWN };
  if (!user) return { allowed: false, source: SOURCE.UNKNOWN };
  if (isSuperAdmin(user, options)) return { allowed: true, source: SOURCE.SUPER_ADMIN };

  const level = options.level || getAccessLevel(user);
  const matrix = options.matrix || cachedMatrix;
  const overrides = options.overrides || user.permission_overrides;

  const override = overrides?.[key];
  if (typeof override === 'boolean') {
    return { allowed: override, source: SOURCE.USER_OVERRIDE };
  }

  if (personalBaseline(user, node.baseline)) {
    return { allowed: true, source: SOURCE.USER_GRANT };
  }

  const fromMatrix = matrix?.[level]?.[key];
  if (typeof fromMatrix === 'boolean') {
    return { allowed: fromMatrix, source: SOURCE.ROLE_MATRIX };
  }

  const demoted = deniedByDemotion(user, node);
  if (roleBaseline(user, node.baseline) && !demoted) {
    return { allowed: true, source: SOURCE.LEGACY_ROLE };
  }

  // A tier default may not carry a user across a workspace boundary their
  // role draws. Every non-admin infers to the נציג tier, so without this a
  // factory user would pick up the sales rep's defaults — leads, customers,
  // quotes — none of which they can reach today. Crossing that line is still
  // a `role` / `department` change, and an explicit grant (the two branches
  // above, or the matrix) can still open a single capability deliberately.
  if (isWorkspaceBaseline(node.baseline)) {
    return { allowed: false, source: SOURCE.LEGACY_ROLE };
  }

  const allowed = levelDefault(node, level);
  // A denial that follows from a demotion is not a default — somebody chose
  // the lower level. Naming it separately is what lets isExplicitlyBlocked()
  // treat it as deliberate, so the sidebar hides the entry AND the route
  // guard refuses the page, instead of the two disagreeing.
  if (!allowed && demoted) {
    return { allowed: false, source: SOURCE.ACCESS_LEVEL };
  }
  return { allowed, source: SOURCE.LEVEL_DEFAULT };
}

/**
 * The gate. True when `user` may do `key`, with every ancestor honoured.
 *
 * `options` is only for the permissions screen, which previews a level or a
 * draft matrix that is not the signed-in user's. App code passes nothing.
 */
export function can(user, key, options = {}) {
  if (!user) return false;
  if (isSuperAdmin(user, options)) return true;
  if (!permissionExists(key)) return false;

  for (const ancestorKey of getAncestorKeys(key)) {
    if (!resolveOwn(user, ancestorKey, options).allowed) return false;
  }
  return resolveOwn(user, key, options).allowed;
}

/** Same as can(), plus why — used by the permissions UI. */
export function explain(user, key, options = {}) {
  if (!user) return { allowed: false, source: SOURCE.UNKNOWN, blockedBy: null };
  if (isSuperAdmin(user, options)) return { allowed: true, source: SOURCE.SUPER_ADMIN, blockedBy: null };

  for (const ancestorKey of getAncestorKeys(key)) {
    if (!resolveOwn(user, ancestorKey, options).allowed) {
      return { allowed: false, source: SOURCE.ANCESTOR, blockedBy: ancestorKey };
    }
  }
  return { ...resolveOwn(user, key, options), blockedBy: null };
}

/** can() for any of the keys — a screen reachable through several capabilities. */
export function canAny(user, keys = [], options = {}) {
  return keys.some((key) => can(user, key, options));
}

/**
 * True only when somebody *decided* to block this — a per-user override or the
 * role matrix, on the permission itself or on an ancestor. A baseline or a
 * level default saying "no" is not a block.
 *
 * This is the gate for surfaces that already work today and must keep working:
 * the sidebar is the main one. `can()` would hide a nav entry the moment its
 * baseline disagrees with how the sidebar is currently built, and the two were
 * never required to agree — the sidebar is a hand-maintained list per role.
 * Asking "was this deliberately turned off?" instead means the nav behaves
 * identically until an admin actually turns something off, which is the whole
 * promise of this feature.
 */
export function isExplicitlyBlocked(user, key, options = {}) {
  if (!user) return false;
  if (isSuperAdmin(user, options)) return false;
  if (!permissionExists(key)) return false;

  // A demotion counts: somebody chose to move this person down a level, which
  // is every bit as deliberate as flipping a switch in the matrix.
  const decisive = [SOURCE.USER_OVERRIDE, SOURCE.ROLE_MATRIX, SOURCE.ACCESS_LEVEL];
  for (const candidate of [...getAncestorKeys(key).reverse(), key]) {
    const { allowed, source } = resolveOwn(user, candidate, options);
    if (!allowed && decisive.includes(source)) return true;
  }
  return false;
}

/**
 * What a hypothetical user at `level` gets, with no per-user anything. Drives
 * the role-matrix editor, where the question is about the level and not about
 * a person.
 */
export function resolveForLevel(level, key, matrix = cachedMatrix) {
  const node = getPermission(key);
  if (!node) return { allowed: false, source: SOURCE.UNKNOWN };
  if (level === ACCESS_LEVELS.SUPER_ADMIN) return { allowed: true, source: SOURCE.SUPER_ADMIN };

  for (const ancestorKey of getAncestorKeys(key)) {
    const ancestor = getPermission(ancestorKey);
    const parentMatrix = matrix?.[level]?.[ancestorKey];
    const parentAllowed = typeof parentMatrix === 'boolean'
      ? parentMatrix
      : levelDefault(ancestor, level);
    if (!parentAllowed) return { allowed: false, source: SOURCE.ANCESTOR, blockedBy: ancestorKey };
  }

  const fromMatrix = matrix?.[level]?.[key];
  if (typeof fromMatrix === 'boolean') return { allowed: fromMatrix, source: SOURCE.ROLE_MATRIX };
  return { allowed: levelDefault(node, level), source: SOURCE.LEVEL_DEFAULT };
}

// ── Who may edit the permission system itself ──────────────────────────────

/**
 * Editing the permission matrix is super-admin-only: whoever can edit
 * permissions can grant themselves every other permission, so the two are the
 * same power.
 *
 * `superAdminExists` is the bootstrap escape hatch, and the only thing about
 * the confidential set a non-member is ever told. Until somebody is appointed
 * — a migration that has not run, a fresh environment, a seed that matched
 * nobody — the system would have no one who can open the screen at all. While
 * the set is empty any legacy admin may manage permissions, and the screen
 * says so out loud. Once it is not empty, an ordinary admin learns nothing:
 * the card simply is not there.
 */
export function canManagePermissions(user, options = {}) {
  const { superAdminExists = true } = options;
  if (!user) return false;
  if (isSuperAdmin(user, options)) return true;
  if (!superAdminExists && user.role === 'admin') return true;
  return can(user, 'settings.permissions.roles', options);
}

/** Editing another user's per-user overrides and access level. */
export function canManageUserPermissions(user, options = {}) {
  const { superAdminExists = true } = options;
  if (!user) return false;
  if (isSuperAdmin(user, options)) return true;
  if (!superAdminExists && user.role === 'admin') return true;
  return can(user, 'team.permissions', options);
}

/**
 * Nobody may hand out a level at or above their own — that is how a chief
 * manager would mint themselves a peer.
 *
 * סופר אדמין is never grantable here at all, for anyone. It is not a value of
 * the tier column; appointing one is an insert into `public.super_admins`,
 * gated by that table's own policy. Keeping it out of the level picker means
 * the picker cannot leak the concept to somebody who should not know it
 * exists.
 */
export function canGrantAccessLevel(actor, level, options = {}) {
  if (!actor || !isStorableAccessLevel(level)) return false;
  if (isSuperAdmin(actor, options)) return true;
  if (!can(actor, 'team.access_level', options)) return false;
  return accessLevelRank(level) < accessLevelRank(getAccessLevel(actor));
}

/**
 * An actor may only grant what they themselves hold. Without this a chief
 * manager could open כספים for a rep and then impersonate them, or simply
 * grant a capability they were deliberately denied.
 */
export function canDelegatePermission(actor, key, options = {}) {
  if (!actor) return false;
  if (isSuperAdmin(actor, options)) return true;
  return can(actor, key, options);
}
