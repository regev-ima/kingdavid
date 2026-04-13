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
          await supabase.from('leads').update(updateData).eq('id', existingLead.id);
          results.updated++;
        } else {
          await supabase.from('leads').insert({
            full_name: leadData.full_name,
            phone: leadData.phone,
            email: leadData.email || '',
            city: leadData.city || '',
            address: leadData.address || '',
            source: leadData.source || 'digital',
            status: 'new_lead',
            notes: leadData.notes || '',
            rep1: leadData.rep1 || user.email,
            effective_sort_date: new Date().toISOString(),
          });
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
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
