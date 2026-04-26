// One-shot data-fix Edge Function:
//   1. Normalize raw Hebrew lead statuses to the English keys the app uses.
//   2. Backfill the customers table from every deal_closed lead.
//
// Lives on the server, uses the service-role key, and chunks every UPDATE
// into 1000-row batches so we don't trip the SQL Editor's API timeout.
// Returns a JSON summary of "src → dst: N rows" plus the customer count
// inserted by the backfill step.
//
// Invoke once after deploy:
//   curl -X POST 'https://<project>.supabase.co/functions/v1/normalizeLeadStatuses' \
//     -H 'Authorization: Bearer <anon or service role key>'

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Hebrew (or mojibake-corrupted) source → canonical English target.
// Mirrors supabase/migrations/20260426000004_normalize_lead_statuses.sql.
const STATUS_MAP: Record<string, string> = {
  // Closed deal
  'נסגרה עסקה': 'deal_closed',
  'נסגרה ��סקה': 'deal_closed',

  // Lifecycle
  'ליד חדש': 'new_lead',
  'ליד קו שני': 'second_line_lead',
  'ליד רותח': 'hot_lead',
  'שנה כיוון לליד': 'changed_direction',
  'יגיע לסניף לפגישה': 'will_arrive_for_meeting',
  'לבצע שיחת מנהל - פוטנציאלי לסגירה': 'manager_call_potential_close',
  "הועבר ע''י מנהל - להמשך טיפול": 'transferred_by_manager_for_followup',
  "נסגר ע''י מנהל - הועבר לדיוור": 'closed_by_manager_to_mailing',
  "��סגר ע''י מנהל - הועבר לדיוור": 'closed_by_manager_to_mailing',
  'שיחה מגוגל': 'call_from_google',
  'שיחה מפייסבוק': 'call_from_facebook',
  'כבר רכש ב - King David התקשר לבירור': 'already_purchased_inquiry',
  'בדיקת מערכת': 'system_test',

  // Followup
  'פולואפ - אחרי הצעת מחיר': 'followup_after_quote',
  'פולואפ - אח��י הצעת מחיר': 'followup_after_quote',
  'פולואפ - לפני הצעה': 'followup_before_quote',
  'לחזור לפולואפ': 'return_to_followup',

  // No-answer
  'ללא מענה 1': 'no_answer_1',
  'ללא מענה 2': 'no_answer_2',
  'ללא מענה 3': 'no_answer_3',
  'ללא מענה 4': 'no_answer_4',
  'ללא מענה 5': 'no_answer_5',
  'אין מענה - 8 חיוגים': 'no_answer_8_calls',
  'ללא מענה - נשלח ווטסאפ': 'no_answer_whatsapp_sent',

  // Not relevant
  'לא רלוונטי - ליד כפול': 'not_relevant_duplicate',
  'לא רלוונטי - ליד כ��ול': 'not_relevant_duplicate',
  'לא רלוונטי – רכש במקום אחר': 'not_relevant_bought_elsewhere',
  'לא רלוונטי – ��כש במקום אחר': 'not_relevant_bought_elsewhere',
  'לא רלוונטי – רכש במק��ם אחר': 'not_relevant_bought_elsewhere',
  'לא רלוונטי – מכחיש פניה': 'not_relevant_denies_contact',
  "לא רלוונטי - מחפש מזרן ב1,000 ש''ח": 'not_relevant_1000_nis',
  "לא רלוונ��י - מחפש מזרן ב1,000 ש''ח": 'not_relevant_1000_nis',
  'לא רלוונטי - לא מסביר למה': 'not_relevant_no_explanation',
  'לא רלוונטי - לא מסביר ��מה': 'not_relevant_no_explanation',
  'לא רלוונטי - לא מסב��ר למה': 'not_relevant_no_explanation',
  'לא רלוונטי - ליד לא בשל לעסקה': 'not_relevant_not_mature',
  'לא רלוונטי - ליד לא ��של לעסקה': 'not_relevant_not_mature',
  'לא רלוונטי - ��יד לא בשל לעסקה': 'not_relevant_not_mature',
  "לא רלוונטי - מס' שגוי": 'not_relevant_wrong_number',
  'לא רלוונטי שירות': 'not_relevant_service',
  'לא מעונין לדבר - מנתק': 'not_interested_hangs_up',
  'שמע מחיר ולא מעונין לשמוע עוד': 'heard_price_not_interested',
  'שמע מחיר ולא מעו��ין לשמוע עוד': 'heard_price_not_interested',
  'שמע מחיר ולא מעונין לשמוע ע��ד': 'heard_price_not_interested',
  'ש��ע מחיר ולא מעונין לשמוע עוד': 'heard_price_not_interested',
  'מחפש מוצרים שלא קיימים בחברה': 'products_not_available',
  'גר רחוק - חושש מקניה בטלפון': 'lives_far_phone_concern',
  'דיוור חוזר - ביקש להסיר': 'mailing_remove_request',

  // Customer service
  'שירות לקוחות-טופל': 'service_handled',
  'שירות לקוחות-מסגרת 30 לילות ניסיון': 'service_30_nights_trial',
  'שירות לקוחות-מסגרת 30 לילות ניסיון טופל': 'service_30_nights_trial_handled',
  'שירות לקוחות-תעודת אחריות': 'service_warranty',
  'שירות לקוחות-תעודת אחריות טופל': 'service_warranty_handled',
  'שירות לקוחות -ביטולים': 'service_cancellations',
  'שירות לקוחות -ביטולים טופל': 'service_cancellations_handled',
  'שירות לקוחות -חוסרים בהזמנה': 'service_missing_items',
  'שירות לקוחות -חוסרים בהזמנה טופל': 'service_missing_items_handled',
  'בירור אספקה': 'delivery_inquiry',
  'בירור אספקה - טופל': 'delivery_inquiry_handled',
};

const BATCH_SIZE = 1000;

async function updateInBatches(
  supabase: any,
  src: string,
  dst: string,
): Promise<number> {
  let total = 0;
  // Loop until select returns nothing — each iteration fetches IDs + updates them.
  while (true) {
    const { data: rows, error: selErr } = await supabase
      .from('leads')
      .select('id')
      .eq('status', src)
      .limit(BATCH_SIZE);
    if (selErr) throw new Error(`select failed for ${src}: ${selErr.message}`);
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: any) => r.id);
    const { error: updErr } = await supabase
      .from('leads')
      .update({ status: dst })
      .in('id', ids);
    if (updErr) throw new Error(`update failed for ${src}: ${updErr.message}`);

    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const url = new URL(req.url);
    const skipBackfill = url.searchParams.get('skip_backfill') === '1';
    const onlyDealClosed = url.searchParams.get('only') === 'deal_closed';

    const summary: Record<string, number> = {};
    const errors: string[] = [];

    // 1. Status normalization (1000-row batches per status).
    const entries = onlyDealClosed
      ? Object.entries(STATUS_MAP).filter(([, dst]) => dst === 'deal_closed')
      : Object.entries(STATUS_MAP);

    for (const [src, dst] of entries) {
      try {
        const n = await updateInBatches(supabase, src, dst);
        if (n > 0) summary[`${src} → ${dst}`] = n;
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    // 2. Coerce empty / null statuses to new_lead.
    if (!onlyDealClosed) {
      try {
        const { data: blanks } = await supabase
          .from('leads')
          .select('id')
          .or('status.is.null,status.eq.')
          .limit(BATCH_SIZE);
        if (blanks && blanks.length > 0) {
          const { error } = await supabase
            .from('leads')
            .update({ status: 'new_lead' })
            .in('id', blanks.map((r: any) => r.id));
          if (error) errors.push(`blank-status fix failed: ${error.message}`);
          else summary['(blank/null) → new_lead'] = blanks.length;
        }
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    // 3. Backfill customers from deal_closed leads (skipped if requested).
    let customers_inserted = 0;
    if (!skipBackfill) {
      // Find closed leads whose phone has no customer yet, in batches.
      while (true) {
        const { data: closed, error: selErr } = await supabase
          .from('leads')
          .select('id, full_name, phone, email, address, city, source, rep1, updated_date, created_date')
          .eq('status', 'deal_closed')
          .not('phone', 'is', null)
          .limit(BATCH_SIZE);
        if (selErr) {
          errors.push(`backfill select failed: ${selErr.message}`);
          break;
        }
        if (!closed || closed.length === 0) break;

        // Dedupe by phone + filter out ones that already have a customer.
        const phones = Array.from(new Set(closed.map((l: any) => (l.phone || '').trim()).filter(Boolean)));
        const { data: existing, error: exErr } = await supabase
          .from('customers')
          .select('phone')
          .in('phone', phones);
        if (exErr) {
          errors.push(`backfill existing-check failed: ${exErr.message}`);
          break;
        }
        const taken = new Set((existing || []).map((c: any) => (c.phone || '').trim()));

        const seen = new Set<string>();
        const toInsert = closed
          .filter((l: any) => {
            const p = (l.phone || '').trim();
            if (!p || taken.has(p) || seen.has(p)) return false;
            seen.add(p);
            return true;
          })
          .map((l: any) => ({
            full_name: l.full_name,
            phone: l.phone,
            email: l.email,
            address: l.address,
            city: l.city,
            lead_id: l.id,
            original_source: l.source,
            total_orders: 0,
            total_revenue: 0,
            lifetime_value: 0,
            account_manager: l.rep1,
            created_date: l.updated_date || l.created_date || new Date().toISOString(),
            updated_date: new Date().toISOString(),
          }));

        if (toInsert.length > 0) {
          const { error: insErr } = await supabase.from('customers').insert(toInsert);
          if (insErr) {
            errors.push(`backfill insert failed: ${insErr.message}`);
            break;
          }
          customers_inserted += toInsert.length;
        }

        // If this batch had < BATCH_SIZE rows we've reached the end.
        if (closed.length < BATCH_SIZE) break;
      }
    }

    return Response.json({
      ok: errors.length === 0,
      duration_ms: Date.now() - startedAt,
      summary,
      customers_inserted,
      errors,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message, duration_ms: Date.now() - startedAt },
      { status: 500 },
    );
  }
});
