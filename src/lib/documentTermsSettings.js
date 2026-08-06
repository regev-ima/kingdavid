// Read/write side of the legal texts an admin edits in
// הגדרות ← טקסטים ותנאים. Stored as one JSON row in `app_settings`.
//
// The migration that creates `app_settings` is applied by hand in Supabase, so
// every read here has to survive the table not existing yet: a failed read
// resolves to `null` and the callers fall back to DEFAULT_DOCUMENT_TERMS.
// Writes are the one place we do surface the error — an admin pressing "שמור"
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

/**
 * The stored defaults, or null when there is nothing usable to read
 * (table not migrated yet, RLS, network, empty row).
 * @returns {Promise<{value: object, updated_date: string|null, updated_by: string|null}|null>}
 */
export async function fetchDocumentTermsSetting() {
  try {
    const rows = await base44.entities.AppSettings.filter({ id: DOCUMENT_TERMS_SETTING_KEY }, null, 1);
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
 * Upsert the three texts. The entity layer has no upsert, and the row is
 * addressed by its key (app_settings.id), so: look, then update or insert.
 */
export async function saveDocumentTermsSetting(value, updatedBy) {
  const rows = await base44.entities.AppSettings.filter({ id: DOCUMENT_TERMS_SETTING_KEY }, null, 1);
  const payload = { value, updated_by: updatedBy || null };
  if (rows?.[0]) {
    return base44.entities.AppSettings.update(DOCUMENT_TERMS_SETTING_KEY, payload);
  }
  return base44.entities.AppSettings.create({ id: DOCUMENT_TERMS_SETTING_KEY, ...payload });
}
