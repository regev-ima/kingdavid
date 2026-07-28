// ─────────────────────────────────────────────────────────────────────────────
// Pulling a rep's email out of a Kaveret "מנהל תיק" cell.
//
// The column is not an email field — it is a rendered blob:
//
//   "י yonikd01@gmail.com 0502628991 שלוחה xEyIGGq9"
//    │  └ the only part we want      │      └ extension token
//    └ initial                       └ phone
//
// Mapping that column straight to rep1 wrote the whole string into a field the
// rest of the app compares against user emails. The lead then matched no rep,
// and — because the "unassigned" filter tests rep1 for null/empty — it also
// dropped out of the triage queue. Assigned to nobody, and invisible.
//
// So the value is parsed rather than copied.
// ─────────────────────────────────────────────────────────────────────────────

// Deliberately not an RFC-complete email regex. This runs against a rendered
// display string, so the job is "find the token that is obviously an address",
// and a permissive pattern that over-matches would happily grab "שלוחה xEyIGGq9".
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/;

/**
 * First email address in a string, lowercased. null when there is none.
 *
 * Bidi control characters are stripped first: Hebrew-mixed exports carry RLM /
 * LRM marks that can sit flush against the address and would otherwise become
 * part of the captured local part.
 */
export function extractEmail(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[‎‏‪-‮⁦-⁩]/g, ' ');
  const m = cleaned.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Distinct rep emails found in a column, each with a row count and whether a
 * user with that email exists.
 *
 * `knownEmails` is the set the CRM actually recognises. An extracted address
 * that is not in it still gets written — the caller asked for the email from
 * the file, not for a filtered version of it — but it is reported, because
 * "assigned to someone who is not a user here" is the one outcome that looks
 * fine in the import summary and is wrong in the lead list.
 */
export function auditRepEmails(values, knownEmails) {
  const known = new Set([...(knownEmails || [])].map((e) => String(e || '').toLowerCase()));
  const counts = new Map();
  let blank = 0;

  for (const v of values) {
    const email = extractEmail(v);
    if (!email) {
      if (String(v ?? '').trim()) blank += 1; // had content, held no address
      continue;
    }
    counts.set(email, (counts.get(email) || 0) + 1);
  }

  const rows = [...counts.entries()]
    .map(([email, count]) => ({ email, count, isUser: known.has(email) }))
    .sort((a, b) => b.count - a.count);

  return {
    rows,
    matched: rows.filter((r) => r.isUser),
    unmatched: rows.filter((r) => !r.isUser),
    // Rows whose rep cell was populated but contained no address at all.
    withoutEmail: blank,
  };
}
