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
