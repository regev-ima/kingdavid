import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { spreadsheet_id, sheet_name, column_mapping } = await req.json();

    if (!spreadsheet_id || !sheet_name) {
      return Response.json({ 
        error: 'Missing required fields: spreadsheet_id, sheet_name' 
      }, { status: 400 });
    }

    if (!column_mapping || !column_mapping.email || !column_mapping.full_name) {
      return Response.json({ 
        error: 'Missing required column mapping: email and full_name are required' 
      }, { status: 400 });
    }

    // Get OAuth token for Google Sheets
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('googlesheets');

    // Fetch data from Google Sheets
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${sheet_name}`,
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
    const rows = sheetsData.values || [];

    if (rows.length === 0) {
      return Response.json({ error: 'No data found in sheet' }, { status: 400 });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowData = {};
      
      headers.forEach((header, index) => {
        rowData[header] = row[index] || '';
      });

      try {
        // Extract user data from row using column mapping
        const email = rowData[column_mapping.email];
        const fullName = rowData[column_mapping.full_name];
        const role = column_mapping.role ? (rowData[column_mapping.role] || 'user') : 'user';
        
        if (!email || !fullName) {
          results.failed++;
          results.errors.push(`Row ${i + 2}: Missing email or full_name`);
          continue;
        }

        // Invite user - this creates the user profile and sends invitation email
        await base44.users.inviteUser(email, role, fullName);

        // Update user with additional fields if they exist
        const phone = column_mapping.phone ? rowData[column_mapping.phone] : null;
        const voicenterExtension = column_mapping.voicenter_extension ? rowData[column_mapping.voicenter_extension] : null;
        const commissionRate = column_mapping.commission_rate ? parseFloat(rowData[column_mapping.commission_rate] || '3') : 3;
        const isActive = column_mapping.is_active ? rowData[column_mapping.is_active] : null;

        // Build update data object
        const updateData = {};
        if (phone) updateData.phone = phone;
        if (voicenterExtension) updateData.voicenter_extension = voicenterExtension;
        if (commissionRate) updateData.commission_rate = commissionRate;
        if (isActive !== undefined && isActive !== '') {
          updateData.is_active = isActive === 'true' || isActive === true || isActive === 'TRUE' || isActive === 'כן';
        }

        // Update user with additional fields if there are any
        if (Object.keys(updateData).length > 0) {
          const users = await base44.entities.User.filter({ email: email });
          if (users.length > 0) {
            await base44.entities.User.update(users[0].id, updateData);
          }
        }

        results.success++;

      } catch (error) {
        results.failed++;
        results.errors.push(`Row ${i + 2}: ${error.message}`);
      }
    }

    return Response.json({
      message: 'Import completed',
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});