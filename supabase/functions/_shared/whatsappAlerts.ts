// "A rep's WhatsApp dropped off Green API" → one WhatsApp message to the team
// group, sent through a nominated rep's own Green API instance.
//
// This module is the single decision point. Three callers feed it a state and
// it decides whether that state deserves a message:
//
//   greenApiWebhook       — stateInstanceChanged, the LIVE path. Green API
//                           pushes this the moment the phone unlinks, so the
//                           group is told within a second or two.
//   greenApiStateMonitor  — the scheduled sweep. A backstop for the case the
//                           webhook never arrives (instance stopped delivering,
//                           our function was down, the state changed while the
//                           webhook config was broken).
//   greenApiSettings      — 'check' / 'connect' / 'qr', i.e. someone looked at
//                           the rep's connection screen. Free extra coverage.
//
// The condition we alert on is narrow on purpose: the instance ANSWERS and
// reports a state that is not `authorized`. That means Green API itself is
// fine and the rep's phone is what dropped — exactly the situation asked for.
// A Green API call that fails outright (network, revoked token) tells us
// nothing about the phone and never raises an alert.
//
// Alerting is once-per-outage, not once-per-event:
//   disconnected_since  identifies the current outage,
//   alerted_since       records the outage we already announced,
//   alert_attempt_at    throttles retries after a failed send,
//   cooldown_minutes    suppresses a phone that flaps every few minutes.

import { callGreenApi, getStateInstance, sendTextMessage, type GreenAccount } from './greenApi.ts';

/** Green states that mean "the phone is not linked / not usable right now". */
const ALERTABLE_STATES = new Set(['notAuthorized', 'blocked', 'sleepMode', 'yellowCard']);

// `starting` is deliberately absent: it's the transient boot state Green
// reports right after an instance is created or restarted, and it resolves to
// authorized on its own within seconds. It still counts as "not connected"
// (the outage clock starts), it just doesn't produce a message.

export function stateLabelHe(state?: string | null): string {
  return ({
    authorized: 'מחובר',
    notAuthorized: 'לא מאומת (המכשיר נותק)',
    blocked: 'חסום',
    sleepMode: 'מצב שינה (הטלפון כבוי או ללא אינטרנט)',
    starting: 'מתחיל',
    yellowCard: 'מוגבל זמנית (Yellow Card)',
  } as Record<string, string>)[state || ''] || state || 'לא ידוע';
}

export function isConnectedState(state?: string | null): boolean {
  return state === 'authorized';
}

export function isAlertableState(state?: string | null): boolean {
  return ALERTABLE_STATES.has(state || '');
}

/**
 * Green API chatId from whatever the admin typed. A bare group id (18-ish
 * digits) gets @g.us; a bare phone gets @c.us; anything already carrying a
 * suffix is left alone.
 */
export function normalizeChatId(value?: string | null): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 15 ? `${digits}@g.us` : `${digits}@c.us`;
}

export interface AlertSettings {
  id: number;
  enabled: boolean;
  notifier_user_id: string | null;
  group_chat_id: string;
  cooldown_minutes: number;
  notify_on_recovery: boolean;
  monitor_token: string;
  daily_digest: boolean;
  digest_hour: number;
  digest_last_sent_on: string | null;   // Israel-local date, 'YYYY-MM-DD'
}

export async function loadAlertSettings(svc: any): Promise<AlertSettings | null> {
  const { data } = await svc.from('whatsapp_alert_settings').select('*').eq('id', 1).maybeSingle();
  return data || null;
}

function ilTime(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** "17 דקות" / "3 שעות ו-12 דקות" — how long the outage lasted. */
function durationHe(fromIso?: string | null, toIso?: string | null): string {
  if (!fromIso) return '';
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const mins = Math.max(0, Math.round((to - from) / 60000));
  if (mins < 1) return 'פחות מדקה';
  if (mins < 60) return `${mins} דקות`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const hoursTxt = hours === 1 ? 'שעה' : `${hours} שעות`;
  return rest ? `${hoursTxt} ו-${rest} דקות` : hoursTxt;
}

/**
 * The date and hour as they are RIGHT NOW in Israel.
 *
 * The digest hour is a wall-clock time the team recognises ("09:00"), so it has
 * to be evaluated in Asia/Jerusalem — deriving it from UTC would silently shift
 * it by an hour twice a year when DST flips.
 */
function israelNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    // h23 gives 00–23, but guard anyway: some ICU builds still emit "24".
    hour: Number(get('hour')) % 24,
  };
}

async function repName(svc: any, userId?: string | null): Promise<string> {
  if (!userId) return 'נציג לא מזוהה';
  const { data } = await svc.from('users').select('full_name, email').eq('id', userId).maybeSingle();
  return data?.full_name || data?.email || 'נציג לא מזוהה';
}

export function buildDisconnectMessage(opts: {
  name: string;
  state?: string | null;
  phone?: string | null;
  since?: string | null;
}): string {
  const lines = [
    '🔴 *ניתוק וואטסאפ*',
    '',
    `הוואטסאפ של *${opts.name}* התנתק.`,
    `סטטוס: ${stateLabelHe(opts.state)}`,
  ];
  if (opts.phone) lines.push(`מספר: ${opts.phone}`);
  lines.push(`זמן הניתוק: ${ilTime(opts.since)}`);
  lines.push('');
  lines.push('עד לחיבור מחדש לא נקלטות הודעות מהנציג ולא ניתן לשלוח מהמערכת.');
  lines.push('לחיבור: המערכת ← נהל נציג ← וואטסאפ ← "חבר מכשיר (QR)".');
  return lines.join('\n');
}

export function buildRecoveryMessage(opts: { name: string; since?: string | null }): string {
  const dur = durationHe(opts.since);
  return [
    '🟢 *הוואטסאפ חזר*',
    '',
    `הוואטסאפ של *${opts.name}* מחובר שוב${dur ? ` (היה מנותק ${dur})` : ''}.`,
  ].join('\n');
}

export interface DigestEntry {
  name: string;
  state?: string | null;
  since?: string | null;
}

/**
 * The once-a-day roll-call of everyone still down. Sorted oldest-outage-first
 * by the caller, so the rep who has been disconnected longest reads first —
 * that's the one costing the most.
 */
export function buildDigestMessage(entries: DigestEntry[]): string {
  const lines = [
    '📋 *סיכום יומי — וואטסאפ מנותק*',
    '',
    entries.length === 1 ? 'נציג אחד מנותק כרגע:' : `${entries.length} נציגים מנותקים כרגע:`,
  ];
  for (const e of entries) {
    const dur = durationHe(e.since);
    lines.push(`• *${e.name}* — ${stateLabelHe(e.state)}${dur ? ` · מנותק ${dur}` : ''}`);
  }
  lines.push('');
  lines.push('כל עוד הם מנותקים לא נקלטות מהם הודעות ולא ניתן לשלוח מהמערכת.');
  lines.push('לחיבור: נהל נציג ← וואטסאפ ← "חבר מכשיר (QR)".');
  return lines.join('\n');
}

export interface SendOutcome {
  ok: boolean;
  idMessage?: string;
  error?: string;
  chatId?: string;
}

/**
 * Send one alert into the group through the nominated rep's instance.
 *
 * The notifier is a normal rep account, so it can be down too. When it is, we
 * DON'T pretend the alert went out: the caller leaves the outage un-announced
 * and the next webhook/sweep tries again, which means a pending alert survives
 * until the notifier's own WhatsApp is back.
 */
async function sendGroupAlert(
  svc: any,
  settings: AlertSettings,
  message: string,
): Promise<SendOutcome> {
  const chatId = normalizeChatId(settings.group_chat_id);
  if (!chatId) return { ok: false, error: 'group_chat_id_missing' };
  if (!settings.notifier_user_id) return { ok: false, error: 'notifier_not_set', chatId };

  const { data: notifier } = await svc
    .from('whatsapp_accounts')
    .select('*')
    .eq('user_id', settings.notifier_user_id)
    .maybeSingle();

  if (!notifier?.instance_id || !notifier?.api_token) {
    return { ok: false, error: 'notifier_not_configured', chatId };
  }

  // Confirm the notifier can actually send before we burn the alert on it.
  // Trust a cached 'authorized' only as a starting point — re-read when it's
  // anything else, since a stale row is exactly how an alert gets lost.
  let notifierState = notifier.state;
  if (notifierState !== 'authorized') {
    const fresh = await getStateInstance(notifier as GreenAccount);
    notifierState = fresh.data?.stateInstance || notifierState;
    await svc.from('whatsapp_accounts')
      .update({ state: notifierState, last_state_at: new Date().toISOString() })
      .eq('id', notifier.id);
  }
  if (notifierState !== 'authorized') {
    return { ok: false, error: `notifier_not_authorized:${notifierState || 'unknown'}`, chatId };
  }

  const res = await sendTextMessage(notifier as GreenAccount, chatId, message);
  if (!res.ok || !res.data?.idMessage) {
    const detail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
    return { ok: false, error: `green_send_failed:${res.status}:${detail.slice(0, 200)}`, chatId };
  }
  return { ok: true, idMessage: String(res.data.idMessage), chatId };
}

async function logAlert(svc: any, row: Record<string, unknown>) {
  const { error } = await svc.from('whatsapp_alert_log').insert(row);
  if (error) console.error('[whatsappAlerts] log insert failed', error);
}

export type AlertAction =
  | 'sent'
  | 'recovered'
  | 'send_failed'
  | 'skipped_disabled'
  | 'skipped_muted'
  | 'skipped_never_linked'
  | 'skipped_transient'
  | 'skipped_already_alerted'
  | 'skipped_cooldown'
  | 'noop';

export interface AlertResult {
  action: AlertAction;
  state?: string | null;
  error?: string;
}

/**
 * Decide and act on one account's freshly-observed state.
 *
 * `account` is the whatsapp_accounts row as it was BEFORE this observation —
 * the caller is expected to have persisted the new state already (or not; we
 * only write the alert bookkeeping columns here, never `state` itself).
 */
export async function handleAccountState(
  svc: any,
  account: any,
  state: string | null | undefined,
  source: 'webhook' | 'sweep' | 'check' | 'ui',
  settingsIn?: AlertSettings | null,
): Promise<AlertResult> {
  if (!account?.id || !state) return { action: 'noop', state };
  // A cleared / deactivated account isn't "disconnected", it's detached.
  if (!account.instance_id || account.is_active === false) return { action: 'noop', state };

  const settings = settingsIn !== undefined ? settingsIn : await loadAlertSettings(svc);
  const now = new Date();
  const nowIso = now.toISOString();
  // Snapshot before any write below: the "is this failure new?" test at the end
  // must compare against the state we were handed, not against what this same
  // call has since written to the row.
  const previousError: string | null = account.alert_error ?? null;

  // ── Connected ────────────────────────────────────────────────────────────
  if (isConnectedState(state)) {
    const patch: Record<string, unknown> = {};
    if (!account.was_authorized) patch.was_authorized = true;

    if (account.disconnected_since) {
      // The outage is over. Clear it either way; announce it only if the group
      // was told about the outage in the first place.
      const since = account.disconnected_since;
      const announced = !!account.alerted_since;
      Object.assign(patch, {
        disconnected_since: null,
        alerted_since: null,
        alert_state: null,
        alert_error: null,
      });
      // Same compare-and-swap as the disconnect side: whoever manages to clear
      // disconnected_since owns the recovery message, so a webhook and a sweep
      // arriving together produce one "back online", not two.
      const { data: closed } = await svc
        .from('whatsapp_accounts')
        .update(patch)
        .eq('id', account.id)
        .not('disconnected_since', 'is', null)
        .select('id');
      if (!closed || closed.length === 0) return { action: 'noop', state };

      if (!announced) return { action: 'noop', state };
      if (!settings?.enabled || !settings.notify_on_recovery) return { action: 'skipped_disabled', state };
      if (account.alerts_muted) return { action: 'skipped_muted', state };

      const name = await repName(svc, account.user_id);
      const message = buildRecoveryMessage({ name, since });
      const out = await sendGroupAlert(svc, settings, message);
      await logAlert(svc, {
        account_id: account.id,
        user_id: account.user_id,
        rep_name: name,
        kind: 'recovered',
        state,
        source,
        chat_id: out.chatId || settings.group_chat_id,
        message,
        green_message_id: out.idMessage || null,
        ok: out.ok,
        error: out.error || null,
      });
      return out.ok
        ? { action: 'recovered', state }
        : { action: 'send_failed', state, error: out.error };
    }

    if (Object.keys(patch).length > 0) {
      await svc.from('whatsapp_accounts').update(patch).eq('id', account.id);
    }
    return { action: 'noop', state };
  }

  // ── Not connected ────────────────────────────────────────────────────────
  // Open the outage on first sight so the clock (and the message) reports when
  // it actually started rather than when we got around to alerting.
  const disconnectedSince: string = account.disconnected_since || nowIso;
  if (!account.disconnected_since) {
    // Guarded so a concurrent observer that got here first keeps its (earlier)
    // start time rather than having it overwritten a few milliseconds later.
    await svc.from('whatsapp_accounts')
      .update({ disconnected_since: disconnectedSince })
      .eq('id', account.id)
      .is('disconnected_since', null);
  }

  // An instance that has never been linked isn't a disconnection — it's a
  // setup in progress. Announcing it would be wrong and confusing.
  if (!account.was_authorized) return { action: 'skipped_never_linked', state };
  if (!isAlertableState(state)) return { action: 'skipped_transient', state };
  if (account.alerts_muted) return { action: 'skipped_muted', state };
  if (!settings?.enabled) return { action: 'skipped_disabled', state };

  // Already announced THIS outage — nothing more to say until it ends.
  if (account.alerted_since && account.alerted_since === disconnectedSince) {
    return { action: 'skipped_already_alerted', state };
  }

  // Flap suppression. Applies to a successful send (alert_sent_at); a failed
  // attempt is retried on the next tick, because the usual reason for failure
  // is the notifier's own phone being briefly down and we don't want to sit on
  // a real outage for an hour waiting it out.
  const cooldownMs = Math.max(0, Number(settings.cooldown_minutes ?? 60)) * 60_000;
  if (cooldownMs > 0 && account.alert_sent_at) {
    const elapsed = now.getTime() - new Date(account.alert_sent_at).getTime();
    if (elapsed < cooldownMs) return { action: 'skipped_cooldown', state };
  }

  // Claim the outage BEFORE sending. The live webhook and the scheduled sweep
  // can observe the same drop in the same second, and a plain read-then-write
  // would let both of them send. `.is('alerted_since', null)` makes this a
  // compare-and-swap: exactly one caller gets a row back and does the sending.
  // (alerted_since is only ever non-null for the current outage — recovery
  // clears it together with disconnected_since.)
  const { data: claimed } = await svc
    .from('whatsapp_accounts')
    .update({ alerted_since: disconnectedSince, alert_attempt_at: nowIso, alert_state: state })
    .eq('id', account.id)
    .is('alerted_since', null)
    .select('id');
  if (!claimed || claimed.length === 0) return { action: 'skipped_already_alerted', state };

  const name = await repName(svc, account.user_id);
  const message = buildDisconnectMessage({
    name,
    state,
    phone: account.phone,
    since: disconnectedSince,
  });
  const out = await sendGroupAlert(svc, settings, message);

  // Release the claim when the send failed, so the next webhook/sweep tries
  // again. The usual reason for failure is the notifier's OWN phone being
  // down — a real outage must not stay unannounced because of that, so this
  // retries on the next tick rather than waiting out the cooldown.
  await svc.from('whatsapp_accounts').update(
    out.ok
      ? { alert_sent_at: nowIso, alert_error: null }
      : { alerted_since: null, alert_error: out.error || 'unknown' },
  ).eq('id', account.id);

  // Log every send; log a failure only when it's new. A notifier that stays
  // down would otherwise write one identical failure row per sweep tick.
  const failureIsNew = !out.ok && previousError !== (out.error || 'unknown');
  if (out.ok || failureIsNew) {
    await logAlert(svc, {
      account_id: account.id,
      user_id: account.user_id,
      rep_name: name,
      kind: 'disconnected',
      state,
      source,
      chat_id: out.chatId || settings.group_chat_id,
      message,
      green_message_id: out.idMessage || null,
      ok: out.ok,
      error: out.error || null,
    });
  }

  return out.ok
    ? { action: 'sent', state }
    : { action: 'send_failed', state, error: out.error };
}

export interface SweepSummary {
  checked: number;
  unreachable: number;
  disconnected: number;
  sent: number;
  recovered: number;
  failed: number;
  digest?: DigestResult;
  results: Array<{ user_id: string; state: string | null; action: AlertAction; error?: string }>;
}

/**
 * Poll every configured account's live state and run each through
 * handleAccountState. This is the backstop behind the live webhook.
 *
 * An instance we can't reach at all is counted and skipped — we don't know
 * anything about the phone behind it, and its stored state is left untouched
 * rather than overwritten with a guess.
 */
export async function sweepAccounts(
  svc: any,
  source: 'sweep' | 'ui' = 'sweep',
): Promise<SweepSummary> {
  const settings = await loadAlertSettings(svc);
  const { data: accounts } = await svc
    .from('whatsapp_accounts')
    .select('*')
    .neq('instance_id', '')
    .eq('is_active', true);

  const summary: SweepSummary = {
    checked: 0, unreachable: 0, disconnected: 0, sent: 0, recovered: 0, failed: 0, results: [],
  };

  // Small batches: a handful of reps, one HTTP call each, and Green API is
  // happier with a few concurrent calls than with twenty at once.
  const BATCH = 5;
  const rows = (accounts || []).filter((a: any) => a.api_token);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const states = await Promise.all(batch.map(async (acc: any) => {
      try {
        const res = await getStateInstance(acc as GreenAccount);
        return { acc, ok: res.ok, state: res.data?.stateInstance || null };
      } catch (e) {
        console.warn('[whatsappAlerts] getStateInstance threw', acc.instance_id, e);
        return { acc, ok: false, state: null };
      }
    }));

    for (const { acc, ok, state } of states) {
      summary.checked++;
      // Green API itself is unreachable / rejecting us — that is NOT the
      // "rep's phone dropped" condition, so it never alerts.
      if (!ok || !state) {
        summary.unreachable++;
        summary.results.push({ user_id: acc.user_id, state: null, action: 'noop' });
        continue;
      }

      await svc.from('whatsapp_accounts')
        .update({ state, last_state_at: new Date().toISOString() })
        .eq('id', acc.id);

      if (!isConnectedState(state)) summary.disconnected++;

      const result = await handleAccountState(svc, acc, state, source, settings);
      if (result.action === 'sent') summary.sent++;
      else if (result.action === 'recovered') summary.recovered++;
      else if (result.action === 'send_failed') summary.failed++;
      summary.results.push({ user_id: acc.user_id, state, action: result.action, error: result.error });
    }
  }

  // The daily roll-call rides on the sweep — it runs after the states above are
  // fresh, so it reports what is true now rather than what was true last pass.
  // Only the scheduled sweep carries it: the admin's "בדוק עכשיו" button is for
  // checking, and shouldn't broadcast to the whole group as a side effect.
  if (source === 'sweep') {
    try {
      summary.digest = await maybeSendDailyDigest(svc);
    } catch (e) {
      console.error('[whatsappAlerts] daily digest failed', e);
    }
  }

  return summary;
}

export interface DigestResult {
  sent: boolean;
  reason?: 'disabled' | 'too_early' | 'already_sent_today' | 'all_connected' | 'send_failed' | 'settings_missing';
  count?: number;
  error?: string;
}

/**
 * The daily "who is STILL disconnected" roll-call.
 *
 * The per-outage alert fires once and then goes quiet, which is right for noise
 * but wrong for memory — a 🔴 nobody read at 02:00 leaves a rep down for days.
 * This is the counterweight, shaped so it cannot become the noise it's guarding
 * against: at most ONE extra message per day, however many reps are down and
 * however long they stay down.
 *
 * Called from the scheduled sweep, so the first pass at or after digest_hour
 * (Israel time) delivers it. `force` is the admin's "send now" button, which
 * bypasses the schedule without consuming the day's slot.
 */
export async function maybeSendDailyDigest(
  svc: any,
  settingsIn?: AlertSettings | null,
  force = false,
): Promise<DigestResult> {
  const settings = settingsIn !== undefined ? settingsIn : await loadAlertSettings(svc);
  if (!settings) return { sent: false, reason: 'settings_missing' };

  if (!force) {
    if (!settings.enabled || !settings.daily_digest) return { sent: false, reason: 'disabled' };

    const { date, hour } = israelNow();
    if (hour < (settings.digest_hour ?? 9)) return { sent: false, reason: 'too_early' };
    if (settings.digest_last_sent_on === date) return { sent: false, reason: 'already_sent_today' };

    // Claim the day BEFORE building the message. Sweeps can overlap (a late run
    // piling onto a slow one), and without this both would send.
    //
    // Claiming even when it turns out nobody is disconnected is deliberate: the
    // digest is a daily roll-call, not a trigger. If everyone was fine at 09:00
    // we don't want it firing again at 09:10 — and a rep who drops at 14:00
    // gets the immediate 🔴 anyway.
    const { data: claimed } = await svc
      .from('whatsapp_alert_settings')
      .update({ digest_last_sent_on: date })
      .eq('id', 1)
      .or(`digest_last_sent_on.is.null,digest_last_sent_on.neq.${date}`)
      .select('id');
    if (!claimed || claimed.length === 0) return { sent: false, reason: 'already_sent_today' };
  }

  // Everyone currently in an outage, oldest first. Muted reps are excluded —
  // mute means "stop telling me about this one", in the digest too.
  const { data: down } = await svc
    .from('whatsapp_accounts')
    .select('user_id, state, disconnected_since')
    .neq('instance_id', '')
    .eq('is_active', true)
    .eq('was_authorized', true)
    .eq('alerts_muted', false)
    .not('disconnected_since', 'is', null)
    .order('disconnected_since', { ascending: true });

  const rows = down || [];
  // Silence is the good state. A daily "everything is fine" would train the
  // group to scroll past the day it isn't.
  if (rows.length === 0) return { sent: false, reason: 'all_connected', count: 0 };

  // One query for the names rather than one per row.
  const ids = rows.map((r: any) => r.user_id).filter(Boolean);
  const { data: users } = await svc.from('users').select('id, full_name, email').in('id', ids);
  const nameOf = new Map((users || []).map((u: any) => [u.id, u.full_name || u.email]));

  const entries: DigestEntry[] = rows.map((r: any) => ({
    name: nameOf.get(r.user_id) || 'נציג לא מזוהה',
    state: r.state,
    since: r.disconnected_since,
  }));

  const message = buildDigestMessage(entries);
  const out = await sendGroupAlert(svc, settings, message);
  await logAlert(svc, {
    account_id: null,
    user_id: null,
    rep_name: entries.map((e) => e.name).join(', '),
    kind: 'digest',
    state: null,
    source: force ? 'ui' : 'sweep',
    chat_id: out.chatId || settings.group_chat_id,
    message,
    green_message_id: out.idMessage || null,
    ok: out.ok,
    error: out.error || null,
  });

  return out.ok
    ? { sent: true, count: entries.length }
    : { sent: false, reason: 'send_failed', count: entries.length, error: out.error };
}

/**
 * Send a test message to the configured group, so an admin can prove the whole
 * path (notifier instance → group) works without waiting for a real outage.
 */
export async function sendTestAlert(svc: any, actor?: string | null): Promise<SendOutcome> {
  const settings = await loadAlertSettings(svc);
  if (!settings) return { ok: false, error: 'settings_missing' };

  const name = await repName(svc, settings.notifier_user_id);
  const message = [
    '🧪 *בדיקת התראות וואטסאפ*',
    '',
    'זו הודעת בדיקה ממערכת King David. אם היא הגיעה לקבוצה — התראות ניתוק וואטסאפ יעבדו.',
    `נשלח מהמכשיר של: ${name}`,
    `זמן: ${ilTime()}`,
  ].join('\n');

  const out = await sendGroupAlert(svc, settings, message);
  await logAlert(svc, {
    account_id: null,
    user_id: settings.notifier_user_id,
    rep_name: name,
    kind: 'test',
    state: null,
    source: 'ui',
    chat_id: out.chatId || settings.group_chat_id,
    message,
    green_message_id: out.idMessage || null,
    ok: out.ok,
    error: out.error ? `${out.error}${actor ? ` (by ${actor})` : ''}` : null,
  });
  return out;
}

/**
 * Resolve the notifier's group membership question the only way Green API can
 * answer it: ask the instance for the group's data. Used by the settings screen
 * to tell an admin "this id is a real group and your notifier is in it" before
 * they rely on it in production.
 */
export async function describeGroup(svc: any, settings: AlertSettings) {
  const chatId = normalizeChatId(settings.group_chat_id);
  if (!chatId.endsWith('@g.us')) return { ok: false, error: 'not_a_group_id', chat_id: chatId };
  if (!settings.notifier_user_id) return { ok: false, error: 'notifier_not_set', chat_id: chatId };

  const { data: notifier } = await svc
    .from('whatsapp_accounts').select('*')
    .eq('user_id', settings.notifier_user_id).maybeSingle();
  if (!notifier?.instance_id || !notifier?.api_token) {
    return { ok: false, error: 'notifier_not_configured', chat_id: chatId };
  }

  const res = await callGreenApi(notifier as GreenAccount, 'getGroupData', { groupId: chatId });
  if (!res.ok || !res.data?.groupName) {
    return { ok: false, error: 'group_lookup_failed', chat_id: chatId, details: res.data ?? null };
  }
  return {
    ok: true,
    chat_id: chatId,
    group_name: res.data.groupName as string,
    participants: Array.isArray(res.data.participants) ? res.data.participants.length : null,
  };
}
