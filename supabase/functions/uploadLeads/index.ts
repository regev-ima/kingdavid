import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const supabase = createServiceClient();
    const { leads } = await req.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return Response.json({ error: 'Invalid input. Expected array of leads.' }, { status: 400, headers: corsHeaders });
    }

    const results = { created: 0, updated: 0, failed: 0, errors: [] as string[] };

    for (const leadData of leads) {
      try {
        if (!leadData.full_name || !leadData.phone) {
          results.failed++;
          results.errors.push(`Missing required fields for lead: ${leadData.phone || 'unknown'}`);
          continue;
        }

        const { data: existing } = await supabase.from('leads').select('*').eq('phone', leadData.phone).limit(1);

        if (existing?.length) {
          const existingLead = existing[0];
          const updateData: any = {
            full_name: leadData.full_name,
            email: leadData.email || existingLead.email,
            city: leadData.city || existingLead.city,
            address: leadData.address || existingLead.address,
          };
          if (leadData.notes) {
            updateData.notes = existingLead.notes
              ? `${existingLead.notes}\n[${new Date().toLocaleDateString('he-IL')}] ${leadData.notes}`.trim()
              : leadData.notes;
          }
          // supabase-js returns { error } instead of throwing — check it so a
          // failed write is counted as failed (via catch) rather than updated.
          const { error: upErr } = await supabase.from('leads').update(updateData).eq('id', existingLead.id);
          if (upErr) throw upErr;
          results.updated++;
        } else {
          const { error: insErr } = await supabase.from('leads').insert({
            full_name: leadData.full_name,
            phone: leadData.phone,
            email: leadData.email || '',
            city: leadData.city || '',
            address: leadData.address || '',
            source: leadData.source || 'digital',
            status: 'new_lead',
            notes: leadData.notes || '',
            // Auto-assignment disabled (product decision). The
            // previous default was to fall back to the uploading user's
            // own email when leadData.rep1 was missing — leads now land
            // unassigned unless the payload explicitly specifies a rep,
            // and a manager triages via /LeadManagement.
            rep1: leadData.rep1 || null,
            effective_sort_date: new Date().toISOString(),
          });
          if (insErr) throw insErr;
          results.created++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${leadData.phone}: ${error.message}`);
      }
    }

    return Response.json({
      success: true,
      results: { created: results.created, updated: results.updated, failed: results.failed, total: leads.length, errors: results.errors.length > 0 ? results.errors : undefined },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
