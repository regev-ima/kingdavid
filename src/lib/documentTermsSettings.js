// Read/write side of the legal texts an admin edits in
// הגדרות ← טקסטים ותנאים. Stored as one JSON row in `app_settings`.
//
// The row is addressed by `key`, not by `id`. The migration in this repo
// declares `id text PRIMARY KEY` — the setting key as the primary key — but it
// was written as CREATE TABLE IF NOT EXISTS against a database that already had
// an `app_settings` table with a uuid `id` and a separate `key` column. IF NOT
// EXISTS does not alter an existing table, so the migration was a silent no-op
// and the real table never had the shape the code assumed. Saving reported
// `invalid input syntax for type uuid: "document_terms"` — the key going into a
// uuid column.
//
// Keying on `key` is also the better shape on its own terms: a surrogate id
// stays stable while the natural key means something, which is why the table
// was built that way in the first place.
//
// Every read has to survive the table not existing at all: a failed read
// resolves to `null` and the callers fall back to DEFAULT_DOCUMENT_TERMS.
// Writes are the one place the error is surfaced — an admin pressing "שמור"
// has to be told the row didn't save.

import { base44 } from '@/api/base44Client';
import { DOCUMENT_TERMS_SETTING_KEY } from '@/constants/documentTerms';

export const DOCUMENT_TERMS_QUERY_KEY = ['app-settings', DOCUMENT_TERMS_SETTING_KEY];

// `value` is jsonb, but a hand-written row (or an older client) can hold a
// JSON *string*. Accept both rather than rendering "[object Object]".
function parseValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

function findRow() {
  return base44.entities.AppSettings.filter({ key: DOCUMENT_TERMS_SETTING_KEY }, null, 1);
}

/**
 * The stored defaults, or null when there is nothing usable to read
 * (table not migrated yet, RLS, network, empty row).
 * @returns {Promise<{value: object, updated_date: string|null, updated_by: string|null}|null>}
 */
export async function fetchDocumentTermsSetting() {
  try {
    const rows = await findRow();
    const row = rows?.[0];
    const value = parseValue(row?.value);
    if (!value) return null;
    return {
      value,
      updated_date: row.updated_date || null,
      updated_by: row.updated_by || null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[documentTerms] app_settings unavailable — falling back to the defaults in code', err?.message);
    return null;
  }
}

/**
 * Upsert the three texts. The entity layer has no upsert and addresses rows by
 * their primary key, so: look the row up by `key`, then update it by the `id`
 * the database gave it, or insert a new one.
 */
export async function saveDocumentTermsSetting(value, updatedBy) {
  const rows = await findRow();
  const existing = rows?.[0];
  const payload = { value, updated_by: updatedBy || null };
  if (existing?.id) {
    return base44.entities.AppSettings.update(existing.id, payload);
  }
  return base44.entities.AppSettings.create({ key: DOCUMENT_TERMS_SETTING_KEY, ...payload });
}
