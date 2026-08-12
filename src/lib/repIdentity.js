import { ICON_OPTIONS, getIconById } from '@/components/shared/ProfileAvatarPicker';

// ─── One rep, one identity ──────────────────────────────────────
// Every rep is shown with a colour and an icon that no other rep has, so a
// manager scanning a list recognises who owns each row before reading the name.
//
// Colour and icon are INDEPENDENT choices, each with its own catalogue: an
// admin picks 🦊 for one rep and mint green for another without the two
// decisions dragging each other around. Uniqueness is enforced per dimension —
// no two reps share a colour, no two share an icon.
//
// The assignment is computed from the whole roster rather than stored per user,
// because uniqueness is a property of the team and one row can't enforce it.
// What IS stored is the override: `avatar_color` and `profile_icon`.

// Pastel only. The palette used to carry a second, saturated tier to stretch
// further; it read as heavy next to the rest of the UI, and the point of these
// marks is to be legible at 24px without shouting. 18 hues, ordered so
// consecutive reps look as different as possible rather than walking the colour
// wheel. Literal class strings because Tailwind scans source text — a composed
// `bg-${hue}-100` would never be generated.
export const REP_COLORS = [
  { id: 'blue',    label: 'תכלת',   chip: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-200' },
  { id: 'rose',    label: 'ורוד',   chip: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-200' },
  { id: 'emerald', label: 'מנטה',   chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-200' },
  { id: 'amber',   label: 'חמרה',   chip: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-200' },
  { id: 'violet',  label: 'סגול',   chip: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-200' },
  { id: 'cyan',    label: 'טורקיז', chip: 'bg-cyan-100 text-cyan-700',       dot: 'bg-cyan-200' },
  { id: 'orange',  label: 'כתום',   chip: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-200' },
  { id: 'teal',    label: 'ירוק־ים', chip: 'bg-teal-100 text-teal-700',      dot: 'bg-teal-200' },
  { id: 'fuchsia', label: 'פוקסיה', chip: 'bg-fuchsia-100 text-fuchsia-700', dot: 'bg-fuchsia-200' },
  { id: 'lime',    label: 'ליים',   chip: 'bg-lime-100 text-lime-700',       dot: 'bg-lime-200' },
  { id: 'indigo',  label: 'אינדיגו', chip: 'bg-indigo-100 text-indigo-700',  dot: 'bg-indigo-200' },
  { id: 'red',     label: 'אדום',   chip: 'bg-red-100 text-red-700',         dot: 'bg-red-200' },
  { id: 'sky',     label: 'שמיים',  chip: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-200' },
  { id: 'pink',    label: 'רוז',    chip: 'bg-pink-100 text-pink-700',       dot: 'bg-pink-200' },
  { id: 'green',   label: 'ירוק',   chip: 'bg-green-100 text-green-700',     dot: 'bg-green-200' },
  { id: 'yellow',  label: 'צהוב',   chip: 'bg-yellow-100 text-yellow-700',   dot: 'bg-yellow-200' },
  { id: 'purple',  label: 'סגלגל', chip: 'bg-purple-100 text-purple-700',    dot: 'bg-purple-200' },
  { id: 'stone',   label: 'אפור',   chip: 'bg-stone-200 text-stone-700',     dot: 'bg-stone-300' },
];

// The icon catalogue is the one the app already has — the same 40 the profile
// picker in Settings offers — so an icon chosen there and an icon assigned here
// speak the same vocabulary and are stored in the same column.
export const REP_ICONS = ICON_OPTIONS.map((icon) => ({ id: icon.id, emoji: icon.emoji }));

const norm = (value) => String(value || '').trim().toLowerCase();

// When did this rep join? Assignment walks the roster in join order, so a new
// rep lands after everyone else and takes a slot nobody is using. Falls back to
// email so the order stays deterministic on an environment whose users table
// carries no timestamp.
function joinedAt(user) {
  return user?.created_date || user?.created_at || '';
}

function rosterOrder(a, b) {
  const ja = joinedAt(a);
  const jb = joinedAt(b);
  if (ja && jb && ja !== jb) return ja < jb ? -1 : 1;
  if (ja && !jb) return -1;
  if (!ja && jb) return 1;
  return norm(a?.email || a?.id).localeCompare(norm(b?.email || b?.id));
}

/**
 * Hand out one entry of `catalogue` per roster member, nobody sharing.
 *
 * The order of the phases is what keeps existing reps still. Giving each
 * unpinned rep "the next free entry" in a single pass looks equivalent and is
 * not: pinning one rep removes an entry from the middle of the free list and
 * every rep after it shifts up by one — pick a colour for one person and half
 * the team changes colour. So instead each rep has a NATURAL entry (their
 * position in the roster), claims it when it is free, and only the few who
 * can't are placed afterwards. Pinning something nobody is using then moves
 * nobody at all, which is what picking from a list of free choices should do.
 *
 * @param {Array} roster        users, already in join order
 * @param {Array} catalogue     entries with an `id`
 * @param {Function} pinOf      user → chosen entry id, or falsy for automatic
 * @returns {Map<number, number>} roster index → catalogue index
 */
function assignCatalogue(roster, catalogue, pinOf) {
  const taken = new Set();
  const out = new Map();

  // 1. Explicit choices. A contested entry goes to whoever joined first; the
  //    other falls through to the automatic passes below.
  roster.forEach((user, i) => {
    const id = pinOf(user);
    if (!id) return;
    const at = catalogue.findIndex((entry) => entry.id === id);
    if (at < 0 || taken.has(at)) return;
    taken.add(at);
    out.set(i, at);
  });

  // 2. Everyone else claims their natural entry, if it is still free.
  const displaced = [];
  roster.forEach((user, i) => {
    if (out.has(i)) return;
    const natural = i % catalogue.length;
    if (taken.has(natural)) { displaced.push(i); return; }
    taken.add(natural);
    out.set(i, natural);
  });

  // 3. The few whose natural entry was claimed take what is left.
  const free = catalogue.map((_, at) => at).filter((at) => !taken.has(at));
  displaced.forEach((i, k) => {
    out.set(i, free.length ? free[k % free.length] : i % catalogue.length);
  });

  return out;
}

// A stand-in for anyone the roster doesn't cover — a deleted user, or an avatar
// rendered from a name alone before the roster loads. Hashed, so it is stable
// but NOT guaranteed unique; the roster is what makes the guarantee and this
// only fills the gap while it is missing.
export function fallbackIdentity(user) {
  const key = norm(user?.email || user?.full_name || user?.id);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const h = Math.abs(hash);
  const color = REP_COLORS[h % REP_COLORS.length];
  const icon = REP_ICONS[h % REP_ICONS.length];
  return { ...color, colorId: color.id, iconId: icon.id, emoji: icon.emoji };
}

/** The colour a rep is pinned to, or null. Unknown ids fall back to automatic. */
function colorPin(user) {
  const id = norm(user?.avatar_color);
  return id && REP_COLORS.some((c) => c.id === id) ? id : null;
}

/** The icon a rep is pinned to, or null. Shared with the Settings picker. */
function iconPin(user) {
  const id = String(user?.profile_icon || '').trim();
  return id && getIconById(id) ? id : null;
}

/**
 * Assign every user in the roster a colour and an icon nobody else has.
 *
 * @returns {{ byEmail: Map, byName: Map, identityFor: (user) => object }}
 */
export function buildRepIdentities(users = []) {
  const roster = (Array.isArray(users) ? users : []).filter(Boolean).slice().sort(rosterOrder);

  const colors = assignCatalogue(roster, REP_COLORS, colorPin);
  const icons = assignCatalogue(roster, REP_ICONS, iconPin);

  const byEmail = new Map();
  const byName = new Map();
  roster.forEach((user, i) => {
    const color = REP_COLORS[colors.get(i)];
    const icon = REP_ICONS[icons.get(i)];
    const identity = { ...color, colorId: color.id, iconId: icon.id, emoji: icon.emoji };
    if (user.email) byEmail.set(norm(user.email), identity);
    // Name is the fallback key: a couple of dashboards render an avatar from
    // aggregate rows that carry a rep's name but not their email.
    if (user.full_name && !byName.has(norm(user.full_name))) byName.set(norm(user.full_name), identity);
  });

  // The roster map first, ALWAYS — it is the only view that knows what everyone
  // else got. Reading a row's own choice here instead would hand two rows that
  // picked the same colour the same colour, which is the one thing this file
  // exists to prevent; the map has already resolved that contest.
  const identityFor = (user) => {
    if (!user) return fallbackIdentity(user);
    return byEmail.get(norm(user.email))
      || byName.get(norm(user.full_name))
      || fallbackIdentity(user);
  };

  return { byEmail, byName, identityFor };
}

/**
 * Who currently holds each colour and each icon, so a picker can grey out what
 * is taken and say whose it is. Covers pinned and automatically-assigned alike:
 * offering someone a mark another rep is already wearing is exactly how the
 * uniqueness gets broken.
 *
 * @returns {{ colors: Map<string, object>, icons: Map<string, object> }}
 *          catalogue id → { email, full_name, pinned }
 */
export function identityOwners(users = []) {
  const roster = (Array.isArray(users) ? users : []).filter(Boolean);
  const { byEmail, byName } = buildRepIdentities(roster);
  const colors = new Map();
  const icons = new Map();
  roster.forEach((user) => {
    const identity = byEmail.get(norm(user.email)) || byName.get(norm(user.full_name));
    if (!identity) return;
    const who = { email: user.email, full_name: user.full_name || user.email };
    if (!colors.has(identity.colorId)) colors.set(identity.colorId, { ...who, pinned: colorPin(user) !== null });
    if (!icons.has(identity.iconId)) icons.set(identity.iconId, { ...who, pinned: iconPin(user) !== null });
  });
  return { colors, icons };
}

/** Build a preview identity from a pending pick, for a picker that hasn't saved yet. */
export function identityFromChoice({ colorId, iconId }, base) {
  const color = REP_COLORS.find((c) => c.id === colorId) || base;
  const icon = REP_ICONS.find((i) => i.id === iconId);
  return {
    ...color,
    colorId: color?.id,
    iconId: icon?.id ?? base?.iconId,
    emoji: icon?.emoji ?? base?.emoji,
  };
}
