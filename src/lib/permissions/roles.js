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
 *
 * ── Super admin is not in the column ────────────────────────────────────────
 *
 * Only the three ordinary levels are ever stored in `users.access_level`.
 * Super admin is confidential — who holds it is not something the rest of the
 * company may find out — and `users` cannot keep a secret: its SELECT policy
 * is `USING (true)` and the client fetches `select('*')`, so anything in that
 * row is readable by every signed-in user regardless of what the UI renders.
 *
 * Membership therefore lives in `public.super_admins`, whose own RLS answers
 * "only if you are already a member". Nothing in this module can tell you
 * whether somebody is a super admin, on purpose — ask ./resolve, which knows
 * the answer for the signed-in user alone.
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

/** Only these three are ever stored in `users.access_level`. */
export function isStorableAccessLevel(value) {
  return EDITABLE_ACCESS_LEVELS.includes(value);
}

/**
 * The VISIBLE level of a user — the one anybody may read off their row.
 *
 * Derived from the legacy `role` when `access_level` was never set, so that
 * nothing changes on the day this ships: `admin` maps to מנהל ראשי, everyone
 * else to נציג.
 *
 * This never returns סופר אדמין, even for a super admin, and that is not an
 * oversight. A super admin's row says מנהל ראשי like any other admin's,
 * because the row is world-readable. Use isSuperAdmin() from ./resolve for the
 * signed-in user; there is no way to ask it about anybody else, which is the
 * whole point.
 */
export function inferAccessLevel(user) {
  if (!user) return ACCESS_LEVELS.REP;
  if (isStorableAccessLevel(user.access_level)) return user.access_level;
  if (user.role === 'admin') return ACCESS_LEVELS.CHIEF_MANAGER;
  return ACCESS_LEVELS.REP;
}

export function getAccessLevel(user) {
  return inferAccessLevel(user);
}

export function accessLevelLabel(level) {
  return ACCESS_LEVEL_META[level]?.label || level || '';
}
