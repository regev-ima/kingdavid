import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { leads } = await req.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return Response.json({ 
        error: 'Invalid input. Expected array of leads.' 
      }, { status: 400 });
    }

    const results = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    for (const leadData of leads) {
      try {
        // Validate required fields
        if (!leadData.full_name || !leadData.phone) {
          results.failed++;
          results.errors.push(`Missing required fields for lead: ${leadData.phone || 'unknown'}`);
          continue;
        }

        // Check if lead exists by phone
        const existingLeads = await base44.entities.Lead.filter({ phone: leadData.phone });

        if (existingLeads.length > 0) {
          // Update existing lead
          const existingLead = existingLeads[0];
          
          const updateData = {
            full_name: leadData.full_name,
            email: leadData.email || existingLead.email,
            city: leadData.city || existingLead.city,
            address: leadData.address || existingLead.address,
          };

          // Append notes if provided
          if (leadData.notes) {
            updateData.notes = existingLead.notes 
              ? `${existingLead.notes}\n[${new Date().toLocaleDateString('he-IL')}] ${leadData.notes}`.trim()
              : leadData.notes;
          }

          await base44.entities.Lead.update(existingLead.id, updateData);
          results.updated++;
        } else {
          // Create new lead
          const newLead = await base44.entities.Lead.create({
            full_name: leadData.full_name,
            phone: leadData.phone,
            email: leadData.email || '',
            city: leadData.city || '',
            address: leadData.address || '',
            source: leadData.source || 'digital',
            status: 'new',
            notes: leadData.notes || '',
            rep1: leadData.rep1 || user.email,
            effective_sort_date: new Date().toISOString(),
          });

          // Task creation is handled by the createSalesTaskForNewLead automation trigger

          results.created++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${leadData.phone}: ${error.message}`);
      }
    }

    return Response.json({
      success: true,
      results: {
        created: results.created,
        updated: results.updated,
        failed: results.failed,
        total: leads.length,
        errors: results.errors.length > 0 ? results.errors : undefined
      }
    });

  } catch (error) {
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});