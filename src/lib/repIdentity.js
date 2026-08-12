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

/**
 * Assign every user in the roster a colour + icon nobody else has.
 *
 * Two passes, because a rep may have picked an icon for themselves in
 * Settings and an explicit choice should survive:
 *   1. Claim the icons reps chose by hand — first one in join order wins a
 *      contested icon, so the choice is honoured without breaking uniqueness.
 *   2. Hand out palette slots in join order. The colour always comes from the
 *      slot (which is why no two reps can share one); the icon comes from the
 *      slot too, unless this rep claimed one by hand or the slot's icon was
 *      claimed by someone else — then it takes the next unclaimed icon.
 *
 * @returns {{ byEmail: Map, byName: Map, identityFor: (user) => object }}
 */
export function buildRepIdentities(users = []) {
  const roster = (Array.isArray(users) ? users : []).filter(Boolean).slice().sort(rosterOrder);

  const claimed = new Set();
  const handPicked = new Map();
  roster.forEach((user, index) => {
    const icon = user?.profile_icon ? getIconById(user.profile_icon) : null;
    if (!icon || claimed.has(icon.emoji)) return;
    claimed.add(icon.emoji);
    handPicked.set(index, icon.emoji);
  });

  const spare = REP_PALETTE.map((entry) => entry.emoji).filter((emoji) => !claimed.has(emoji));
  let spareCursor = 0;
  const nextSpare = () => {
    const emoji = spare[spareCursor % Math.max(1, spare.length)];
    spareCursor += 1;
    return emoji;
  };

  const byEmail = new Map();
  const byName = new Map();
  roster.forEach((user, index) => {
    const slot = REP_PALETTE[index % REP_PALETTE.length];
    let emoji = handPicked.get(index);
    if (!emoji) {
      // The slot's own icon, unless someone hand-picked it first.
      emoji = claimed.has(slot.emoji) ? nextSpare() : slot.emoji;
      claimed.add(emoji);
    }
    const identity = { ...slot, emoji };
    if (user.email) byEmail.set(norm(user.email), identity);
    // Name is the fallback key: a couple of dashboards render an avatar from
    // aggregate rows that carry a rep's name but not their email.
    if (user.full_name && !byName.has(norm(user.full_name))) byName.set(norm(user.full_name), identity);
  });

  const identityFor = (user) => {
    if (!user) return REP_PALETTE[0];
    return byEmail.get(norm(user.email))
      || byName.get(norm(user.full_name))
      || fallbackIdentity(user);
  };

  return { byEmail, byName, identityFor };
}
