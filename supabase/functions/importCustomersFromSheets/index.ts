import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { spreadsheetId, sheetName, mapping } = await req.json();

    if (!spreadsheetId || !mapping) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400, headers: corsHeaders });
    }

    // Use Google Sheets API with API key
    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Sheets API key not configured' }, { status: 500, headers: corsHeaders });
    }

    // Build the range
    const range = sheetName ? `${sheetName}!A:Z` : 'A:Z';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({
        error: 'Failed to fetch Google Sheets data',
        details: errorText
      }, { status: response.status, headers: corsHeaders });
    }

    const data = await response.json();
    const rows = data.values || [];

    if (rows.length <= 1) {
      return Response.json({
        error: 'No data rows found in spreadsheet (only headers or empty)',
        imported: 0
      }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();

    // Skip header row
    const dataRows = rows.slice(1);

    const imported: any[] = [];
    const errors: { row?: number; error: string }[] = [];

    // Build customer data array first
    const customers: { data: Record<string, any>; rowNumber: number }[] = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2;

      try {
        const customerData: Record<string, any> = {};

        for (const [field, colIndex] of Object.entries(mapping)) {
          if (colIndex !== null && colIndex !== undefined && row[colIndex as number] !== undefined && row[colIndex as number] !== '') {
            let value = row[colIndex as number];

            if (field === 'vip_status') {
              value = value.toLowerCase() === 'true' || value === '1';
            } else if (field === 'total_orders' || field === 'total_revenue' || field === 'lifetime_value') {
              value = parseFloat(value) || 0;
            }

            customerData[field] = value;
          }
        }

        if (!customerData.full_name || !customerData.phone) {
          errors.push({ row: rowNumber, error: 'חסרים שדות חובה (שם מלא או טלפון)' });
          continue;
        }

        customers.push({ data: customerData, rowNumber });
      } catch (error) {
        errors.push({ row: rowNumber, error: error.message });
      }
    }

    // Fetch existing customers in bulk
    const allPhones = customers.map(c => c.data.phone).filter(Boolean);
    const allUniqueIds = customers.map(c => c.data.unique_id).filter(Boolean);

    const existingByPhone: Record<string, any> = {};
    const existingByUniqueId: Record<string, any> = {};

    const allCustomers: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch } = await supabase
        .from('customers')
        .select('*')
        .range(offset, offset + pageSize - 1);
      if (!batch || batch.length === 0) break;
      allCustomers.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    allCustomers.forEach(customer => {
      if (customer.phone && allPhones.includes(customer.phone)) {
        existingByPhone[customer.phone] = customer;
      }
      if (customer.unique_id && allUniqueIds.includes(customer.unique_id)) {
        existingByUniqueId[customer.unique_id] = customer;
      }
    });

    // Separate create vs update
    const toCreate: Record<string, any>[] = [];
    const toUpdate: { id: string; data: Record<string, any> }[] = [];
    const updated: Record<string, any>[] = [];

    for (const { data: customerData, rowNumber } of customers) {
      try {
        let existingCustomer = null;

        if (customerData.unique_id && existingByUniqueId[customerData.unique_id]) {
          existingCustomer = existingByUniqueId[customerData.unique_id];
        } else if (existingByPhone[customerData.phone]) {
          existingCustomer = existingByPhone[customerData.phone];
        }

        if (existingCustomer) {
          toUpdate.push({ id: existingCustomer.id, data: customerData });
          updated.push(customerData);
        } else {
          toCreate.push(customerData);
        }
      } catch (error) {
        errors.push({ row: rowNumber, error: error.message });
      }
    }

    // Bulk create
    if (toCreate.length > 0) {
      const { data: created, error: createError } = await supabase
        .from('customers')
        .insert(toCreate)
        .select();
      if (createError) {
        console.error('Bulk create error:', createError);
        errors.push({ error: `Failed to create customers: ${createError.message}` });
      } else if (created) {
        imported.push(...created);
      }
    }

    // Update one by one
    for (const { id, data: updateData } of toUpdate) {
      try {
        const { error: updateError } = await supabase
          .from('customers')
          .update(updateData)
          .eq('id', id);
        if (updateError) {
          errors.push({ error: `Failed to update customer: ${updateError.message}` });
        }
      } catch (error) {
        errors.push({ error: `Failed to update customer: ${error.message}` });
      }
    }

    return Response.json({
      success: true,
      message: `יובאו ${imported.length} לקוחות חדשים${updated.length > 0 ? `, עודכנו ${updated.length} לקוחות` : ''}${errors.length > 0 ? `, ${errors.length} שגיאות` : ''}`,
      imported: imported.length,
      updated: updated.length,
      total: dataRows.length,
      errors: errors.length > 0 ? errors : undefined
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
