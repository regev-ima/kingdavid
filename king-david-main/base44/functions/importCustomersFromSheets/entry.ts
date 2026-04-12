import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { spreadsheetId, sheetName, mapping } = await req.json();

    if (!spreadsheetId || !mapping) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Get Google Sheets access token
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('googlesheets');

    // Build the range
    const range = sheetName ? `${sheetName}!A:Z` : 'A:Z';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({ 
        error: 'Failed to fetch Google Sheets data', 
        details: errorText 
      }, { status: response.status });
    }

    const data = await response.json();
    const rows = data.values || [];

    if (rows.length <= 1) {
      return Response.json({ 
        error: 'No data rows found in spreadsheet (only headers or empty)',
        imported: 0 
      }, { status: 400 });
    }

    // Skip header row
    const dataRows = rows.slice(1);
    
    const imported = [];
    const errors = [];

    // Build customer data array first
    const customers = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2;

      try {
        const customerData = {};
        
        for (const [field, colIndex] of Object.entries(mapping)) {
          if (colIndex !== null && colIndex !== undefined && row[colIndex] !== undefined && row[colIndex] !== '') {
            let value = row[colIndex];
            
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
    
    const existingByPhone = {};
    const existingByUniqueId = {};
    
    const allCustomers = [];
    let _skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Customer.list('', 500, _skip);
      allCustomers.push(...batch);
      if (batch.length < 500) break;
      _skip += 500;
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
    const toCreate = [];
    const toUpdate = [];
    const updated = [];

    for (const { data, rowNumber } of customers) {
      try {
        let existingCustomer = null;
        
        if (data.unique_id && existingByUniqueId[data.unique_id]) {
          existingCustomer = existingByUniqueId[data.unique_id];
        } else if (existingByPhone[data.phone]) {
          existingCustomer = existingByPhone[data.phone];
        }

        if (existingCustomer) {
          toUpdate.push({ id: existingCustomer.id, data });
          updated.push(data);
        } else {
          toCreate.push(data);
        }
      } catch (error) {
        errors.push({ row: rowNumber, error: error.message });
      }
    }

    // Bulk create
    if (toCreate.length > 0) {
      const created = await base44.asServiceRole.entities.Customer.bulkCreate(toCreate);
      imported.push(...created);
    }

    // Update one by one
    for (const { id, data } of toUpdate) {
      try {
        await base44.asServiceRole.entities.Customer.update(id, data);
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
    });

  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ 
      error: 'Import failed', 
      details: error.message 
    }, { status: 500 });
  }
});