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
    const dataRows = rows.slice(1);

    // Create tasks from rows
    const tasks = [];
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const taskData = {};

      // Map columns to task fields
      for (const [taskField, columnIndex] of Object.entries(mapping)) {
        if (columnIndex !== null && columnIndex !== undefined && row[columnIndex]) {
          taskData[taskField] = row[columnIndex];
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
        const leads = await base44.asServiceRole.entities.Lead.filter({
          phone: taskData.phone,
        });

        if (leads.length === 0) {
          errors.push({
            row: i + 2,
            error: `לא נמצא ליד עם טלפון ${taskData.phone}`,
          });
          continue;
        }

        // If multiple leads with same phone, try to match by name
        let matchedLead = leads[0];
        if (leads.length > 1) {
          const nameMatch = leads.find(lead => 
            lead.full_name && lead.full_name.includes(taskData.full_name)
          );
          if (nameMatch) {
            matchedLead = nameMatch;
          }
        }

        // Build the sales task
        const salesTaskData = {
          lead_id: matchedLead.id,
        };

        // Map the fields from import to SalesTask
        if (taskData.manual_created_date) {
          salesTaskData.manual_created_date = taskData.manual_created_date;
        }
        if (taskData.work_start_date) {
          salesTaskData.work_start_date = taskData.work_start_date;
        }
        if (taskData.due_date) {
          // Support both date and datetime formats
          salesTaskData.due_date = taskData.due_date;
        }
        if (taskData.status) {
          salesTaskData.status = taskData.status;
          // Also update the lead status to match
          await base44.asServiceRole.entities.Lead.update(matchedLead.id, {
            status: taskData.status,
          });
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
          await base44.asServiceRole.entities.Lead.update(matchedLead.id, {
            pending_rep_email: taskData.pending_rep_email,
          });
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
    const existingByUniqueId = {};
    
    if (tasksWithUniqueId.length > 0) {
      const allTasks = [];
      let _skip = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities.SalesTask.list('', 500, _skip);
        allTasks.push(...batch);
        if (batch.length < 500) break;
        _skip += 500;
      }
      allTasks.filter(t => t.unique_id && tasksWithUniqueId.some(newT => newT.unique_id === t.unique_id))
        .forEach(task => {
          existingByUniqueId[task.unique_id] = task;
        });
    }

    // Separate tasks for create vs update
    const toCreate = [];
    const toUpdate = [];
    
    for (const taskData of tasks) {
      if (taskData.unique_id && existingByUniqueId[taskData.unique_id]) {
        toUpdate.push({ id: existingByUniqueId[taskData.unique_id].id, data: taskData });
      } else {
        toCreate.push(taskData);
      }
    }

    // Bulk create new tasks
    const importedTasks = [];
    if (toCreate.length > 0) {
      const created = await base44.asServiceRole.entities.SalesTask.bulkCreate(toCreate);
      importedTasks.push(...created);
    }

    // Update existing tasks
    const updatedTasks = [];
    for (const { id, data } of toUpdate) {
      try {
        await base44.asServiceRole.entities.SalesTask.update(id, data);
        updatedTasks.push(data);
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
    });

  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});