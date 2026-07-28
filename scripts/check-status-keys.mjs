// Prints the normalized key every lead status collapses to, and fails loudly if
// two statuses share one.
//
// leadStatusMatch.js matches imported Hebrew status labels by dropping
// punctuation and the mater lectionis letters ו/י, so that Kaveret's
// "פולואפ - אחרי הצעת מחיר" resolves to the CRM's "פולאפ - אחרי הצעת מחיר".
// That is only sound while no two statuses collapse together. The module
// already drops ambiguous keys at runtime, so a collision degrades safely — but
// it also means the fuzzy match silently stops working for that pair, which is
// worth seeing rather than discovering mid-import.
//
//   node scripts/check-status-keys.mjs
//
// Exits non-zero on a collision.

import { LEAD_STATUS_OPTIONS } from '../src/constants/leadOptions.js';
import { statusKey, AMBIGUOUS_STATUS_KEYS } from '../src/lib/leadStatusMatch.js';

const byKey = new Map();
for (const s of LEAD_STATUS_OPTIONS) {
  const k = statusKey(s.label);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(s);
}

const pad = Math.max(...LEAD_STATUS_OPTIONS.map((s) => s.label.length));
for (const s of LEAD_STATUS_OPTIONS) {
  console.log(`${s.label.padEnd(pad)}  →  ${statusKey(s.label)}`);
}

const collisions = [...byKey.entries()].filter(([, v]) => v.length > 1);
console.log(`\n${LEAD_STATUS_OPTIONS.length} statuses, ${collisions.length} collision(s)`);

if (collisions.length) {
  for (const [k, group] of collisions) {
    console.error(`  COLLISION on "${k}": ${group.map((s) => s.label).join('  |  ')}`);
  }
  console.error(
    `\nThese keys are excluded from fuzzy matching (${AMBIGUOUS_STATUS_KEYS.length} dropped), ` +
    'so those statuses now need an exact label match or an explicit alias.'
  );
  process.exit(1);
}
