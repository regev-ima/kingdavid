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
// `מנהל תיק` IS mapped to rep1, but its value is parsed rather than copied:
// the cell reads "י yonikd01@gmail.com 0502628991 שלוחה xEyIGGq9" and only the
// address is kept (see lib/repEmailExtract.js). Copying it whole wrote a blob
// into a field the app compares against user emails, which left the lead
// matching no rep AND excluded from the unassigned queue.
//
// Deliberately NOT mapped:
//   [[Lead.manager]] → rep1. It is a Hebrew display name ("יהונתן רחמני"), and
//     rep1 holds an email. `מנהל תיק` carries the same person with an actual
//     address, so it is the better source for the same fact.
//   [[Lead.landingPage]] → landing_page. It repeats מקור הגעה verbatim
//     ("פייסבוק טופס פנימי"), so it adds a second copy of `source`, not a URL.
//   lead.name / [[lead.id]] / [[Lead.leadCode]] — duplicates of columns already
//     mapped; mapping a field twice is not possible and the extra copies carry
//     no information.
//   משימות פתוחות → notes. It used to be. The cell is the TITLES of the lead's
//     open tasks ("3450 כולל הובלה"), not a note about the lead, and it carries
//     none of what a task is — no dates, no status, no rep, and none of the
//     tasks already done. Landing it in הערות put a task's headline where a
//     rep reads remarks and threw the rest of the history away. Task history
//     needs Kaveret's task export and its own import; the lead export cannot
//     supply it.
const KAVERET_COLUMNS = {
  external_id:  'lead.id',
  full_name:    'איש קשר',
  phone:        'מספר טלפון',
  created_date: 'תאריך יצירה',
  status:       'סטטוס',
  source:       'מקור הגעה',
  facebook_ad_name: 'שם מודעה',
  click_id:     'gclid',
  rep1:         'מנהל תיק',
};

// The lead form's two questions, which Kaveret keeps as custom fields. Their
// headers are the question text and the wording is not fixed between forms
// ("מה מידת המזרן שתרצו?", "מה מידת המזרן שאתם מחפשים?"), so these match on
// the phrase that survives every wording rather than on an exact header.
const KAVERET_FUZZY_COLUMNS = {
  facebook_requested_size: ['מידת המזרן', 'מידת מזרן'],
  facebook_try_at_home:    ['לנסות את המזרן', 'איפה תרצו לנסות'],
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
  const taken = new Set(Object.values(mapping));
  for (const [field, phrases] of Object.entries(KAVERET_FUZZY_COLUMNS)) {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && phrases.some((p) => norm(h).includes(norm(p))));
    if (i !== -1) { mapping[field] = i; taken.add(i); }
  }
  return mapping;
}

export const KAVERET_MAPPED_COLUMNS = KAVERET_COLUMNS;
