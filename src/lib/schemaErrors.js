/**
 * "The thing I asked for isn't in the schema" — as opposed to "you may not
 * have it", which is a different answer and must never be confused with it.
 *
 * A missing table means a migration has not run yet, which is a deployment
 * fact the UI can reason about: on a preview build it is why the permissions
 * screen has nothing to save to, and it is what makes the super-admin
 * bootstrap window provably correct rather than a guess. A permission failure
 * means the opposite — the schema is fine and the answer is no — and treating
 * one as the other opens gates that should stay shut.
 *
 * Both layers have their own vocabulary and both have to be listed. Postgres
 * raises 42P01 / 42883 / 42703 (undefined table / function / column) with
 * "… does not exist". PostgREST answers from its own schema cache with
 * PGRST202 for a missing function, 204 for a column and 205 for a table, and
 * its message says "Could not find …" — never "does not exist".
 *
 * That difference is not academic: matching only the Postgres spellings is
 * what hid the permissions screen when the bootstrap check moved to an RPC.
 * The missing function came back as PGRST202, matched nothing, fell through to
 * the "assume it exists" branch, and closed the window on the one person the
 * screen was built for.
 *
 * Permission failures (42501, PGRST301) match none of this, which is the point.
 * scripts/check-permissions.mjs pins every shape.
 */
export function isMissingSchemaError(err) {
  if (!err) return false;
  const code = err.code || '';
  if (['42P01', '42883', '42703'].includes(code)) return true;
  if (/^PGRST20[2-5]$/.test(code)) return true;
  const message = err.message || '';
  return /could not find/i.test(message)
    || /(relation|function|column|table)[^]*does not exist/i.test(message);
}

/**
 * PostgREST's answer when `.single()` matched no rows. Reached, among other
 * ways, when a write targets a column the schema-resilience layer in
 * src/api/entities.js had to strip because it does not exist yet — so the
 * UPDATE became a no-op and returned nothing. The raw text tells the reader
 * nothing about any of that.
 */
export function isEmptyResultError(err) {
  const message = err?.message || '';
  return err?.code === 'PGRST116' || /coerce the result to a single JSON object/i.test(message);
}
