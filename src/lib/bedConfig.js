// Bed configurator ↔ quote-line linkage.
//
// When the wizard turns a bed's chosen options into separate quote lines, each
// line is tagged with the parent bed's token so the wizard can be re-opened to
// EDIT that bed's configuration — prefilling the previous choices and REPLACING
// the old lines instead of appending duplicates. These markers are persisted in
// the quote's items jsonb (the load path spreads them back), so editing works
// even after a save + reload.
//
//   bed line:    { ..., bed_config_token }
//   option line: { ..., bed_config_owner: <token>, bed_config_group_key, bed_config_value_key }

export function genBedConfigToken() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return `bc_${globalThis.crypto.randomUUID()}`;
    }
  } catch { /* fall through */ }
  return `bc_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// Note types for a bed-configurator choice — a short hint the rep sees in the
// wizard to help explain the difference between options. Shared by the catalog
// manager and the wizard so labels/colors stay in sync.
export const BED_NOTE_TYPES = [
  { key: 'info', label: 'מידע', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'tip', label: 'טיפ מכירה', badge: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'warning', label: 'שים לב', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'compare', label: 'השוואה', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
];

export function getBedNoteType(key) {
  return BED_NOTE_TYPES.find((t) => t.key === key) || BED_NOTE_TYPES[0];
}

// Prices for bed-configurator MANUAL choices are stored/entered as the final
// price to the customer (VAT included); the quote line stores pre-VAT and the
// quote re-adds VAT, so the wizard divides by this to reproduce the entered
// amount. (Choices linked to a product_addon inherit the add-on's pre-VAT price.)
export const BED_VAT_RATE = 1.18;

// A bed-config group is either a single-CHOICE question (image cards → priced
// lines) or a free-TEXT question (fields the rep fills in, e.g. fabric catalog).
export const BED_GROUP_INPUT_TYPES = [
  { key: 'choice', label: 'שאלת בחירה' },
  { key: 'text', label: 'שאלת טקסט' },
];
// A text-group field is a free-text input or a dropdown (options list).
export const BED_FIELD_TYPES = [
  { key: 'text', label: 'טקסט חופשי' },
  { key: 'select', label: 'רשימה נפתחת' },
];
// The 'אחר' option in a select field means "type your own" — same convention as
// the old fabric-supplier dropdown.
export const BED_FIELD_OTHER = 'אחר';

// Text-question answers are stored on the bed item as:
//   item.bed_config_fields = [{ group_key, group_label, values: [{ key, label, value }] }]
// Turn that into display lines, one per group, e.g.
//   "קטלוג בד: שם קטלוג: פרארי · צבע: אפור · ספק: פרחי"
export function bedConfigFieldLines(item) {
  const groups = Array.isArray(item?.bed_config_fields) ? item.bed_config_fields : [];
  const lines = [];
  for (const g of groups) {
    const parts = (g?.values || [])
      .filter((f) => f && String(f.value ?? '').trim() !== '')
      .map((f) => `${f.label}: ${String(f.value).trim()}`);
    if (parts.length) lines.push(`${g.group_label}: ${parts.join(' · ')}`);
  }
  return lines;
}

// Convert a legacy fabric_* item (quotes/orders saved before the text-question
// feature) into the generic bed_config_fields shape — so old documents are
// editable in the wizard and render through the one code path. Returns the
// single fabric group, or null if the item has no fabric data.
export function legacyFabricToFields(item) {
  const values = [];
  if (item?.fabric_catalog_name) values.push({ key: 'catalog_name', label: 'שם קטלוג', value: item.fabric_catalog_name });
  if (item?.fabric_color_number) values.push({ key: 'color_number', label: 'מס׳ צבע', value: item.fabric_color_number });
  if (item?.fabric_color) values.push({ key: 'color', label: 'צבע', value: item.fabric_color });
  const supplier = item?.fabric_supplier === BED_FIELD_OTHER
    ? (item?.fabric_supplier_other || BED_FIELD_OTHER)
    : item?.fabric_supplier;
  if (supplier) values.push({ key: 'supplier', label: 'ספק', value: supplier });
  if (!values.length) return null;
  return { group_key: 'fabric_catalog', group_label: 'קטלוג בד', values };
}
