import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { spreadsheet_id, sheet_name } = await req.json();

    if (!spreadsheet_id || !sheet_name) {
      return Response.json({ 
        error: 'Missing required fields: spreadsheet_id, sheet_name' 
      }, { status: 400 });
    }

    // Get OAuth token for Google Sheets
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('googlesheets');

    // Fetch first row (headers) from Google Sheets
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${sheet_name}!1:1`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!sheetsResponse.ok) {
      const errorText = await sheetsResponse.text();
      return Response.json({ 
        error: 'Failed to fetch from Google Sheets', 
        details: errorText 
      }, { status: 400 });
    }

    const sheetsData = await sheetsResponse.json();
    const columns = sheetsData.values?.[0] || [];

    return Response.json({ columns });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});