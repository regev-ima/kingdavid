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
