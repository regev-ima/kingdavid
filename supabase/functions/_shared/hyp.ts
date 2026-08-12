/**
 * Fields Hyp hands back with a card charge, and the plumbing to read them.
 *
 * Both hyp-verify (browser-triggered) and hyp-notify (server-to-server) see the
 * same transaction from different angles: a urlencoded reply from Hyp's own
 * VERIFY endpoint, a plain object of params Hyp appended to our return URL, or
 * a POSTed form body. They also disagree on casing between terminals — which is
 * why every read here goes through a case-insensitive, multi-name lookup rather
 * than `params.get('Payments')`.
 */

type FieldSource = URLSearchParams | Record<string, unknown> | null | undefined;

/** First present value among `names`, matched case-insensitively. */
export function readHypField(source: FieldSource, ...names: string[]): string | null {
  if (!source) return null;

  const entries: Array<[string, unknown]> =
    source instanceof URLSearchParams ? [...source.entries()] : Object.entries(source);

  for (const name of names) {
    const hit = entries.find(([k]) => k === name);
    if (hit && hit[1] != null) return String(hit[1]);
  }

  const lowered = new Map<string, string>();
  for (const [k, v] of entries) {
    if (v != null) lowered.set(k.toLowerCase(), String(v));
  }
  for (const name of names) {
    const v = lowered.get(name.toLowerCase());
    if (v !== undefined) return v;
  }
  return null;
}

// Names seen across Hyp/Yaad terminals for the same two values. Ordered
// most-likely-first; the lookup is case-insensitive so only spelling varies.
const PAYMENTS_COUNT_NAMES = ['Payments', 'Tashlumim', 'Tash', 'NumOfPayments', 'PaymentsNum'];
const ID_NUMBER_NAMES = ['UserId', 'ClientId', 'Uid', 'IdNumber', 'TZ'];

/**
 * How many installments the charge was split into ("מספר תשלומים").
 * Null when Hyp didn't say — never 0, so a caller can treat it as "unknown"
 * rather than printing a misleading zero on the order.
 */
export function readPaymentsCount(source: FieldSource): number | null {
  const raw = readHypField(source, ...PAYMENTS_COUNT_NAMES);
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * The payer's ת.ז. as Hyp collected it on the payment page.
 *
 * hyp-sign sends `UserId=000000000`, which is Hyp's "ask the payer for their
 * ID" placeholder — and terminals echo that back verbatim when the field was
 * never filled. An all-zeros value therefore means "not supplied", not "the
 * customer's ID is zero". Anything shorter than 5 digits is likewise a
 * placeholder rather than a real ID.
 */
export function readIdNumber(source: FieldSource): string {
  const raw = readHypField(source, ...ID_NUMBER_NAMES);
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits || /^0+$/.test(digits) || digits.length < 5) return '';
  return digits;
}

/**
 * Record a charge attempt that did not end in money on the order.
 *
 * Called from both hyp-notify (server-to-server) and hyp-verify (browser), so
 * an attempt is captured whichever channel hears about it first — and captured
 * once, keyed on Hyp's transaction Id the same way payments are.
 *
 * `status` is the honest distinction the rep needs:
 *   'declined' — Hyp told us it failed. The card was not charged.
 *   'unknown'  — we could not establish what happened. Needs checking.
 *
 * Writes to orders.payment_attempts, never to orders.payments: that array is
 * summed to decide what the order still owes, and an attempt is not money.
 *
 * Never throws. A payment flow must not fail because its audit trail did.
 */
export async function recordPaymentAttempt(
  supabase: any,
  order: { id: string; payment_attempts?: unknown },
  attempt: {
    hyp_transaction_id?: string | null;
    hyp_attempt_id?: string | null;
    status: 'declined' | 'unknown';
    ccode?: string | null;
    amount?: number | null;
    source: string;
    recorded_by?: string | null;
    hyp_params?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const existing: Array<Record<string, unknown>> =
      Array.isArray(order?.payment_attempts) ? order.payment_attempts : [];

    // Same idempotency rule as payments: Hyp retries its notify, and the
    // browser calls verify for the same transaction. One attempt, one row.
    const transactionId = attempt.hyp_transaction_id || '';
    if (transactionId && existing.some((a) => a?.hyp_transaction_id === transactionId)) return;

    const row = {
      ...attempt,
      hyp_transaction_id: transactionId || null,
      recorded_at: new Date().toISOString(),
    };

    const error = await updateOrderWithSchemaFallback(supabase, order.id, {
      payment_attempts: [...existing, row],
    });
    if (error) console.error('[hyp] failed to record payment attempt', error);
  } catch (err) {
    console.error('[hyp] recordPaymentAttempt threw', err);
  }
}

/**
 * Update an order, dropping a column the table doesn't have yet and retrying.
 *
 * These two functions record money. If `customer_id_number` reaches production
 * before its migration does, PostgREST rejects the whole UPDATE with PGRST204
 * and the payment itself would be lost — so a missing column degrades to "save
 * everything except that field" instead of failing the write. Mirrors
 * writeWithSchemaResilience() on the client.
 *
 * Returns the error when the update genuinely failed, or null on success.
 */
export async function updateOrderWithSchemaFallback(
  supabase: any,
  orderId: string,
  update: Record<string, unknown>,
): Promise<any | null> {
  const { error } = await supabase.from('orders').update(update).eq('id', orderId);
  if (!error) return null;

  const missing = error.code === 'PGRST204'
    ? /'([^']+)' column/.exec(error.message || '')?.[1]
    : null;
  if (!missing || !(missing in update)) return error;

  console.warn(`[hyp] orders.${missing} not in the schema yet — saving without it (run the migration!)`);
  const { [missing]: _dropped, ...rest } = update;
  const { error: retryError } = await supabase.from('orders').update(rest).eq('id', orderId);
  return retryError || null;
}
