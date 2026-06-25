import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';

// Conversation status → label + colours. Mirrors the product rule:
//   waiting  = last message was INCOMING → customer waiting for a reply (red)
//   answered = last message was OUTGOING → we replied / "got service" (green)
export function chatStatusMeta(status) {
  switch (status) {
    case 'waiting':
      return { label: 'ממתין לתשובה', dot: 'bg-red-500', text: 'text-red-700', accent: 'border-r-red-500', chip: 'bg-red-100 text-red-700' };
    case 'answered':
      return { label: 'טופל', dot: 'bg-green-500', text: 'text-green-700', accent: 'border-r-green-500', chip: 'bg-green-100 text-green-700' };
    default:
      return { label: '—', dot: 'bg-slate-300', text: 'text-slate-500', accent: 'border-r-transparent', chip: 'bg-slate-100 text-slate-600' };
  }
}

// 972501234567@c.us / 972501234567 → 050-1234567 (best-effort, falls back to raw)
export function prettyPhone(raw) {
  if (!raw) return '';
  let n = String(raw).replace(/@c\.us$|@g\.us$/, '').replace(/\D/g, '');
  if (n.startsWith('972')) n = '0' + n.slice(3);
  if (n.length === 10 && n.startsWith('0')) return `${n.slice(0, 3)}-${n.slice(3)}`;
  return n || String(raw);
}

export function chatTitle(chat) {
  if (!chat) return '';
  if (chat.contact_name && chat.contact_name.trim()) return chat.contact_name.trim();
  if (chat.is_group) return 'קבוצה';
  return prettyPhone(chat.contact_phone || chat.chat_id);
}

export function chatInitial(chat) {
  const t = chatTitle(chat);
  const ch = (t || '?').trim().charAt(0);
  return ch || '?';
}

// Compact list timestamp: HH:mm today, "אתמול", or dd/MM otherwise.
export function listTime(value) {
  const d = parseDbTimestamp(value);
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export function bubbleTime(value) {
  const d = parseDbTimestamp(value);
  if (!d) return '';
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(value) {
  const d = parseDbTimestamp(value);
  if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'היום';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Deterministic avatar colour from a string (so each contact keeps its colour).
export function colorFromString(str) {
  const palette = [
    'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500',
    'bg-rose-500', 'bg-teal-500', 'bg-indigo-500', 'bg-orange-500',
  ];
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
