import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403, headers: corsHeaders });
    }

    const { spreadsheet_id, sheet_name } = await req.json();

    if (!spreadsheet_id || !sheet_name) {
      return Response.json({
        error: 'Missing required fields: spreadsheet_id, sheet_name'
      }, { status: 400, headers: corsHeaders });
    }

    // Use Google Sheets API with API key
    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Sheets API key not configured' }, { status: 500, headers: corsHeaders });
    }

    // Fetch first row (headers) from Google Sheets
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(sheet_name)}!1:1?key=${apiKey}`
    );

    if (!sheetsResponse.ok) {
      const errorText = await sheetsResponse.text();
      return Response.json({
        error: 'Failed to fetch from Google Sheets',
        details: errorText
      }, { status: 400, headers: corsHeaders });
    }

    const sheetsData = await sheetsResponse.json();
    const columns = sheetsData.values?.[0] || [];

    return Response.json({ columns }, { headers: corsHeaders });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
