/**
 * Preset palette for the per-status color picker (Settings → סטטוסים).
 *
 * We expose a fixed list of named colors instead of arbitrary hex values so
 * Tailwind's JIT compiler can statically extract the classes (it cannot pick
 * up `bg-${color}-100` patterns built at runtime). All classes referenced here
 * are also enumerated in tailwind.config.js → safelist for the same reason.
 */

export const STATUS_COLOR_PRESETS = [
  { id: 'red',     label: 'אדום',    bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500',     hex: '#ef4444' },
  { id: 'orange',  label: 'כתום',    bg: 'bg-orange-100',  text: 'text-orange-700',  dot: 'bg-orange-500',  hex: '#f97316' },
  { id: 'amber',   label: 'ענבר',    bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500',   hex: '#f59e0b' },
  { id: 'yellow',  label: 'צהוב',    bg: 'bg-yellow-100',  text: 'text-yellow-700',  dot: 'bg-yellow-500',  hex: '#eab308' },
  { id: 'lime',    label: 'ליים',    bg: 'bg-lime-100',    text: 'text-lime-700',    dot: 'bg-lime-500',    hex: '#84cc16' },
  { id: 'green',   label: 'ירוק',    bg: 'bg-green-100',   text: 'text-green-700',   dot: 'bg-green-500',   hex: '#22c55e' },
  { id: 'emerald', label: 'אזמרגד',  bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', hex: '#10b981' },
  { id: 'teal',    label: 'טורקיז',  bg: 'bg-teal-100',    text: 'text-teal-700',    dot: 'bg-teal-500',    hex: '#14b8a6' },
  { id: 'cyan',    label: 'תכלת',    bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: 'bg-cyan-500',    hex: '#06b6d4' },
  { id: 'sky',     label: 'שמיים',   bg: 'bg-sky-100',     text: 'text-sky-700',     dot: 'bg-sky-500',     hex: '#0ea5e9' },
  { id: 'blue',    label: 'כחול',    bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500',    hex: '#3b82f6' },
  { id: 'indigo',  label: 'אינדיגו', bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: 'bg-indigo-500',  hex: '#6366f1' },
  { id: 'violet',  label: 'סגלגל',   bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-500',  hex: '#8b5cf6' },
  { id: 'purple',  label: 'סגול',    bg: 'bg-purple-100',  text: 'text-purple-700',  dot: 'bg-purple-500',  hex: '#a855f7' },
  { id: 'fuchsia', label: 'פוקסיה',  bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500', hex: '#d946ef' },
  { id: 'pink',    label: 'ורוד',    bg: 'bg-pink-100',    text: 'text-pink-700',    dot: 'bg-pink-500',    hex: '#ec4899' },
  { id: 'rose',    label: 'שושני',   bg: 'bg-rose-100',    text: 'text-rose-700',    dot: 'bg-rose-500',    hex: '#f43f5e' },
  { id: 'slate',   label: 'אפור',    bg: 'bg-slate-100',   text: 'text-slate-700',   dot: 'bg-slate-500',   hex: '#64748b' },
];

export const STATUS_COLOR_BY_ID = Object.fromEntries(
  STATUS_COLOR_PRESETS.map((preset) => [preset.id, preset]),
);

export function getStatusColorPreset(id) {
  return STATUS_COLOR_BY_ID[id] || null;
}
