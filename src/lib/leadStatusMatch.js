// ─────────────────────────────────────────────────────────────────────────────
// Matching a free-text status label to a CRM status value.
//
// Exact string comparison fails on Hebrew imports for a reason that has nothing
// to do with meaning: מלא vs חסר spelling. Kaveret exports
//   "פולואפ - אחרי הצעת מחיר"
// and the CRM stores
//   "פולאפ - אחרי הצעת מחיר"
// — one ו apart. Under exact matching every such row silently became
// `new_lead`, which on a 115k-row import means every closed and dead lead
// reappears at the top of the queue as fresh work.
//
// So comparison happens on a normalized key: punctuation dropped, whitespace
// collapsed, and the mater lectionis letters ו/י removed, which is exactly the
// axis full/defective spelling varies on.
//
// Removing letters is only safe if it never merges two DIFFERENT statuses.
// All 27 current labels are distinct under this key, but that is a property of
// today's list, not a guarantee — so it is enforced rather than assumed: any
// key two labels share is DROPPED from the fuzzy map (see below). A future
// status that collides degrades to exact matching instead of silently
// resolving to whichever label happened to be defined last.
//
// Run `node scripts/check-status-keys.mjs` to see the current key table.
// ─────────────────────────────────────────────────────────────────────────────

import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';

export function statusKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/["'`״׳]/g, '')        // quotes, gershayim
    .replace(/[-–—_,.()[\]]/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .replace(/[וי]/g, '')           // full vs defective spelling
    .trim();
}

const VALID = new Set(LEAD_STATUS_OPTIONS.map((s) => s.value));

// Build the fuzzy map, dropping any key claimed by more than one status.
// `new Map(entries)` would keep the last writer and quietly hand every import
// row of an ambiguous label to the wrong status; an absent key just falls
// through to exact matching, which is the honest outcome.
export const AMBIGUOUS_STATUS_KEYS = [];
const BY_KEY = (() => {
  const seen = new Map();
  const dupes = new Set();
  for (const s of LEAD_STATUS_OPTIONS) {
    const k = statusKey(s.label);
    if (seen.has(k)) dupes.add(k);
    else seen.set(k, s.value);
  }
  for (const k of dupes) {
    seen.delete(k);
    AMBIGUOUS_STATUS_KEYS.push(k);
  }
  return seen;
})();

// Terms that are not spelling variants of a CRM label but genuinely mean one.
// `התקבל` is Kaveret's [[Lead.state]] — "the lead arrived" — not a handling
// status, so it maps to the entry state rather than being reported as unknown.
//
// The second block is the residue of a real 116k-row Kaveret export. Most of
// its statuses now match on the label alone, because LEAD_STATUS_OPTIONS was
// extended to carry every key migration 20260426000004 wrote. What is left are
// labels the mater-lectionis key cannot bridge on its own — a thousands
// separator, an abbreviation, or trailing words the CRM label does not have.
// Each one is a status the file really uses, with the row count it carried.
const ALIASES = new Map(
  Object.entries({
    'התקבל': 'new_lead',
    'חדש': 'new_lead',
    'ליד חדש': 'new_lead',
    'לא רלוונטי': 'not_relevant_no_explanation',
    'אין מענה': 'no_answer_calls',
    'ללא מענה': 'no_answer_calls',
    'סגור': 'deal_closed',
    'עסקה נסגרה': 'deal_closed',

    // ── from the Kaveret export ──
    // "ב1,000" vs the CRM's "ב 1000": the comma becomes a space, so the key is
    // "ב1 000" and no amount of spelling normalization closes that gap. (3,405)
    'לא רלוונטי - מחפש מזרן ב1,000 ש"ח': 'not_relevant_1000_nis',
    // Trailing "לשמוע עוד" the CRM label does not carry. (2,247)
    'שמע מחיר ולא מעוניין לשמוע עוד': 'heard_price_not_interested',
    // Trailing "בחברה". (1,436)
    'מחפש מוצרים שלא קיימים בחברה': 'products_not_available',
    // "מס'" abbreviated vs "מספר" spelled out. (1,316)
    "לא רלוונטי - מס' שגוי": 'not_relevant_wrong_number',

    // Two keys share this label — see the note on will_arrive_for_meeting in
    // leadOptions. statusKey drops a label claimed twice, so without this entry
    // the text would resolve to nothing and import as new_lead. It resolves to
    // the key the app itself writes.
    'יגיע לסניף לפגישה': 'coming_to_branch',
  }).map(([k, v]) => [statusKey(k), v])
);

/**
 * Resolve a raw status string to a CRM status value.
 *
 * Returns null when nothing matches — deliberately, so the caller can SHOW the
 * unmatched values instead of quietly writing new_lead. `resolveStatus` is the
 * lookup; deciding what an unknown status becomes is the caller's job.
 */
export function matchStatus(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (VALID.has(s)) return s;          // already a CRM value
  const k = statusKey(s);
  return BY_KEY.get(k) || ALIASES.get(k) || null;
}

/**
 * Every distinct status in the file, with what it resolved to. Drives the audit
 * panel — the point is that the user sees which of their statuses the CRM did
 * not recognise BEFORE 115k rows are written, not after.
 */
export function auditStatuses(values) {
  const counts = new Map();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const rows = [...counts.entries()].map(([raw, count]) => ({
    raw,
    count,
    value: matchStatus(raw),
  }));
  rows.sort((a, b) => b.count - a.count);
  return {
    rows,
    matched: rows.filter((r) => r.value),
    unmatched: rows.filter((r) => !r.value),
  };
}
