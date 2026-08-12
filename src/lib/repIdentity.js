import { getIconById } from '@/components/shared/ProfileAvatarPicker';

// ─── One rep, one identity ──────────────────────────────────────
// Every rep gets a colour and an icon that no other rep has, so a manager
// scanning a list of leads recognises who owns each one before reading the
// name. The old avatar picked its colour from `full_name.charCodeAt(0) % 5`,
// which meant two reps whose names start with the same letter were ALWAYS the
// same colour — and with only five colours on a ten-person floor, collisions
// were the rule rather than the exception.
//
// Identity is assigned here, from the roster, rather than stored per user:
// uniqueness is a property of the whole team, and a per-user column can't
// enforce it (two reps picking 🦊 in Settings would both keep it).

// 18 hues, ordered so that consecutive reps look as different as possible
// rather than walking the colour wheel (blue → rose → emerald, not
// blue → indigo → violet). Each hue carries two tones: tone A for the first 18
// reps, tone B for reps 19-36, so a 20-person floor still has no repeats.
// Written out as literal class strings because Tailwind scans source text —
// a composed `bg-${hue}-100` would never be generated.
const HUES = [
  { id: 'blue',    a: { chip: 'bg-blue-100 text-blue-700',       solid: 'bg-blue-500 text-white',    dot: 'bg-blue-500' },    b: { chip: 'bg-blue-500 text-white',    solid: 'bg-blue-700 text-white',    dot: 'bg-blue-700' } },
  { id: 'rose',    a: { chip: 'bg-rose-100 text-rose-700',       solid: 'bg-rose-500 text-white',    dot: 'bg-rose-500' },    b: { chip: 'bg-rose-500 text-white',    solid: 'bg-rose-700 text-white',    dot: 'bg-rose-700' } },
  { id: 'emerald', a: { chip: 'bg-emerald-100 text-emerald-700', solid: 'bg-emerald-500 text-white', dot: 'bg-emerald-500' }, b: { chip: 'bg-emerald-500 text-white', solid: 'bg-emerald-700 text-white', dot: 'bg-emerald-700' } },
  { id: 'amber',   a: { chip: 'bg-amber-100 text-amber-700',     solid: 'bg-amber-500 text-white',   dot: 'bg-amber-500' },   b: { chip: 'bg-amber-500 text-white',   solid: 'bg-amber-700 text-white',   dot: 'bg-amber-700' } },
  { id: 'violet',  a: { chip: 'bg-violet-100 text-violet-700',   solid: 'bg-violet-500 text-white',  dot: 'bg-violet-500' },  b: { chip: 'bg-violet-500 text-white',  solid: 'bg-violet-700 text-white',  dot: 'bg-violet-700' } },
  { id: 'cyan',    a: { chip: 'bg-cyan-100 text-cyan-700',       solid: 'bg-cyan-500 text-white',    dot: 'bg-cyan-500' },    b: { chip: 'bg-cyan-500 text-white',    solid: 'bg-cyan-700 text-white',    dot: 'bg-cyan-700' } },
  { id: 'orange',  a: { chip: 'bg-orange-100 text-orange-700',   solid: 'bg-orange-500 text-white',  dot: 'bg-orange-500' },  b: { chip: 'bg-orange-500 text-white',  solid: 'bg-orange-700 text-white',  dot: 'bg-orange-700' } },
  { id: 'teal',    a: { chip: 'bg-teal-100 text-teal-700',       solid: 'bg-teal-500 text-white',    dot: 'bg-teal-500' },    b: { chip: 'bg-teal-500 text-white',    solid: 'bg-teal-700 text-white',    dot: 'bg-teal-700' } },
  { id: 'fuchsia', a: { chip: 'bg-fuchsia-100 text-fuchsia-700', solid: 'bg-fuchsia-500 text-white', dot: 'bg-fuchsia-500' }, b: { chip: 'bg-fuchsia-500 text-white', solid: 'bg-fuchsia-700 text-white', dot: 'bg-fuchsia-700' } },
  { id: 'lime',    a: { chip: 'bg-lime-100 text-lime-700',       solid: 'bg-lime-500 text-white',    dot: 'bg-lime-500' },    b: { chip: 'bg-lime-500 text-white',    solid: 'bg-lime-700 text-white',    dot: 'bg-lime-700' } },
  { id: 'indigo',  a: { chip: 'bg-indigo-100 text-indigo-700',   solid: 'bg-indigo-500 text-white',  dot: 'bg-indigo-500' },  b: { chip: 'bg-indigo-500 text-white',  solid: 'bg-indigo-700 text-white',  dot: 'bg-indigo-700' } },
  { id: 'red',     a: { chip: 'bg-red-100 text-red-700',         solid: 'bg-red-500 text-white',     dot: 'bg-red-500' },     b: { chip: 'bg-red-500 text-white',     solid: 'bg-red-700 text-white',     dot: 'bg-red-700' } },
  { id: 'sky',     a: { chip: 'bg-sky-100 text-sky-700',         solid: 'bg-sky-500 text-white',     dot: 'bg-sky-500' },     b: { chip: 'bg-sky-500 text-white',     solid: 'bg-sky-700 text-white',     dot: 'bg-sky-700' } },
  { id: 'pink',    a: { chip: 'bg-pink-100 text-pink-700',       solid: 'bg-pink-500 text-white',    dot: 'bg-pink-500' },    b: { chip: 'bg-pink-500 text-white',    solid: 'bg-pink-700 text-white',    dot: 'bg-pink-700' } },
  { id: 'green',   a: { chip: 'bg-green-100 text-green-700',     solid: 'bg-green-500 text-white',   dot: 'bg-green-500' },   b: { chip: 'bg-green-500 text-white',   solid: 'bg-green-700 text-white',   dot: 'bg-green-700' } },
  { id: 'yellow',  a: { chip: 'bg-yellow-100 text-yellow-700',   solid: 'bg-yellow-500 text-white',  dot: 'bg-yellow-500' },  b: { chip: 'bg-yellow-500 text-white',  solid: 'bg-yellow-700 text-white',  dot: 'bg-yellow-700' } },
  { id: 'purple',  a: { chip: 'bg-purple-100 text-purple-700',   solid: 'bg-purple-500 text-white',  dot: 'bg-purple-500' },  b: { chip: 'bg-purple-500 text-white',  solid: 'bg-purple-700 text-white',  dot: 'bg-purple-700' } },
  { id: 'slate',   a: { chip: 'bg-slate-200 text-slate-700',     solid: 'bg-slate-500 text-white',   dot: 'bg-slate-500' },   b: { chip: 'bg-slate-500 text-white',   solid: 'bg-slate-700 text-white',   dot: 'bg-slate-700' } },
];

// 36 distinct icons, drawn from the same set the profile picker offers so a
// rep who later picks their own icon from Settings stays in the same family.
// Index i pairs with HUES[i % 18], tone A for the first 18 and B after.
const EMOJIS = [
  '🐧', '🦊', '🌳', '🦁', '🦋', '🐬', '🐯', '🐢', '🌸',
  '🐝', '🚀', '🔥', '🐳', '🐰', '🌍', '⭐', '🌈', '🐺',
  '🐻', '🐱', '🐶', '🐼', '🦉', '🦅', '🐙', '🐵', '💎',
  '👑', '⚡', '❤️', '☀️', '🌙', '⛰️', '🌊', '❄️', '🎵',
];

// The full palette: 36 slots, every one a different colour AND a different
// icon. Beyond 36 reps the slots wrap and repeats begin — add hues here if the
// floor ever grows that far.
export const REP_PALETTE = EMOJIS.map((emoji, i) => {
  const hue = HUES[i % HUES.length];
  const tone = i < HUES.length ? hue.a : hue.b;
  return { slot: i, id: `${hue.id}-${i < HUES.length ? 'a' : 'b'}`, emoji, ...tone };
});

const norm = (value) => String(value || '').trim().toLowerCase();

// When did this rep join? Assignment walks the roster in join order, so a new
// rep is appended to the end and takes the next free slot — nobody who already
// has a colour ever loses it. Falls back to email so the order stays
// deterministic on an environment whose users table carries no timestamp.
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

// A stand-in for anyone the roster doesn't cover — a user who was deleted, or
// an avatar rendered from a name alone before the roster loads. Hashed rather
// than assigned, so it is stable but NOT guaranteed unique; the roster is what
// makes the guarantee, and this only fills the gap while it is missing.
export function fallbackIdentity(user) {
  const key = norm(user?.email || user?.full_name || user?.id);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return REP_PALETTE[Math.abs(hash) % REP_PALETTE.length];
}

// A rep pinned to a palette slot by an admin (users.avatar_slot). Anything
// outside the palette is treated as unpinned rather than clamped — a stale
// number from a larger palette should fall back to "assign me one" instead of
// silently pointing at whoever now sits at that index.
function pinnedSlot(user) {
  const raw = user?.avatar_slot;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < REP_PALETTE.length ? n : null;
}

/**
 * Assign every user in the roster a colour + icon nobody else has.
 *
 * Three passes, because two kinds of explicit choice have to survive:
 *   1. Pinned slots (an admin picked this rep's identity in the rep dialog).
 *      A pin takes the whole slot — colour and icon — and the rest of the
 *      assignment works around it. Two rows pinned to the same slot can only
 *      happen if the unique index was bypassed; first in join order keeps it.
 *   2. Icons reps chose for themselves in Settings, for anyone not pinned.
 *      First in join order wins a contested icon.
 *   3. Everyone left takes the next FREE slot in join order. The colour always
 *      comes from the slot, which is what makes two reps sharing one
 *      impossible; the icon comes from the slot too unless it was claimed
 *      above, in which case the next unclaimed icon fills in.
 *
 * @returns {{ byEmail: Map, byName: Map, identityFor: (user) => object }}
 */
export function buildRepIdentities(users = []) {
  const roster = (Array.isArray(users) ? users : []).filter(Boolean).slice().sort(rosterOrder);

  // ── 1. Pins ──
  const takenSlots = new Set();
  const pinByIndex = new Map();
  roster.forEach((user, index) => {
    const slot = pinnedSlot(user);
    if (slot === null || takenSlots.has(slot)) return;
    takenSlots.add(slot);
    pinByIndex.set(index, slot);
  });

  const claimedIcons = new Set([...takenSlots].map((slot) => REP_PALETTE[slot].emoji));

  // ── 2. Self-picked icons, for the unpinned ──
  const handPicked = new Map();
  roster.forEach((user, index) => {
    if (pinByIndex.has(index)) return;
    const icon = user?.profile_icon ? getIconById(user.profile_icon) : null;
    if (!icon || claimedIcons.has(icon.emoji)) return;
    claimedIcons.add(icon.emoji);
    handPicked.set(index, icon.emoji);
  });

  // ── 3. The rest, from the free slots ──
  const freeSlots = REP_PALETTE.map((_, i) => i).filter((i) => !takenSlots.has(i));
  let slotCursor = 0;
  const nextFreeSlot = () => {
    const slot = freeSlots.length ? freeSlots[slotCursor % freeSlots.length] : 0;
    slotCursor += 1;
    return slot;
  };
  const spareIcons = REP_PALETTE.map((entry) => entry.emoji).filter((emoji) => !claimedIcons.has(emoji));
  let iconCursor = 0;
  const nextSpareIcon = () => {
    const emoji = spareIcons.length ? spareIcons[iconCursor % spareIcons.length] : REP_PALETTE[0].emoji;
    iconCursor += 1;
    return emoji;
  };

  const byEmail = new Map();
  const byName = new Map();
  roster.forEach((user, index) => {
    const pin = pinByIndex.get(index);
    const slot = REP_PALETTE[pin ?? nextFreeSlot()];
    let emoji = pin != null ? slot.emoji : handPicked.get(index);
    if (!emoji) {
      emoji = claimedIcons.has(slot.emoji) ? nextSpareIcon() : slot.emoji;
      claimedIcons.add(emoji);
    }
    const identity = { ...slot, emoji };
    if (user.email) byEmail.set(norm(user.email), identity);
    // Name is the fallback key: a couple of dashboards render an avatar from
    // aggregate rows that carry a rep's name but not their email.
    if (user.full_name && !byName.has(norm(user.full_name))) byName.set(norm(user.full_name), identity);
  });

  // The roster map first, ALWAYS — it is the only view that knows what everyone
  // else got. Reading a row's own pin here instead would hand two rows pinned to
  // the same slot the same identity, which is the one thing this file exists to
  // prevent; the map has already resolved that contest. The raw pin is only a
  // fallback for someone the roster doesn't cover.
  const identityFor = (user) => {
    if (!user) return REP_PALETTE[0];
    const known = byEmail.get(norm(user.email)) || byName.get(norm(user.full_name));
    if (known) return known;
    const pin = pinnedSlot(user);
    return pin !== null ? REP_PALETTE[pin] : fallbackIdentity(user);
  };

  return { byEmail, byName, identityFor };
}

/**
 * Which palette slot each rep currently occupies, so the picker can grey out
 * the ones already taken and say who has them. Pinned or auto-assigned alike —
 * the point is that nobody is offered a face someone else is wearing.
 *
 * @returns {Map<number, { email: string, full_name: string, pinned: boolean }>}
 */
export function slotOwners(users = []) {
  const roster = (Array.isArray(users) ? users : []).filter(Boolean);
  const { byEmail } = buildRepIdentities(roster);
  const bySlotId = new Map(REP_PALETTE.map((entry, i) => [entry.id, i]));
  const owners = new Map();
  roster.forEach((user) => {
    const identity = user.email ? byEmail.get(norm(user.email)) : null;
    const slot = identity ? bySlotId.get(identity.id) : null;
    if (slot == null || owners.has(slot)) return;
    owners.set(slot, {
      email: user.email,
      full_name: user.full_name || user.email,
      pinned: pinnedSlot(user) !== null,
    });
  });
  return owners;
}
