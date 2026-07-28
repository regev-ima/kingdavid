// ─────────────────────────────────────────────────────────────────────────────
// The Kaveret export has a fixed shape. Stop re-deriving it by hand.
//
// A Kaveret (כוורת) lead export is 79 columns wide, most of them empty
// `[[Lead.*]]` template placeholders, and the generic alias auto-detection in
// ImportLeadsTab misses the ones that matter:
//
//   • the row id is `lead.id` — not `id`, `מזהה` or anything the aliases list
//   • the phone arrives as "טלפון: 0547333975", prefixed
//   • three columns carry the SAME id (lead.id, [[lead.id]], [[Lead.leadCode]])
//   • two carry the same name (איש קשר, lead.name)
//   • `מנהל תיק` looks like a rep column but holds
//     "י yonikd01@gmail.com 0502628991 שלוחה xEyIGGq9" — a blob, not an email
//
// Every import repeated the same manual mapping and the same three judgement
// calls. The file does not change between exports, so the mapping belongs in
// code: detect the export, apply the whole mapping, done.
//
// This is a PRESET, not a lock — it fills the dropdowns and the user can still
// change anything before importing.
// ─────────────────────────────────────────────────────────────────────────────

// Columns that together identify a Kaveret export. `lead.id` alone is too weak
// (any CRM could name a column that), so detection also requires one of the
// bracketed template placeholders, which nothing else produces.
const SIGNATURE_REQUIRED = ['lead.id'];
const SIGNATURE_ANY = ['[[lead.id]]', '[[Lead.leadCode]]', '[[Lead.creationDateTime]]', '[[Lead.status]]'];

// target field ← exact Kaveret column header
//
// Deliberately NOT mapped:
//   מנהל תיק / [[Lead.manager]] → rep1. One is a blob, the other a Hebrew name;
//     rep1 expects an email and neither would resolve to a user. Leads are also
//     meant to land unassigned for a manager to triage.
//   [[Lead.landingPage]] → landing_page. It repeats מקור הגעה verbatim
//     ("פייסבוק טופס פנימי"), so it adds a second copy of `source`, not a URL.
//   lead.name / [[lead.id]] / [[Lead.leadCode]] — duplicates of columns already
//     mapped; mapping a field twice is not possible and the extra copies carry
//     no information.
const KAVERET_COLUMNS = {
  external_id:  'lead.id',
  full_name:    'איש קשר',
  phone:        'מספר טלפון',
  created_date: 'תאריך יצירה',
  status:       'סטטוס',
  source:       'מקור הגעה',
  notes:        'משימות פתוחות',
  facebook_ad_name: 'שם מודעה',
  click_id:     'gclid',
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** True when these headers look like a Kaveret lead export. */
export function isKaveretExport(headers) {
  const set = new Set(headers.map(norm));
  if (!SIGNATURE_REQUIRED.every((c) => set.has(norm(c)))) return false;
  return SIGNATURE_ANY.some((c) => set.has(norm(c)));
}

/**
 * field key → column index, for the columns this file actually has.
 *
 * Matched on the exact header text rather than by position: Kaveret can drop a
 * custom-field column between exports, and a positional mapping would then
 * silently shift every field one to the left.
 */
export function kaveretMapping(headers) {
  const index = new Map();
  headers.forEach((h, i) => {
    const k = norm(h);
    if (!index.has(k)) index.set(k, i); // first wins — the duplicates are later
  });

  const mapping = {};
  for (const [field, column] of Object.entries(KAVERET_COLUMNS)) {
    const i = index.get(norm(column));
    if (i !== undefined) mapping[field] = i;
  }
  return mapping;
}

export const KAVERET_MAPPED_COLUMNS = KAVERET_COLUMNS;
