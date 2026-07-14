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

// Human-friendly duration in Hebrew from a number of seconds.
// 45 → "45 שנ׳", 150 → "2 דק׳", 5400 → "1ש׳ 30ד׳", 100000 → "1 ימים".
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} שנ׳`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(s / 3600);
  const remM = Math.round((s % 3600) / 60);
  if (h < 24) return remM ? `${h}ש׳ ${remM}ד׳` : `${h} ש׳`;
  const d = Math.floor(s / 86400);
  const remH = Math.round((s % 86400) / 3600);
  return remH ? `${d}י׳ ${remH}ש׳` : `${d} ימים`;
}

// Elapsed seconds since an ISO/db timestamp (0 if invalid).
export function elapsedSeconds(value) {
  const d = parseDbTimestamp(value);
  if (!d) return 0;
  return Math.max(0, (Date.now() - d.getTime()) / 1000);
}

// Human-readable Hebrew messages for greenApiSend's error codes — shared by
// the composer and the "send PDF" dialog so a rep never sees a raw error
// code like "instance_not_authorized".
const SEND_ERROR_LABELS = {
  not_configured: 'חשבון הוואטסאפ לא מוגדר',
  instance_not_authorized: 'המכשיר לא מאומת ב-Green API',
  rate_limited: 'נשלחו יותר מדי הודעות בדקה האחרונה — נסה שוב עוד רגע',
  chat_not_found: 'השיחה לא נמצאה',
  Forbidden: 'אין הרשאה לשלוח הודעה זו',
  message_required: 'ההודעה ריקה',
  file_url_required: 'לא נמצא קובץ לשליחה',
  invalid_destination: 'מספר הטלפון לא תקין',
  green_send_failed: 'השליחה ל-Green API נכשלה',
};

export function sendErrorMessage(err) {
  return SEND_ERROR_LABELS[err] || err || 'שגיאה לא צפויה';
}

// Prompt for the "improve with AI" action — takes a draft the user already
// wrote and enhances clarity/tone/effectiveness, WITHOUT inventing facts and
// preserving any {{placeholders}} literally. Shared by the template editor
// and the chat composer so both behave identically. `categoryLabel` is
// optional extra context (used from the template editor).
export function buildImproveMessagePrompt(text, categoryLabel) {
  const cat = categoryLabel ? ` הקטגוריה: ${categoryLabel}.` : '';
  return 'שפר את הודעת הוואטסאפ הבאה בעברית, עבור חברת "קינג דוד" (מזרנים ומוצרי שינה).'
    + ` שפר בהירות, טון וניסוח, שמור על אורך קצר ועל סגנון עסקי-חם ואישי.${cat}`
    + ' חשוב: שמור על כל הפלייסהולדרים בדיוק כפי שהם (למשל {{שם}}, {{נציג}}, {{טלפון_נציג}}),'
    + ' ואל תמציא פרטים, מספרים, מחירים או הבטחות שלא נכתבו במקור.'
    + ' החזר רק את ההודעה המשופרת עצמה, בלי מרכאות ובלי הסברים.'
    + `\n\nההודעה המקורית:\n"""\n${text}\n"""`;
}

// Resolve {{placeholders}} in a template body against a chat/user context.
// Unrecognized placeholders are left untouched (never throws, never drops
// text) — see whatsapp-phase2-messaging-plan.md §5.
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function resolveTemplate(body, ctx = {}) {
  if (!body) return '';
  const firstName = (ctx.contactName || '').trim().split(/\s+/)[0] || '';
  const values = {
    'שם': firstName,
    'שם_מלא': (ctx.contactName || '').trim(),
    'נציג': (ctx.repName || '').trim(),
    'טלפון_נציג': (ctx.repPhone || '').trim(),
  };
  return body.replace(PLACEHOLDER_PATTERN, (match, key) => (key in values ? values[key] : match));
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
