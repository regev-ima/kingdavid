import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { spreadsheetId, sheetName, mapping, startRow, batchSize } = await req.json();

    if (!spreadsheetId || !mapping) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    
    const rowStart = startRow || 2; // Start from row 2 (after header)
    const rowBatchSize = batchSize || 50;

    // Get access token for Google Sheets
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('googlesheets');

    // Fetch data from Google Sheets
    const range = sheetName ? `${sheetName}!A:Z` : 'A:Z';
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    
    const response = await fetch(sheetsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ error: `Google Sheets API error: ${error}` }, { status: 400 });
    }

    const data = await response.json();
    const rows = data.values || [];

    if (rows.length === 0) {
      return Response.json({ error: 'No data found in spreadsheet' }, { status: 400 });
    }

    // First row is headers
    const headers = rows[0];
    const totalRows = rows.length - 1; // Total data rows (excluding header)
    
    // Calculate which rows to process in this batch
    const startIndex = rowStart - 2; // Convert row number to array index (row 2 = index 0)
    const endIndex = Math.min(startIndex + rowBatchSize, totalRows);
    const dataRows = rows.slice(startIndex + 1, endIndex + 1); // +1 because slice end is exclusive
    
    const hasMore = endIndex < totalRows;
    // Always advance by at least rowBatchSize to prevent infinite loop when all rows are duplicates
    const nextStartRow = hasMore ? rowStart + Math.max(dataRows.length, rowBatchSize) : null;

    // Create leads from rows
    const leads = [];
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const leadData = {};

      // Map columns to lead fields
      for (const [leadField, columnIndex] of Object.entries(mapping)) {
        if (columnIndex !== null && columnIndex !== undefined && row[columnIndex]) {
          let value = row[columnIndex];
          
          // Trim whitespace
          if (typeof value === 'string') {
            value = value.trim();
          }
          
          leadData[leadField] = value;
        }
      }

      // Validate required fields
      if (!leadData.full_name || !leadData.phone) {
        errors.push({
          row: rowStart + i, // Actual row number in the sheet
          error: 'Missing required fields (full_name or phone)',
        });
        continue;
      }

      // Validate and normalize status value
      const validStatuses = [
        'new_lead', 'hot_lead', 'followup_before_quote', 'followup_after_quote',
        'coming_to_branch', 'no_answer_1', 'no_answer_2', 'no_answer_3', 'no_answer_4',
        'no_answer_5', 'no_answer_whatsapp_sent', 'no_answer_calls', 'changed_direction',
        'deal_closed', 'not_relevant_duplicate', 'mailing_remove_request', 'lives_far_phone_concern',
        'products_not_available', 'not_relevant_bought_elsewhere', 'not_relevant_1000_nis',
        'not_relevant_denies_contact', 'not_relevant_service', 'not_interested_hangs_up',
        'not_relevant_no_explanation', 'heard_price_not_interested', 'not_relevant_wrong_number',
        'closed_by_manager_to_mailing'
      ];
      
      if (leadData.status && !validStatuses.includes(leadData.status)) {
        errors.push({
          row: rowStart + i,
          error: `סטטוס לא חוקי: "${leadData.status}". השתמש באחד מהערכים: ${validStatuses.slice(0, 5).join(', ')}...`,
        });
        leadData.status = 'new_lead'; // Default fallback
      } else if (!leadData.status) {
        leadData.status = 'new_lead';
      }

      // Assign to current user if no rep specified
      if (!leadData.rep1 && !leadData.pending_rep_email) {
        leadData.rep1 = user.email;
      }

      leads.push(leadData);
    }

    // Fetch all users to resolve pending_rep_email -> rep1
    const allUsers = await base44.asServiceRole.entities.User.list();
    const userEmails = new Set(allUsers.map(u => u.email));

    // Resolve pending_rep_email to rep1 if user exists
    for (const leadData of leads) {
      if (leadData.pending_rep_email && !leadData.rep1) {
        if (userEmails.has(leadData.pending_rep_email)) {
          leadData.rep1 = leadData.pending_rep_email;
          leadData.pending_rep_email = '';
        }
      }
    }

    // Fetch ALL existing leads with pagination to avoid 5000 limit
    const allExistingLeads = [];
    let _skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Lead.list('', 500, _skip);
      allExistingLeads.push(...batch);
      if (batch.length < 500) break;
      _skip += 500;
    }
    
    const existingByPhone = {};
    const existingByUniqueId = {};
    
    // Build lookup dictionaries
    allExistingLeads.forEach(lead => {
      if (lead.phone) {
        existingByPhone[lead.phone] = lead;
      }
      if (lead.unique_id) {
        existingByUniqueId[lead.unique_id] = lead;
      }
    });

    // Process leads
    const importedLeads = [];
    const updatedLeads = [];
    const toCreate = [];
    const toUpdate = [];

    for (let i = 0; i < leads.length; i++) {
      const leadData = leads[i];
      
      try {
        let existingLead = null;
        
        // Check by unique_id first (highest priority)
        if (leadData.unique_id && existingByUniqueId[leadData.unique_id]) {
          existingLead = existingByUniqueId[leadData.unique_id];
        } 
        // Then check by phone
        else if (existingByPhone[leadData.phone]) {
          existingLead = existingByPhone[leadData.phone];
        }

        if (existingLead) {
          // Update existing lead
          const reimportDate = new Date().toLocaleString('he-IL', { 
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          const newNote = `עודכן מייבוא - ${reimportDate}`;
          
          const updateData = {
            ...leadData,
            notes: existingLead.notes ? `${existingLead.notes}\n${newNote}` : newNote,
          };
          
          toUpdate.push({ id: existingLead.id, data: updateData });
          updatedLeads.push({ name: leadData.full_name, phone: leadData.phone });
        } else {
          // New lead
          toCreate.push(leadData);
        }
      } catch (e) {
        console.error(`Error processing lead ${leadData.full_name}:`, e);
        errors.push({ 
          row: rowStart + i, 
          error: `Failed to process lead: ${e.message}` 
        });
      }
    }

    // Bulk create new leads
    if (toCreate.length > 0) {
      const created = await base44.asServiceRole.entities.Lead.bulkCreate(toCreate);
      importedLeads.push(...created);
    }

    // Update existing leads one by one (no bulk update in SDK)
    for (const { id, data } of toUpdate) {
      try {
        await base44.asServiceRole.entities.Lead.update(id, data);
      } catch (e) {
        errors.push({ error: `Failed to update lead: ${e.message}` });
      }
    }

    return Response.json({
      success: true,
      imported: importedLeads.length,
      updated: updatedLeads.length,
      errors: errors.length > 0 ? errors : undefined,
      updatedList: updatedLeads,
      hasMore,
      nextStartRow,
      totalRows,
      processedRows: dataRows.length,
      message: `נוצרו ${importedLeads.length} לידים חדשים${updatedLeads.length > 0 ? `, עודכנו ${updatedLeads.length} לידים קיימים` : ''}${errors.length > 0 ? `, ${errors.length} שגיאות` : ''}`,
    });

  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});