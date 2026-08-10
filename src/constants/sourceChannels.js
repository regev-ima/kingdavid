/**
 * The channel a lead actually came from, worked out from free text.
 *
 * `leads.source` is not a controlled vocabulary — it holds campaign names typed
 * by whoever set the campaign up. Over 100 distinct values are in there, in two
 * alphabets: "גוגל דף חדש עלית - ליד" (13,599 leads), "Facebook Form", "fb",
 * "טיקטוק", "Outbrain", plus the handful of picker keys (`store`, `callcenter`)
 * that almost nothing uses. A colour keyed on the exact string would paint the
 * six values it recognises and leave the rest grey.
 *
 * So the channel is DERIVED at render time rather than stored. Nothing is
 * migrated, nothing is lost, and the campaign name stays exactly as the rep
 * sees it today — it just gains a colour. The same rules would drive a
 * normalising migration later; this is the half that needs no permission.
 *
 * Order matters: a value naming two channels ("פייסבוק , גוגל , שיחה נכנסת")
 * resolves to the first rule that matches, so the paid channels are checked
 * before the ones a lead falls back to.
 */

/** Outline + dot rather than a filled pill, on purpose.
 *
 *  A row already carries a status badge, and that one is the loud thing: red
 *  there means "call this lead now" and nothing else — a rule the whole status
 *  palette is built on. A second filled badge in the same row would put red
 *  beside red meaning two different things. A different SHAPE lets the hues
 *  repeat safely: the eye reads outline-with-a-dot as a different kind of fact
 *  before it reads the colour. */
export const SOURCE_CHANNELS = {
  facebook: { label: 'פייסבוק',     dot: 'bg-blue-500',    text: 'text-blue-700',    border: 'border-blue-200' },
  instagram:{ label: 'אינסטגרם',    dot: 'bg-blue-500',    text: 'text-blue-700',    border: 'border-blue-200' },
  google:   { label: 'גוגל',        dot: 'bg-red-500',     text: 'text-red-700',     border: 'border-red-200' },
  tiktok:   { label: 'טיקטוק',      dot: 'bg-neutral-900', text: 'text-neutral-800', border: 'border-neutral-300' },
  whatsapp: { label: 'ווטסאפ',      dot: 'bg-green-500',   text: 'text-green-700',   border: 'border-green-200' },
  outbrain: { label: 'טאבולה/אאוטבריין', dot: 'bg-orange-500', text: 'text-orange-700', border: 'border-orange-200' },
  callcenter:{ label: 'שיחה נכנסת', dot: 'bg-purple-500',  text: 'text-purple-700',  border: 'border-purple-200' },
  store:    { label: 'כניסה לחנות', dot: 'bg-amber-500',   text: 'text-amber-700',   border: 'border-amber-200' },
  website:  { label: 'אתר',         dot: 'bg-cyan-500',    text: 'text-cyan-700',    border: 'border-cyan-200' },
  referral: { label: 'הפניה',       dot: 'bg-teal-500',    text: 'text-teal-700',    border: 'border-teal-200' },
  telegram: { label: 'טלגרם',       dot: 'bg-sky-500',     text: 'text-sky-700',     border: 'border-sky-200' },
  service:  { label: 'שירות לקוחות',dot: 'bg-slate-500',   text: 'text-slate-700',   border: 'border-slate-200' },
  unknown:  { label: '',            dot: 'bg-slate-400',   text: 'text-slate-600',   border: 'border-slate-200' },
};

// Checked top to bottom; first match wins.
const CHANNEL_RULES = [
  ['google',     [/גוגל/, /^google/, /^דיגיטל$/, /^digital$/]],
  ['facebook',   [/פייסבוק/, /פייסב/, /פייסוק/, /facebook/, /^fb$/]],
  ['instagram',  [/אינסטגרם/, /instagram/, /^ig$/]],
  ['tiktok',     [/טיקטוק/, /tiktok/]],
  ['whatsapp',   [/וטסאפ/, /ואטסאפ/, /ואטפס/, /ואטאפס/, /whatsapp/]],
  ['outbrain',   [/טאבולה/, /אאוטבריין/, /outbrain/, /taboola/]],
  ['telegram',   [/טלגרם/, /telegram/]],
  ['callcenter', [/שיחה נכנסת/, /^שיחה$/, /^callcenter$/, /^מוקד$/]],
  ['store',      [/כניסה לחנות/, /^store$/, /^חנות$/]],
  ['website',    [/אתר/, /דף נחיתה/, /^website$/]],
  // Both picker keys and the Hebrew a rep might type by hand. "הפניה" was
  // missing: the picker stores `referral`, so it resolved, but the same word
  // typed into the free-text source did not.
  ['referral',   [/לקוח חוזר/, /לקוחה חוזרת/, /^הפניה$/, /^חבר$/, /^לקוח$/, /^חברה$/,
                  /^referral$/, /^returning_customer$/]],
  ['service',    [/שירות לקוחות/]],
];

/** The channel key for a raw source string. Never throws; 'unknown' is a
 *  legitimate answer and renders as the raw text in grey. */
export function resolveSourceChannel(source) {
  const s = String(source || '').trim().toLowerCase();
  if (!s) return 'unknown';
  for (const [channel, patterns] of CHANNEL_RULES) {
    if (patterns.some((re) => re.test(s))) return channel;
  }
  return 'unknown';
}
