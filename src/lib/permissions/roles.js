/**
 * The four access levels (רמות הרשאה) that sit on top of the existing
 * `users.role` column.
 *
 *   נציג  <  מנהל חנות  <  מנהל ראשי  <  סופר אדמין
 *
 * Why a new column instead of reusing `users.role`: `role` is load-bearing.
 * It drives the sidebar (Layout.navigationByRole), every canAccess* gate in
 * lib/rbac.js, three RLS policies and the privilege-escalation trigger. Adding
 * two values to it would have re-pointed all of that at once. `access_level`
 * is a second, *additive* axis: it only ever widens what `role` already
 * allows, so switching a rep from "נציג" to "מנהל חנות" grants them the store
 * manager's extras and takes nothing away.
 *
 * Users with no `access_level` (i.e. everyone, the moment this ships) are
 * mapped from their legacy `role` by inferAccessLevel(). That mapping is what
 * makes the rollout invisible: an admin is a מנהל ראשי, everyone else is a
 * נציג, and both keep exactly the access they had yesterday.
 */

export const ACCESS_LEVELS = {
  REP: 'rep',
  STORE_MANAGER: 'store_manager',
  CHIEF_MANAGER: 'chief_manager',
  SUPER_ADMIN: 'super_admin',
};

/** Low → high. Used for the "can't grant above your own level" guard. */
export const ACCESS_LEVEL_ORDER = [
  ACCESS_LEVELS.REP,
  ACCESS_LEVELS.STORE_MANAGER,
  ACCESS_LEVELS.CHIEF_MANAGER,
  ACCESS_LEVELS.SUPER_ADMIN,
];

/** The levels an admin edits in the הרשאות area. Super admin is not editable. */
export const EDITABLE_ACCESS_LEVELS = [
  ACCESS_LEVELS.REP,
  ACCESS_LEVELS.STORE_MANAGER,
  ACCESS_LEVELS.CHIEF_MANAGER,
];

export const ACCESS_LEVEL_META = {
  [ACCESS_LEVELS.REP]: {
    key: ACCESS_LEVELS.REP,
    label: 'נציג',
    short: 'נציג',
    icon: 'person',
    description: 'עובד שטח — הלידים, ההצעות וההזמנות שלו. אין גישה לניהול, לכספים או להגדרות המערכת.',
  },
  [ACCESS_LEVELS.STORE_MANAGER]: {
    key: ACCESS_LEVELS.STORE_MANAGER,
    label: 'מנהל חנות',
    short: 'מנהל חנות',
    icon: 'storefront',
    description: 'מנהל את הצוות והפעילות היומיומית של הסניף: רואה את כל הלידים, משבץ משמרות ומנהל שירות. ללא כספים ברמת חברה וללא הגדרות מערכת.',
  },
  [ACCESS_LEVELS.CHIEF_MANAGER]: {
    key: ACCESS_LEVELS.CHIEF_MANAGER,
    label: 'מנהל ראשי',
    short: 'מנהל ראשי',
    icon: 'manage_accounts',
    description: 'ניהול חוצה-ארגון: כספים, שיווק, נציגים ורוב ההגדרות. הרמה הגבוהה ביותר שאפשר להעניק מתוך המסך הזה.',
  },
  [ACCESS_LEVELS.SUPER_ADMIN]: {
    key: ACCESS_LEVELS.SUPER_ADMIN,
    label: 'סופר אדמין',
    short: 'סופר אדמין',
    icon: 'shield_person',
    description: 'גישה מלאה לכל דבר, כולל עריכת מערכת ההרשאות עצמה ומינוי סופר אדמין נוסף. שמור לנתנאל ורגב.',
  },
};

export function isValidAccessLevel(value) {
  return ACCESS_LEVEL_ORDER.includes(value);
}

export function accessLevelRank(level) {
  const idx = ACCESS_LEVEL_ORDER.indexOf(level);
  return idx === -1 ? 0 : idx;
}

/**
 * The level a user has when `access_level` was never set — derived from the
 * legacy `role` so that nothing changes on the day this ships.
 *
 * `admin` maps to מנהל ראשי rather than סופר אדמין on purpose: the brief says
 * super admin is Netanel and Regev only. Nothing is taken from the other
 * admins by that mapping — every legacy-admin capability is granted by the
 * `role === 'admin'` baselines in ./baselines.js, which run regardless of
 * access level. The only thing reserved for super admin is editing the
 * permission system itself, which is new and which nobody could do before.
 */
export function inferAccessLevel(user) {
  if (!user) return ACCESS_LEVELS.REP;
  if (isValidAccessLevel(user.access_level)) return user.access_level;
  if (user.role === 'admin') return ACCESS_LEVELS.CHIEF_MANAGER;
  return ACCESS_LEVELS.REP;
}

export function getAccessLevel(user) {
  return inferAccessLevel(user);
}

export function isSuperAdmin(user) {
  return inferAccessLevel(user) === ACCESS_LEVELS.SUPER_ADMIN;
}

export function isAtLeast(user, level) {
  return accessLevelRank(inferAccessLevel(user)) >= accessLevelRank(level);
}

export function accessLevelLabel(level) {
  return ACCESS_LEVEL_META[level]?.label || level || '';
}

/**
 * Names/e-mail fragments that identify the two people the brief names as super
 * admins. Used only to seed the column (see the migration) and to explain the
 * bootstrap state in the UI — never as a live authorisation check, because an
 * authorisation rule keyed on a person's name is a rule nobody can audit.
 */
export const SEED_SUPER_ADMIN_HINTS = ['נתנאל', 'רגב', 'netanel', 'natanel', 'regev'];
