import { createServiceClient, corsHeaders, getUser } from '../_shared/supabase.ts';

const SPREADSHEET_ID = '1On0QrIVZ-rQw47A676EGui2fHGBJcBEhugcpCmB_fIU';
const SHEET_NAME = 'Sheet 1';
const BATCH_SIZE = 25;

const STATUS_MAP: Record<string, string> = {
  'ליד חדש': 'new_lead',
  'ליד חם': 'hot_lead',
  'פולואפ - לפני הצעה': 'followup_before_quote',
  'פולואפ - אחרי הצעת מחיר': 'followup_after_quote',
  'פולואפ - אחרי הצעה': 'followup_after_quote',
  'מגיע לסניף': 'coming_to_branch',
  'אין מענה 1': 'no_answer_1',
  'אין מענה 2': 'no_answer_2',
  'אין מענה 3': 'no_answer_3',
  'אין מענה 4': 'no_answer_4',
  'אין מענה 5': 'no_answer_5',
  'אין מענה - נשלח וואטסאפ': 'no_answer_whatsapp_sent',
  'אין מענה - שיחות': 'no_answer_calls',
  'שינה כיוון': 'changed_direction',
  'עסקה נסגרה': 'deal_closed',
  'לא רלוונטי - כפילות': 'not_relevant_duplicate',
  'הסרה מדיוור': 'mailing_remove_request',
  'גר רחוק - מתעניין טלפוני': 'lives_far_phone_concern',
  'מוצרים לא זמינים': 'products_not_available',
  'לא רלוונטי - קנה במקום אחר': 'not_relevant_bought_elsewhere',
  'לא רלוונטי - עד 1000 שקל': 'not_relevant_1000_nis',
  'לא רלוונטי - מכחיש פניה': 'not_relevant_denies_contact',
  'לא רלוונטי - שירות': 'not_relevant_service',
  'לא מעוניין - מנתק': 'not_interested_hangs_up',
  'לא רלוונטי - ללא הסבר': 'not_relevant_no_explanation',
  'שמע מחיר - לא מעוניין': 'heard_price_not_interested',
  'לא רלוונטי - טעות במספר': 'not_relevant_wrong_number',
  'סגור על ידי מנהל - לדיוור': 'closed_by_manager_to_mailing',
};

function extractEmail(text: string): string {
  if (!text) return '';
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return match ? match[0].toLowerCase() : '';
}

function parseDate(val: string): string | null {
  if (!val) return null;
  const parts = val.trim().split(' ');
  const dateParts = parts[0].split('/');
  if (dateParts.length === 3) {
    const [day, month, year] = dateParts;
    const time = parts[1] || '00:00';
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${time}:00.000Z`;
  }
  return null;
}

function mapStatus(hebrewStatus: string): string {
  if (!hebrewStatus) return 'new_lead';
  const trimmed = hebrewStatus.trim();
  if (STATUS_MAP[trimmed]) return STATUS_MAP[trimmed];
  for (const [key, value] of Object.entries(STATUS_MAP)) {
    if (trimmed.includes(key) || key.includes(trimmed)) return value;
  }
  return 'new_lead';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const startRow = body.startRow || 1;

    const supabase = createServiceClient();
    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) return Response.json({ error: 'GOOGLE_SHEETS_API_KEY not set' }, { status: 500, headers: corsHeaders });

    // Fetch batch of rows
    const range = `${SHEET_NAME}!A${startRow + 1}:BZ${startRow + BATCH_SIZE}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return Response.json({ error: 'Failed to fetch sheet', details: await res.text() }, { status: 400, headers: corsHeaders });

    const data = await res.json();
    const rows = data.values || [];

    if (rows.length === 0) {
      return Response.json({ done: true, message: 'No more rows', startRow }, { headers: corsHeaders });
    }

    // Pre-fetch all users for rep matching (one query)
    const { data: allUsers } = await supabase.from('users').select('email');
    const userEmails = new Set((allUsers || []).map((u: any) => u.email.toLowerCase()));

    const results = { created: 0, updated: 0, skipped: 0, errors: [] as string[], nextStartRow: startRow + rows.length, hasMore: rows.length === BATCH_SIZE };

    // Batch: collect all leads to insert/update
    const toInsert: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const fullName = (row[0] || '').trim();
        const phone = (row[4] || '').trim().replace(/\D/g, '');

        if (!fullName || !phone || phone.length < 9) {
          results.skipped++;
          continue;
        }

        const repEmail = extractEmail(row[1] || '');
        const source = (row[2] || '').trim();
        const adName = (row[5] || '').trim();
        const status = mapStatus(row[7] || '');
        const createdDate = parseDate(row[8] || '');
        const notes = (row[9] || '').trim();
        const gclid = (row[10] || '').trim();
        const uniqueId = (row[11] || '').trim();
        const email = (row[20] || '').trim();
        const utmCampaign = (row[21] || '').trim();

        const leadData: any = {
          full_name: fullName,
          phone,
          status,
          source,
          notes: notes || undefined,
          unique_id: uniqueId || undefined,
          email: email || undefined,
          click_id: gclid || undefined,
          facebook_ad_name: adName || undefined,
          utm_campaign: utmCampaign || undefined,
          created_date: createdDate || new Date().toISOString(),
          effective_sort_date: createdDate || new Date().toISOString(),
        };

        if (repEmail && userEmails.has(repEmail)) {
          leadData.rep1 = repEmail;
        } else if (repEmail) {
          leadData.pending_rep_email = repEmail;
        }

        toInsert.push(leadData);
      } catch (err) {
        results.errors.push(`Row ${startRow + i}: ${(err as Error).message}`);
      }
    }

    // Bulk insert all at once (no duplicate check for speed)
    if (toInsert.length > 0) {
      const { error } = await supabase.from('leads').insert(toInsert);
      if (error) {
        results.errors.push(error.message);
      } else {
        results.created = toInsert.length;
      }
    }

    return Response.json(results, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
