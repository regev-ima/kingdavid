// Single source of truth for the three legal texts printed on a quote and on
// an order: payment & delivery terms, warranty, and the general terms block.
//
// Where each one lives on a record:
//   quotes  → terms, warranty_terms, notes
//   orders  → terms, warranty_terms, legal_notes
// (`orders.notes` is not a legal field — an order's free text lives in
// notes_sales / notes_factory / notes_logistics, which is exactly why the
// order copy needed a column of its own.)
//
// Resolution order for a document is document → defaults → this file. The
// defaults come from the `app_settings` row an admin edits in
// הגדרות ← טקסטים ותנאים; when that table/row isn't there (the migration is
// applied by hand in Supabase) everything still resolves, to the text below.
//
// A document stores wording ONLY where someone deliberately changed it (see
// customDocumentTerms). Standard wording is left NULL on the record so it keeps
// resolving through Settings — otherwise every quote and every order carried a
// full copy of the defaults, a copy always won over Settings, and editing the
// texts there changed nothing anyone could see. That was the bug: "שיניתי את
// התנאים בהגדרות אבל בהזמנה עדיין מופיע הישן".

export const DEFAULT_DOCUMENT_TERMS = {
  terms: `30 ימי עסקים בהזמנת מיטה / 14 ימי עסקים בהזמנת מזרן.
תאום המשלוח יבוצע יום אחד קודם, ביום המשלוח תינתן התראה לפני הגעת המוביל.`,

  warranty_terms: `אחריות יצרן ל-10 שנים על המזרן.`,

  legal_notes: `ניתן להחליף/לבטל הזמנה של מזרן תוך 30 יום מקבלתו בהחזר כספי מלא, למעט דמי הובלה.
* מזרנים שהוגדרו במידה מיוחדת על פי תקנון החברה אינם ניתנים לביטול/החלפה על אף אריזתם המקורית.
* החזרת מזרן יתבצע בתיאום מראש בלבד, בטלפון או במייל מול מחלקת שירות לקוחות.
* בסיסים ומיטות מכל סוג הינם הזמנה אישית, בעיצוב וייצור אישי ללקוח, עפ'י דרישותיו ולכן אינם ניתנים לביטול או החלפה בשום אופן.
* שינוי או ביטול הזמנה של בסיסים או מיטות יינתן עד 48 שעות מרגע ההזמנה בלבד. לאחר מכן לא יהיה ניתן לבטל.
*במידה וההובלה כרוכה במנוף/חבלים או פירוק/פינוי, העלות הנוספת תחול על חשבון הלקוח מול חברת השילוח וההובלה.
* מחיר ההובלה וההרכבה במדרגות, עד קומה 3, כל קומה נוספת בעלות ₪50 עבור כל פריט שאינו נכנס למעלית.
* הלקוח מצהיר כי יש לו גישה להכנסת הסחורה לביתו, ומאשר כי האחריות להכנסת כל מוצר שהוא לביתו חלה עליו בלבד.
*מסירת הסחורה ללקוח תבוצע אך ורק לאחר גמר חשבון ותשלום מלא בפועל.
* בהזמנת מזרן: תאום משלוח יבוצע יום אחד קודם. ביום המשלוח תינתן התראה לפני הגעת המוביל. ללקוח האפשרות לדחות את מועד האספקה.
* איסוף עצמי בתיאום מראש ישירות במפעל ברח׳ העמל 6 קרית מלאכי בימים א-ה בין השעות 9:00 - 16:00.

הלקוח מאשר בחתימתו אישור סופי ומוחלט לכל הכתוב לעיל,
ומצהיר בזאת כי הוא עבר על כל פרטי ההזמנה ומסכים לתנאי החברה ומדיניותה.`,
};

// The `app_settings` row that holds the admin-edited version of the above.
// `app_settings.id` IS the key (see the migration) so the generic entity layer
// can address it with .update(key, …).
export const DOCUMENT_TERMS_SETTING_KEY = 'document_terms';

// Field order + labels, shared by the settings editor, the terms card and both
// PDFs, so the three texts are always named the same thing everywhere.
export const DOCUMENT_TERMS_FIELDS = [
  { key: 'terms', label: 'תנאי תשלום ואספקה', rows: 4 },
  { key: 'warranty_terms', label: 'אחריות', rows: 3 },
  { key: 'legal_notes', label: 'תנאים כלליים', rows: 16 },
];

export const DOCUMENT_TERMS_LABELS = Object.fromEntries(
  DOCUMENT_TERMS_FIELDS.map((f) => [f.key, f.label]),
);

/**
 * The legal fields of an ORDER, and only those.
 *
 * An order's general terms live in `legal_notes`; `orders.notes` is not a
 * legal field (that's a quote's shape), so an order is read through this
 * before resolving — a stray legacy note must never print as תנאים כלליים.
 */
export function orderTermsFields(order) {
  return {
    terms: order?.terms,
    warranty_terms: order?.warranty_terms,
    legal_notes: order?.legal_notes,
  };
}

const firstText = (...candidates) => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
};

/**
 * The three legal texts for a document, falling back per-field.
 *
 * @param {object|null} doc      A quote, an order, or a plain
 *                               {terms, warranty_terms, legal_notes} bag.
 * @param {object|null} defaults What a missing field falls back to — normally
 *                               the admin-edited defaults. Anything still
 *                               missing falls back to DEFAULT_DOCUMENT_TERMS.
 * @returns {{terms: string, warranty_terms: string, legal_notes: string}}
 *
 * Chains, so "order → quote → settings → code" is just:
 *   resolveDocumentTerms(order, resolveDocumentTerms(quote, settingsDefaults))
 */
export function resolveDocumentTerms(doc, defaults) {
  const d = doc || {};
  const f = defaults || {};
  return {
    terms: firstText(d.terms, f.terms, DEFAULT_DOCUMENT_TERMS.terms),
    warranty_terms: firstText(d.warranty_terms, f.warranty_terms, DEFAULT_DOCUMENT_TERMS.warranty_terms),
    // A quote keeps the general terms in `notes`, an order in `legal_notes`.
    legal_notes: firstText(
      d.legal_notes,
      d.notes,
      f.legal_notes,
      f.notes,
      DEFAULT_DOCUMENT_TERMS.legal_notes,
    ),
  };
}

// Whitespace-insensitive: a reflowed paragraph or a stray trailing newline is
// not a change to what the customer reads, and shouldn't freeze a document out
// of later corrections made in Settings.
const sameText = (a, b) =>
  String(a ?? '').trim().replace(/\s+/g, ' ') === String(b ?? '').trim().replace(/\s+/g, ' ');

/**
 * What to STORE on a document: only the texts that actually differ from the
 * company defaults in force right now. A field holding the standard wording
 * comes back null, so the record saves nothing there and keeps resolving
 * through הגדרות ← טקסטים ותנאים for the rest of its life.
 *
 * The inverse of resolveDocumentTerms: resolve to display, this to save.
 *
 * @param {object|null} doc      A quote, an order, or a plain
 *                               {terms, warranty_terms, legal_notes} bag.
 * @param {object|null} defaults The company defaults to measure against.
 * @returns {{terms: string|null, warranty_terms: string|null, legal_notes: string|null}}
 */
export function customDocumentTerms(doc, defaults) {
  const written = resolveDocumentTerms(doc, defaults);
  const standard = resolveDocumentTerms(null, defaults);
  return {
    terms: sameText(written.terms, standard.terms) ? null : written.terms,
    warranty_terms: sameText(written.warranty_terms, standard.warranty_terms) ? null : written.warranty_terms,
    legal_notes: sameText(written.legal_notes, standard.legal_notes) ? null : written.legal_notes,
  };
}
