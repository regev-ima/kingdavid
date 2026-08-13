/**
 * An empty string is not a missing uuid — Postgres says so, loudly.
 *
 * The order form builds its insert by spreading the whole form state, and a
 * few of those fields are foreign keys (`lead_id`, `quote_id`, `customer_id`).
 * Any path that "clears" one of them by writing '' — unlinking a phone match
 * with "בטל קישור" was the one that bit us — ships an empty string into a uuid
 * column, and the entire INSERT dies with
 *
 *   22P02  invalid input syntax for type uuid: ""
 *
 * which reaches the rep as "יצירת ההזמנה נכשלה: invalid input syntax for type
 * uuid" and blocks the order outright: every retry sends the same blank, so
 * there is no way past it from the screen.
 *
 * NULL is what "no lead behind this order" actually means, so NULL is what gets
 * sent. Only TOP-LEVEL keys are touched: item and extra rows live inside jsonb
 * columns where `product_id: ''` is the stored shape the PDF and the editors
 * already read, and rewriting those would be a data change rather than a fix
 * for a type error.
 *
 * `customer_id_number` (ת.ז., plain text) deliberately does NOT match — it ends
 * in `_number` — for the same reason: blanking it is a behaviour change, not a
 * type fix.
 */

/**
 * Foreign keys — `lead_id`, `quote_id`, `customer_id`, `order_id` — and never
 * `customer_id_number`, which is text.
 *
 * A bare `id` is deliberately out of scope: a blank primary key wants the key
 * DROPPED so the column default fills it, not turned into a NULL that trips
 * NOT NULL instead. No caller sends one, and quietly half-fixing it here would
 * hide that from whoever eventually does.
 */
const ID_KEY = /_id$/;

/**
 * Return `payload` with blank id fields turned into null. The input is left
 * untouched, and an object with nothing to fix is returned as-is.
 *
 * @param {object} payload  Row about to be inserted/updated.
 * @returns {object}
 */
export function nullBlankIds(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

  let next = payload;
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string' || value.trim() !== '' || !ID_KEY.test(key)) continue;
    if (next === payload) next = { ...payload };
    next[key] = null;
  }
  return next;
}
