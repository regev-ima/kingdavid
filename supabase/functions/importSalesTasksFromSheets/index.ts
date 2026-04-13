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

    const supabase = createServiceClient();

    // First row is headers
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Create tasks from rows
    const tasks: Record<string, any>[] = [];
    const errors: { row?: number; error: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const taskData: Record<string, any> = {};

      // Map columns to task fields
      for (const [taskField, columnIndex] of Object.entries(mapping)) {
        if (columnIndex !== null && columnIndex !== undefined && row[columnIndex as number]) {
          taskData[taskField] = row[columnIndex as number];
        }
      }

      // Validate required fields for finding the lead
      if (!taskData.full_name || !taskData.phone) {
        errors.push({
          row: i + 2,
          error: 'Missing required fields (full_name or phone) - cannot find lead',
        });
        continue;
      }

      // Find the lead by phone (primary) and name (secondary validation)
      try {
        const { data: leads, error: filterError } = await supabase
          .from('leads')
          .select('*')
          .eq('phone', taskData.phone);

        if (filterError || !leads || leads.length === 0) {
          errors.push({
            row: i + 2,
            error: `לא נמצא ליד עם טלפון ${taskData.phone}`,
          });
          continue;
        }

        // If multiple leads with same phone, try to match by name
        let matchedLead = leads[0];
        if (leads.length > 1) {
          const nameMatch = leads.find((lead: any) =>
            lead.full_name && lead.full_name.includes(taskData.full_name)
          );
          if (nameMatch) {
            matchedLead = nameMatch;
          }
        }

        // Build the sales task
        const salesTaskData: Record<string, any> = {
          lead_id: matchedLead.id,
        };

        // Map the fields from import to sales_tasks
        if (taskData.manual_created_date) {
          salesTaskData.manual_created_date = taskData.manual_created_date;
        }
        if (taskData.work_start_date) {
          salesTaskData.work_start_date = taskData.work_start_date;
        }
        if (taskData.due_date) {
          salesTaskData.due_date = taskData.due_date;
        }
        if (taskData.status) {
          salesTaskData.status = taskData.status;
          // Also update the lead status to match
          await supabase
            .from('leads')
            .update({ status: taskData.status })
            .eq('id', matchedLead.id);
        }
        if (taskData.task_type) {
          salesTaskData.task_type = taskData.task_type;
        }
        if (taskData.task_status) {
          salesTaskData.task_status = taskData.task_status;
        }
        if (taskData.summary) {
          salesTaskData.summary = taskData.summary;
        }
        if (taskData.rep1) {
          salesTaskData.rep1 = taskData.rep1;
        }
        if (taskData.rep2) {
          salesTaskData.rep2 = taskData.rep2;
        }
        if (taskData.pending_rep_email) {
          salesTaskData.pending_rep_email = taskData.pending_rep_email;
          // Also update the lead with pending_rep_email
          await supabase
            .from('leads')
            .update({ pending_rep_email: taskData.pending_rep_email })
            .eq('id', matchedLead.id);
        }

        // Set default values if not provided
        if (!salesTaskData.status) {
          salesTaskData.status = 'new_lead';
        }
        if (!salesTaskData.task_type) {
          salesTaskData.task_type = 'call';
        }
        if (!salesTaskData.task_status) {
          salesTaskData.task_status = 'not_completed';
        }

        tasks.push(salesTaskData);
      } catch (e) {
        console.error(`Error processing task for ${taskData.full_name}:`, e);
        errors.push({
          row: i + 2,
          error: `Failed to process task: ${e.message}`,
        });
      }
    }

    // Fetch existing tasks by unique_id if provided
    const tasksWithUniqueId = tasks.filter(t => t.unique_id);
    const existingByUniqueId: Record<string, any> = {};

    if (tasksWithUniqueId.length > 0) {
      const allTasks: any[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data: batch } = await supabase
          .from('sales_tasks')
          .select('*')
          .range(offset, offset + pageSize - 1);
        if (!batch || batch.length === 0) break;
        allTasks.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
      allTasks.filter(t => t.unique_id && tasksWithUniqueId.some(newT => newT.unique_id === t.unique_id))
        .forEach(task => {
          existingByUniqueId[task.unique_id] = task;
        });
    }

    // Separate tasks for create vs update
    const toCreate: Record<string, any>[] = [];
    const toUpdate: { id: string; data: Record<string, any> }[] = [];

    for (const taskData of tasks) {
      if (taskData.unique_id && existingByUniqueId[taskData.unique_id]) {
        toUpdate.push({ id: existingByUniqueId[taskData.unique_id].id, data: taskData });
      } else {
        toCreate.push(taskData);
      }
    }

    // Bulk create new tasks
    const importedTasks: any[] = [];
    if (toCreate.length > 0) {
      const { data: created, error: createError } = await supabase
        .from('sales_tasks')
        .insert(toCreate)
        .select();
      if (createError) {
        console.error('Bulk create error:', createError);
        errors.push({ error: `Failed to create tasks: ${createError.message}` });
      } else if (created) {
        importedTasks.push(...created);
      }
    }

    // Update existing tasks
    const updatedTasks: Record<string, any>[] = [];
    for (const { id, data: updateData } of toUpdate) {
      try {
        const { error: updateError } = await supabase
          .from('sales_tasks')
          .update(updateData)
          .eq('id', id);
        if (updateError) {
          errors.push({ error: `Failed to update task: ${updateError.message}` });
        } else {
          updatedTasks.push(updateData);
        }
      } catch (e) {
        console.error(`Error updating task:`, e);
        errors.push({ error: `Failed to update task: ${e.message}` });
      }
    }

    return Response.json({
      success: true,
      imported: importedTasks.length,
      updated: updatedTasks.length,
      errors: errors.length,
      errorsList: errors,
      message: `נוצרו ${importedTasks.length} משימות מכירה${updatedTasks.length > 0 ? `, עודכנו ${updatedTasks.length} משימות` : ''}${errors.length > 0 ? `, ${errors.length} שגיאות` : ''}`,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
