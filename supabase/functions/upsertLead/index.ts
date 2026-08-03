import { createServiceClient, getCorsHeaders } from '../_shared/supabase.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';

// Mirrors VALID_LEAD_STATUSES in src/constants/leadOptions.js. The second half
// is the set migration 20260426000004 normalized into leads.status; a caller
// re-sending one of those was being rejected as an invalid status even though
// the value came out of this database.
const VALID_STATUSES = new Set([
  'new_lead','hot_lead','followup_before_quote','followup_after_quote','coming_to_branch',
  'no_answer_1','no_answer_2','no_answer_3','no_answer_4','no_answer_5',
  'no_answer_whatsapp_sent','no_answer_calls','changed_direction','deal_closed',
  'not_relevant_duplicate','mailing_remove_request','lives_far_phone_concern',
  'products_not_available','not_relevant_bought_elsewhere','not_relevant_1000_nis',
  'not_relevant_denies_contact','not_relevant_service','not_interested_hangs_up',
  'not_relevant_no_explanation','heard_price_not_interested','not_relevant_wrong_number',
  'closed_by_manager_to_mailing',
  'second_line_lead','return_to_followup','will_arrive_for_meeting',
  'manager_call_potential_close','transferred_by_manager_for_followup',
  'no_answer_8_calls','call_from_google','call_from_facebook',
  'already_purchased_inquiry','not_relevant_not_mature','system_test',
  'service_30_nights_trial','service_30_nights_trial_handled',
  'service_warranty','service_warranty_handled',
  'service_cancellations','service_cancellations_handled',
  'service_missing_items','service_missing_items_handled','service_handled',
  'delivery_inquiry','delivery_inquiry_handled',
]);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, api_key, x-webhook-secret, Authorization' } });
  }

  try {
    const expectedSecret = Deno.env.get('UPSERT_LEAD_WEBHOOK_SECRET');
    const authHeader = req.headers.get('authorization') || '';
    const providedSecret = req.headers.get('api_key') || req.headers.get('x-webhook-secret') || authHeader.replace(/^Bearer\s+/i, '');

    // Constant-time comparison to prevent timing attacks
    const timingSafeEqual = (a: string, b: string): boolean => {
      if (a.length !== b.length) return false;
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
      }
      return result === 0;
    };

    if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const supabase = createServiceClient();
    const rawData = await req.json();

    // Sanitize all string inputs - strip HTML/script tags
    const sanitize = (val: unknown): string => {
      if (typeof val !== 'string') return String(val || '');
      return val.replace(/<[^>]*>/g, '').replace(/[<>"']/g, '').trim();
    };

    // Generated columns cannot be written to. The payload is arbitrary JSON
    // from an external caller and is spread straight into the insert/update
    // below, so a caller that helpfully sends phone_normalized would other-
    // wise turn the whole request into a 500 with an opaque message.
    const GENERATED_COLUMNS = new Set(['phone_normalized']);

    const leadData: any = {};
    for (const [key, value] of Object.entries(rawData)) {
      if (GENERATED_COLUMNS.has(key)) continue;
      leadData[key] = typeof value === 'string' ? sanitize(value) : value;
    }

    if (!leadData.full_name || !leadData.phone) {
      return Response.json({ error: 'Missing required fields: full_name and phone are required' }, { status: 400, headers: corsHeaders });
    }

    if (leadData.status && !VALID_STATUSES.has(leadData.status)) leadData.status = 'new_lead';

    // Find the lead this submission belongs to.
    //
    // The rule is "same SUBMISSION", not "same person". A person who enquires
    // twice must produce two lead rows: the daily lead count is a count of
    // those rows, and it is compared against what Facebook and Google report,
    // where every form fill is one conversion. Folding the second enquiry into
    // the first made the CRM report fewer leads than the ad networks did.
    //
    // Being the same person is already handled, one layer down: a database
    // trigger attaches every lead to a contact by normalized phone, so both
    // rows resolve to one contact — updated if it exists, created if it does
    // not. Deduplicating here as well would collapse the enquiry the business
    // wants to count.
    let existingLead = null;

    // unique_id is a true submission identifier: a re-sync of the same
    // submission carries the same one, a new enquiry does not.
    if (leadData.unique_id) {
      const { data } = await supabase.from('leads').select('*').eq('unique_id', leadData.unique_id).limit(1);
      if (data?.length) existingLead = data[0];
    }

    // Phone alone is deliberately NOT a match, but phone + when the submission
    // was made is.
    //
    // Phone answers "who is this", and for a repeat enquiry the answer is
    // always the same person — which is exactly the case that must produce a
    // second row. Matching on phone alone would swallow it.
    //
    // What separates a repeat enquiry from a re-sent one is WHEN it was
    // submitted. A scheduled sync re-pushing yesterday's lead carries
    // yesterday's original timestamp; a person enquiring again carries a new
    // one. So the natural key is (phone, original submission time) — no
    // external identifier required, and the phone stays the business's own
    // identifier exactly as intended.
    //
    // When the caller sends no created_date there is nothing to compare and
    // the submission becomes its own lead. That is the intended default:
    // every enquiry is a row unless something proves it is a duplicate.
    if (!existingLead && leadData.created_date) {
      const submittedAt = new Date(leadData.created_date);
      const normalizedPhone = normalizeIsraeliPhone(leadData.phone);

      // An unparseable date is not evidence of anything — fall through and
      // create, rather than matching on a bad key.
      if (normalizedPhone && !Number.isNaN(submittedAt.getTime())) {
        const { data } = await supabase
          .from('leads')
          .select('*')
          .eq('phone_normalized', normalizedPhone)
          .eq('created_date', submittedAt.toISOString())
          .limit(1);
        if (data?.length) existingLead = data[0];
      }
    }

    // NOTE: we intentionally do NOT promote `pending_rep_email` to
    // `rep1` here. The product decision is that every incoming lead
    // lands UNASSIGNED so a manager triages it via /LeadManagement —
    // no silent routing by campaign / UTM / sheet column. The
    // pending_rep_email value is still persisted on the row as an
    // audit trail of "who the integration was meaning to send this
    // to", so a manager can use it as a hint when distributing.

    const nowISO = new Date().toISOString();

    if (existingLead) {
      const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const newNote = `עודכן מ-API - ${now}`;
      const updateData = { ...leadData, notes: existingLead.notes ? `${existingLead.notes}\n${newNote}` : newNote, last_api_update: nowISO, effective_sort_date: nowISO };

      const { data: updated, error } = await supabase.from('leads').update(updateData).eq('id', existingLead.id).select().single();
      if (error) throw error;

      return Response.json({ success: true, action: 'updated', lead: updated, message: `ליד ${leadData.full_name} עודכן בהצלחה` }, { headers: corsHeaders });
    }

    const { data: newLead, error } = await supabase.from('leads').insert({ ...leadData, last_api_update: nowISO, effective_sort_date: nowISO }).select().single();
    if (error) throw error;

    return Response.json({ success: true, action: 'created', lead: newLead, message: `ליד ${leadData.full_name} נוצר בהצלחה` }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
