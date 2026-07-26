import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { spreadsheetId, sheetName, mapping, startRow, batchSize } = await req.json();

    if (!spreadsheetId || !mapping) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400, headers: corsHeaders });
    }

    const rowStart = startRow || 2; // Start from row 2 (after header)
    const rowBatchSize = batchSize || 50;

    // Use Google Sheets API with API key
    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Sheets API key not configured' }, { status: 500, headers: corsHeaders });
    }

    // Fetch data from Google Sheets
    const range = sheetName ? `${sheetName}!A:Z` : 'A:Z';
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;

    const response = await fetch(sheetsUrl);

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ error: `Google Sheets API error: ${error}` }, { status: 400, headers: corsHeaders });
    }

    const data = await response.json();
    const rows = data.values || [];

    if (rows.length === 0) {
      return Response.json({ error: 'No data found in spreadsheet' }, { status: 400, headers: corsHeaders });
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

    const supabase = createServiceClient();

    // Create leads from rows
    const leads: Record<string, any>[] = [];
    const errors: { row?: number; error: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const leadData: Record<string, any> = {};

      // Map columns to lead fields
      for (const [leadField, columnIndex] of Object.entries(mapping)) {
        if (columnIndex !== null && columnIndex !== undefined && row[columnIndex as number]) {
          let value = row[columnIndex as number];

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

      leads.push(leadData);
    }

    // Auto-assignment disabled across the board (product decision):
    // imported leads land UNASSIGNED so a manager triages via
    // /LeadManagement. The previous logic here defaulted rep1 to the
    // importing admin's own email when no rep column was provided,
    // and silently promoted pending_rep_email → rep1 when the email
    // matched a real user — both removed. pending_rep_email values
    // from the sheet are preserved on the row as a hint, never
    // promoted automatically.

    // Fetch ALL existing leads with pagination
    const allExistingLeads: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch } = await supabase
        .from('leads')
        .select('*')
        .range(offset, offset + pageSize - 1);
      if (!batch || batch.length === 0) break;
      allExistingLeads.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    const existingByPhone: Record<string, any> = {};
    const existingByUniqueId: Record<string, any> = {};

    // Build lookup dictionaries. The phone map is keyed by the CANONICAL phone
    // (972XXXXXXXXX) rather than the raw string — the sheet writes numbers in a
    // different format than the webhook and than manual entry, so keying on the
    // raw value re-imported the same customer as a new lead every run.
    allExistingLeads.forEach(lead => {
      const key = lead.phone_normalized || normalizeIsraeliPhone(lead.phone);
      // Oldest row wins: it's the one holding the history.
      if (key && !existingByPhone[key]) {
        existingByPhone[key] = lead;
      }
      if (lead.unique_id) {
        existingByUniqueId[lead.unique_id] = lead;
      }
    });

    // Process leads
    const importedLeads: any[] = [];
    const updatedLeads: { name: string; phone: string }[] = [];
    const toCreate: Record<string, any>[] = [];
    const toUpdate: { id: string; data: Record<string, any> }[] = [];

    // Phones already queued for creation in THIS batch — without it, a sheet
    // listing the same number twice (or twice in two formats) inserted it twice.
    const queuedPhones = new Set<string>();
    let duplicatesInBatch = 0;

    for (let i = 0; i < leads.length; i++) {
      const leadData = leads[i];

      try {
        let existingLead = null;
        const phoneKey = normalizeIsraeliPhone(leadData.phone);

        // Check by unique_id first (highest priority)
        if (leadData.unique_id && existingByUniqueId[leadData.unique_id]) {
          existingLead = existingByUniqueId[leadData.unique_id];
        }
        // Then check by phone
        else if (phoneKey && existingByPhone[phoneKey]) {
          existingLead = existingByPhone[phoneKey];
        }
        else if (phoneKey && queuedPhones.has(phoneKey)) {
          // Same number twice in one batch: keep the first row, skip the rest.
          duplicatesInBatch++;
          continue;
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
          if (phoneKey) queuedPhones.add(phoneKey);
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
      const { data: created, error: createError } = await supabase
        .from('leads')
        .insert(toCreate)
        .select();
      if (createError) {
        console.error('Bulk create error:', createError);
        errors.push({ error: `Failed to create leads: ${createError.message}` });
      } else if (created) {
        importedLeads.push(...created);
      }
    }

    // Update existing leads one by one
    for (const { id, data: updateData } of toUpdate) {
      try {
        await supabase
          .from('leads')
          .update(updateData)
          .eq('id', id);
      } catch (e) {
        errors.push({ error: `Failed to update lead: ${e.message}` });
      }
    }

    return Response.json({
      success: true,
      imported: importedLeads.length,
      updated: updatedLeads.length,
      duplicatesInBatch,
      errors: errors.length > 0 ? errors : undefined,
      updatedList: updatedLeads,
      hasMore,
      nextStartRow,
      totalRows,
      processedRows: dataRows.length,
      message: `נוצרו ${importedLeads.length} לידים חדשים${updatedLeads.length > 0 ? `, עודכנו ${updatedLeads.length} לידים קיימים` : ''}${duplicatesInBatch > 0 ? `, ${duplicatesInBatch} שורות כפולות בקובץ דולגו` : ''}${errors.length > 0 ? `, ${errors.length} שגיאות` : ''}`,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
