/**
 * "מתי דיברו איתו בעצם?" — the lead's contact log.
 *
 * Two tables answer that question and neither answers it alone. `call_logs`
 * holds what the phone system saw: every click-to-call and everything
 * Voicenter's CDR sync matched back to a lead, with duration, result and a
 * recording URL. `communication_logs` holds what a rep typed into
 * "הוסף תקשורת" — the WhatsApp exchange, the meeting, the call placed from a
 * private phone that the switchboard never saw.
 *
 * Until now the lead screen read neither one for calls: the activity feed
 * merged the activity log, manual communications and closed tasks, and
 * `call_logs` appeared nowhere on the page at all. A rep asking when we last
 * spoke to someone had to leave the lead and go to /CallAnalytics.
 *
 * This module normalizes both tables into one shape and merges them, so a
 * caller renders contact history without having to know which table a given
 * conversation happened to land in.
 */

import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';

/**
 * Every outcome code either table can carry, in Hebrew.
 *
 * The first block is `call_logs.call_result` (Voicenter's dial status, mapped
 * server-side), the second is `communication_logs.outcome` (what the rep
 * picked in the dialog). Wording matches StatusBadge for the codes both know,
 * so the same call never reads one way here and another way in /CallAnalytics.
 */
export const CONTACT_OUTCOME_LABELS = {
  answered_positive: 'מעוניין',
  answered_neutral: 'נייטרלי',
  answered_negative: 'שלילי',
  no_answer: 'לא ענה',
  busy: 'תפוס',
  voicemail_left: 'הודעה',
  callback_requested: 'התקשרות חוזרת',
  not_interested: 'לא מעוניין',
  // A click-to-call writes its row immediately and the sync fills in the
  // result minutes later. Until then the honest answer is "we don't know yet".
  pending: 'ממתין לעדכון',

  voicemail: 'הותיר הודעה',
  sent: 'נשלח',
};

export const contactOutcomeLabel = (code) => CONTACT_OUTCOME_LABELS[code] || code || '';

// Call length as m:ss. Anything falsy is "no duration recorded", not 0:00 —
// the caller decides whether to print it.
export function formatCallDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function toTimestamp(value) {
  return parseDbTimestamp(value)?.getTime() || 0;
}

/** A `call_logs` row in the shared shape. */
export function normalizeCallLog(row) {
  // call_started_at is when the conversation happened; created_date is when
  // the row was written, which for a CDR import can be days later.
  const at = row?.call_started_at || row?.created_date || null;
  return {
    logKey: `call-${row.id}`,
    id: row.id,
    source: 'phone',
    type: 'call',
    direction: row.call_direction || null,
    outcome: row.call_result || null,
    duration_seconds: row.call_duration_seconds || null,
    recording_url: row.recording_url || null,
    rep_id: row.rep_id || null,
    subject: '',
    content: '',
    notes: '',
    created_date: at,
    ts: toTimestamp(at),
  };
}

/** A `communication_logs` row in the shared shape. */
export function normalizeCommunicationLog(row) {
  return {
    logKey: `comm-${row.id}`,
    id: row.id,
    source: 'manual',
    type: row.type || 'call',
    direction: row.direction || null,
    outcome: row.outcome || null,
    duration_seconds: row.duration_seconds || null,
    recording_url: null,
    rep_id: row.rep_id || null,
    subject: row.subject || '',
    content: row.content || '',
    notes: row.notes || '',
    created_date: row.created_date || null,
    ts: toTimestamp(row.created_date),
  };
}

/**
 * Both logs as one newest-first list.
 *
 * Notes are left out by default: a note is something a rep wrote to
 * themselves, not a conversation with the customer, and the contact card
 * exists to answer "when did we last speak to him". The activity feed passes
 * `includeNotes` because there everything belongs.
 */
export function buildContactLog(calls, comms, { includeNotes = false } = {}) {
  const entries = [
    ...(calls || []).filter((row) => row?.id).map(normalizeCallLog),
    ...(comms || [])
      .filter((row) => row?.id && (includeNotes || row.type !== 'note'))
      .map(normalizeCommunicationLog),
  ];
  entries.sort((a, b) => b.ts - a.ts);
  return entries;
}
