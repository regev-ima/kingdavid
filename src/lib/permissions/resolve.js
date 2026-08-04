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
  isSuperAdmin,
  accessLevelRank,
  isValidAccessLevel,
} from './roles';

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
  [SOURCE.LEGACY_ROLE]: 'לפי התפקיד הקיים במערכת',
  [SOURCE.LEVEL_DEFAULT]: 'ברירת המחדל של רמת ההרשאה',
  [SOURCE.UNKNOWN]: 'הרשאה לא מוכרת',
};

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
  if (isSuperAdmin(user)) return { allowed: true, source: SOURCE.SUPER_ADMIN };

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

  if (roleBaseline(user, node.baseline)) {
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

  return { allowed: levelDefault(node, level), source: SOURCE.LEVEL_DEFAULT };
}

/**
 * The gate. True when `user` may do `key`, with every ancestor honoured.
 *
 * `options` is only for the permissions screen, which previews a level or a
 * draft matrix that is not the signed-in user's. App code passes nothing.
 */
export function can(user, key, options = {}) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (!permissionExists(key)) return false;

  for (const ancestorKey of getAncestorKeys(key)) {
    if (!resolveOwn(user, ancestorKey, options).allowed) return false;
  }
  return resolveOwn(user, key, options).allowed;
}

/** Same as can(), plus why — used by the permissions UI. */
export function explain(user, key, options = {}) {
  if (!user) return { allowed: false, source: SOURCE.UNKNOWN, blockedBy: null };
  if (isSuperAdmin(user)) return { allowed: true, source: SOURCE.SUPER_ADMIN, blockedBy: null };

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
  if (isSuperAdmin(user)) return false;
  if (!permissionExists(key)) return false;

  const decisive = [SOURCE.USER_OVERRIDE, SOURCE.ROLE_MATRIX];
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
 * `superAdminExists` is the bootstrap escape hatch. Until somebody is actually
 * marked `access_level = 'super_admin'` — a migration that has not run, a
 * fresh environment, a seed that matched nobody — the system would otherwise
 * have no one who can open the screen at all. While no super admin exists, any
 * legacy admin may manage permissions, and the screen says so out loud.
 */
export function canManagePermissions(user, { superAdminExists = true } = {}) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (!superAdminExists && user.role === 'admin') return true;
  return can(user, 'settings.permissions.roles');
}

/** Editing another user's per-user overrides and access level. */
export function canManageUserPermissions(user, { superAdminExists = true } = {}) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (!superAdminExists && user.role === 'admin') return true;
  return can(user, 'team.permissions');
}

/**
 * Nobody may hand out a level at or above their own — that is how a chief
 * manager would mint themselves a peer, or a super admin. Super admins are the
 * exception; granting super admin is theirs alone.
 */
export function canGrantAccessLevel(actor, level) {
  if (!actor || !isValidAccessLevel(level)) return false;
  if (isSuperAdmin(actor)) return true;
  if (level === ACCESS_LEVELS.SUPER_ADMIN) return false;
  if (!can(actor, 'team.access_level')) return false;
  return accessLevelRank(level) < accessLevelRank(getAccessLevel(actor));
}

/**
 * An actor may only grant what they themselves hold. Without this a chief
 * manager could open כספים for a rep and then impersonate them, or simply
 * grant a capability they were deliberately denied.
 */
export function canDelegatePermission(actor, key) {
  if (!actor) return false;
  if (isSuperAdmin(actor)) return true;
  return can(actor, key);
}
