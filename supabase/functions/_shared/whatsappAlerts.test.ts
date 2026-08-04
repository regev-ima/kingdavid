// Behavioural test for _shared/whatsappAlerts.ts.
//
//   deno run --no-remote supabase/functions/_shared/whatsappAlerts.test.ts
//
// WHY this exists when the repo has no test runner: the whole value of the
// disconnect alert is "exactly one message, at the right moment, naming the
// right rep". That property is invisible in code review and expensive to check
// in production, because checking it means sending real WhatsApp messages into
// the team's group. This file pins it down offline instead.
//
// The module under test imports nothing remote (greenApi.ts → phone.ts), so it
// runs with no network against a fake PostgREST builder and a stubbed fetch
// standing in for Green API. It exercises the decision logic, not the HTTP.
//
// The fake deliberately hands handleAccountState the SAME object it stores, so
// any write the function makes is visible to it mid-call — a harsher condition
// than production (where PostgREST returns copies). It caught a real bug that
// way: the "is this failure new?" check used to read a field the same call had
// already overwritten, which silently swallowed the first failure log.

import {
  handleAccountState, sweepAccounts, normalizeChatId, buildDisconnectMessage,
  maybeSendDailyDigest,
} from './whatsappAlerts.ts';

// ── Fake PostgREST ─────────────────────────────────────────────────────────
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};

class Q {
  table: string;
  op = 'select';
  payload: Row | null = null;
  filters: ((r: Row) => boolean)[] = [];
  wantRows = false;
  single = false;
  constructor(table: string) { this.table = table; }

  select() { if (this.op === 'update' || this.op === 'insert') this.wantRows = true; return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, _op: string, v: any) { this.filters.push((r) => (r[c] ?? null) !== v); return this; }
  in(c: string, vals: any[]) { this.filters.push((r) => vals.includes(r[c])); return this; }

  // Chained filters AND together; .or() is one OR group among them — same as
  // PostgREST. Only the "col.op.value" forms this module actually uses.
  or(expr: string) {
    const clauses = expr.split(',').map((clause) => {
      const [col, op, ...rest] = clause.split('.');
      const val = rest.join('.');
      if (op === 'is') return (r: Row) => (r[col] ?? null) === (val === 'null' ? null : val);
      if (op === 'eq') return (r: Row) => String(r[col] ?? '') === val;
      if (op === 'neq') return (r: Row) => String(r[col] ?? '') !== val;
      throw new Error(`fake .or(): unsupported operator "${op}"`);
    });
    this.filters.push((r) => clauses.some((f) => f(r)));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.sortBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit() { return this; }
  maybeSingle() { this.single = true; return this.run(); }
  then(res: any, rej: any) { return this.run().then(res, rej); }

  sortBy: { col: string; asc: boolean } | null = null;

  run(): Promise<{ data: any; error: any }> {
    const rows = db[this.table] ||= [];
    if (this.op === 'insert') {
      rows.push({ ...this.payload });
      return Promise.resolve({ data: this.wantRows ? [this.payload] : null, error: null });
    }
    const hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.sortBy) {
      const { col, asc } = this.sortBy;
      hit.sort((a, b) => {
        const x = String(a[col] ?? ''), y = String(b[col] ?? '');
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (this.op === 'update') {
      hit.forEach((r) => Object.assign(r, this.payload));
      return Promise.resolve({ data: this.wantRows ? hit : null, error: null });
    }
    return Promise.resolve({
      data: this.single ? (hit[0] ? { ...hit[0] } : null) : hit.map((r) => ({ ...r })),
      error: null,
    });
  }
}
const svc = { from: (t: string) => new Q(t) } as any;

// ── Fake Green API ─────────────────────────────────────────────────────────
let sent: { chatId: string; message: string }[] = [];
let instanceStates: Record<string, string | null> = {};   // instance → state, null = unreachable
globalThis.fetch = ((url: string, init?: RequestInit) => {
  const m = String(url).match(/waInstance(\d+)\/(\w+)\//);
  const [, instance, method] = m!;
  if (method === 'getStateInstance') {
    const st = instanceStates[instance];
    if (st === null) return Promise.resolve(new Response('nope', { status: 500 }));
    return Promise.resolve(new Response(JSON.stringify({ stateInstance: st }), { status: 200 }));
  }
  if (method === 'sendMessage') {
    const body = JSON.parse(String(init?.body || '{}'));
    sent.push({ chatId: body.chatId, message: body.message });
    return Promise.resolve(new Response(JSON.stringify({ idMessage: `msg${sent.length}` }), { status: 200 }));
  }
  return Promise.resolve(new Response('{}', { status: 200 }));
}) as any;

// ── Fixtures ───────────────────────────────────────────────────────────────
const GROUP = '120363410077585252@g.us';
function reset() {
  sent = [];
  db.whatsapp_alert_log = [];
  instanceStates = { '111': 'notAuthorized', '222': 'authorized', '333': 'notAuthorized' };
  db.whatsapp_alert_settings = [{
    id: 1, enabled: true, notifier_user_id: 'u-maayan', group_chat_id: GROUP,
    cooldown_minutes: 60, notify_on_recovery: true, monitor_token: 'tok',
    daily_digest: true, digest_hour: 0, digest_last_sent_on: null,
  }];
  db.users = [
    { id: 'u-elad', full_name: 'אלעד', email: 'elad@x.com' },
    { id: 'u-maayan', full_name: 'מעיין כהן', email: 'maayan@x.com' },
    { id: 'u-new', full_name: 'נציג חדש', email: 'new@x.com' },
  ];
  db.whatsapp_accounts = [
    { id: 'a-elad', user_id: 'u-elad', instance_id: '111', api_token: 't1', state: 'authorized',
      phone: '972501111111', is_active: true, was_authorized: true, disconnected_since: null,
      alerted_since: null, alert_sent_at: null, alert_error: null, alerts_muted: false },
    { id: 'a-maayan', user_id: 'u-maayan', instance_id: '222', api_token: 't2', state: 'authorized',
      phone: '972502222222', is_active: true, was_authorized: true, disconnected_since: null,
      alerted_since: null, alert_sent_at: null, alert_error: null, alerts_muted: false },
    { id: 'a-new', user_id: 'u-new', instance_id: '333', api_token: 't3', state: 'notAuthorized',
      phone: null, is_active: true, was_authorized: false, disconnected_since: null,
      alerted_since: null, alert_sent_at: null, alert_error: null, alerts_muted: false },
  ];
}
const acc = (id: string) => db.whatsapp_accounts.find((r) => r.id === id)!;
const logs = () => db.whatsapp_alert_log || [];

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : `  → ${detail}`}`);
  if (!cond) failures++;
}

// ── 1. Live webhook: a linked rep drops ────────────────────────────────────
reset();
let r = await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');
check('drop → alert sent', r.action === 'sent', r.action);
check('one message to the group', sent.length === 1 && sent[0].chatId === GROUP, JSON.stringify(sent));
check("message names the rep", sent[0]?.message.includes('אלעד'), sent[0]?.message);
check('message says why', sent[0]?.message.includes('לא מאומת'), sent[0]?.message);
check('outage recorded', !!acc('a-elad').disconnected_since && !!acc('a-elad').alerted_since);
check('logged once, ok', logs().length === 1 && logs()[0].ok === true && logs()[0].kind === 'disconnected');

// ── 2. Same outage seen again by the sweep → silence ───────────────────────
r = await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'sweep');
check('re-observation stays quiet', r.action === 'skipped_already_alerted' && sent.length === 1, r.action);

// ── 3. Recovery ────────────────────────────────────────────────────────────
r = await handleAccountState(svc, acc('a-elad'), 'authorized', 'webhook');
check('recovery announced', r.action === 'recovered' && sent.length === 2, r.action);
check('recovery names the rep', sent[1]?.message.includes('אלעד') && sent[1].message.includes('מחובר שוב'), sent[1]?.message);
check('bookkeeping cleared', !acc('a-elad').disconnected_since && !acc('a-elad').alerted_since);

// ── 4. A rep who was never linked is not "disconnected" ────────────────────
reset();
r = await handleAccountState(svc, acc('a-new'), 'notAuthorized', 'sweep');
check('never-linked rep is silent', r.action === 'skipped_never_linked' && sent.length === 0, r.action);

// ── 5. `starting` is transient, not an outage worth announcing ─────────────
reset();
r = await handleAccountState(svc, acc('a-elad'), 'starting', 'sweep');
check('starting is silent', r.action === 'skipped_transient' && sent.length === 0, r.action);
check('but the outage clock starts', !!acc('a-elad').disconnected_since);

// ── 6. Muted rep ───────────────────────────────────────────────────────────
reset();
acc('a-elad').alerts_muted = true;
r = await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'sweep');
check('muted rep is silent', r.action === 'skipped_muted' && sent.length === 0, r.action);

// ── 7. The notifier's own phone is down → alert is deferred, not lost ──────
reset();
acc('a-maayan').state = 'notAuthorized';
instanceStates['222'] = 'notAuthorized';
r = await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');
check('no send while notifier is down', r.action === 'send_failed' && sent.length === 0, r.action);
check('claim released for retry', acc('a-elad').alerted_since === null, String(acc('a-elad').alerted_since));
check('failure logged once', logs().length === 1 && logs()[0].ok === false, JSON.stringify(logs()));
// ...notifier comes back, next sweep tick delivers the pending alert
acc('a-maayan').state = 'authorized';
instanceStates['222'] = 'authorized';
r = await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'sweep');
check('pending alert delivered on retry', r.action === 'sent' && sent.length === 1, r.action);
check('repeat failure not re-logged, success is', logs().length === 2);

// ── 8. Flap suppression ────────────────────────────────────────────────────
reset();
await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');   // alert #1
await handleAccountState(svc, acc('a-elad'), 'authorized', 'webhook');      // recovery
await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');   // drops again
check('flap within cooldown suppressed', sent.length === 2, `sent=${sent.length}`);
// with the cooldown off, the second drop does get announced
reset();
db.whatsapp_alert_settings[0].cooldown_minutes = 0;
await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');
await handleAccountState(svc, acc('a-elad'), 'authorized', 'webhook');
await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');
check('cooldown 0 → second drop announced', sent.length === 3, `sent=${sent.length}`);

// ── 9. Alerts switched off ─────────────────────────────────────────────────
reset();
db.whatsapp_alert_settings[0].enabled = false;
r = await handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook');
check('disabled → silent', r.action === 'skipped_disabled' && sent.length === 0, r.action);

// ── 10. Simultaneous webhook + sweep must not double-send ──────────────────
reset();
const both = await Promise.all([
  handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'webhook'),
  handleAccountState(svc, acc('a-elad'), 'notAuthorized', 'sweep'),
]);
check('race sends exactly one message', sent.length === 1, `sent=${sent.length} ${both.map((b) => b.action)}`);

// ── 11. Full sweep, including an unreachable instance ──────────────────────
reset();
db.whatsapp_alert_settings[0].daily_digest = false;   // digest has its own section
instanceStates['111'] = 'notAuthorized';   // elad dropped
instanceStates['333'] = null;              // green api unreachable for this one
const sum = await sweepAccounts(svc, 'sweep');
check('sweep checked every account', sum.checked === 3, JSON.stringify(sum));
check('sweep alerted on the real drop', sum.sent === 1 && sent.length === 1, JSON.stringify(sum));
check('unreachable instance never alerts', sum.unreachable === 1, JSON.stringify(sum));
check('unreachable state left untouched', acc('a-new').state === 'notAuthorized');

// ── 12. The daily digest ───────────────────────────────────────────────────
// digest_hour is 0 in the fixture, so the digest is always "due" and the tests
// don't depend on what time they run at.
const israelHour = Number(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23',
}).format(new Date())) % 24;

// Nobody down → total silence. A daily "all fine" would train people to ignore it.
reset();
let dig = await maybeSendDailyDigest(svc);
check('digest silent when everyone is connected', !dig.sent && dig.reason === 'all_connected', JSON.stringify(dig));

// Two reps down → one message naming both, oldest outage first.
reset();
acc('a-elad').disconnected_since = new Date(Date.now() - 3 * 3600_000).toISOString();
acc('a-new').was_authorized = true;
acc('a-new').disconnected_since = new Date(Date.now() - 40 * 60_000).toISOString();
dig = await maybeSendDailyDigest(svc);
check('digest sent as ONE message', dig.sent && dig.count === 2 && sent.length === 1, JSON.stringify(dig));
check('digest names both reps', sent[0]?.message.includes('אלעד') && sent[0].message.includes('נציג חדש'), sent[0]?.message);
check('digest reports how long', sent[0]?.message.includes('3 שעות') && sent[0].message.includes('40 דקות'), sent[0]?.message);
check('digest oldest outage first',
  sent[0].message.indexOf('אלעד') < sent[0].message.indexOf('נציג חדש'), sent[0]?.message);
check('digest logged', logs().some((l: any) => l.kind === 'digest' && l.ok === true));

// Once per day, no matter how many sweeps run.
dig = await maybeSendDailyDigest(svc);
check('digest sends once a day', !dig.sent && dig.reason === 'already_sent_today' && sent.length === 1, JSON.stringify(dig));

// Muted reps stay out of it — mute means mute everywhere.
reset();
acc('a-elad').disconnected_since = new Date(Date.now() - 3600_000).toISOString();
acc('a-elad').alerts_muted = true;
dig = await maybeSendDailyDigest(svc);
check('digest excludes muted reps', !dig.sent && dig.reason === 'all_connected', JSON.stringify(dig));

// Before the configured hour, nothing goes out.
if (israelHour < 23) {
  reset();
  db.whatsapp_alert_settings[0].digest_hour = israelHour + 1;
  acc('a-elad').disconnected_since = new Date().toISOString();
  dig = await maybeSendDailyDigest(svc);
  check('digest waits for its hour', !dig.sent && dig.reason === 'too_early', JSON.stringify(dig));
} else {
  check('digest waits for its hour (skipped — it is 23:xx in Israel)', true);
}

// "Send now" ignores the hour AND must not swallow the scheduled one.
reset();
db.whatsapp_alert_settings[0].digest_hour = 23;
acc('a-elad').disconnected_since = new Date().toISOString();
dig = await maybeSendDailyDigest(svc, undefined, true);
check('force sends regardless of the hour', dig.sent && sent.length === 1, JSON.stringify(dig));
check("force doesn't consume today's slot",
  db.whatsapp_alert_settings[0].digest_last_sent_on == null,
  String(db.whatsapp_alert_settings[0].digest_last_sent_on));

// Switched off → silent, even with someone down.
reset();
db.whatsapp_alert_settings[0].daily_digest = false;
acc('a-elad').disconnected_since = new Date().toISOString();
dig = await maybeSendDailyDigest(svc);
check('digest off → silent', !dig.sent && dig.reason === 'disabled', JSON.stringify(dig));

// The scheduled sweep carries it; the admin's "check now" button must not.
reset();
instanceStates['111'] = 'notAuthorized';
const sum2 = await sweepAccounts(svc, 'sweep');
check('scheduled sweep sends alert + digest', sum2.sent === 1 && sum2.digest?.sent === true && sent.length === 2,
  `${JSON.stringify(sum2.digest)} sent=${sent.length}`);
reset();
instanceStates['111'] = 'notAuthorized';
const sum3 = await sweepAccounts(svc, 'ui');
check('manual check never broadcasts a digest', sum3.digest === undefined && sent.length === 1,
  `${JSON.stringify(sum3.digest)} sent=${sent.length}`);

// ── 13. Pure helpers ───────────────────────────────────────────────────────
check('bare group id gets @g.us', normalizeChatId('120363410077585252') === GROUP);
check('bare phone gets @c.us', normalizeChatId('972501111111') === '972501111111@c.us');
check('existing suffix untouched', normalizeChatId(GROUP) === GROUP);
check('blank stays blank', normalizeChatId('') === '');
check('message carries the name', buildDisconnectMessage({ name: 'רונית', state: 'sleepMode' }).includes('רונית'));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures) Deno.exit(1);
