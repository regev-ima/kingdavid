import { createServiceClient, corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();
    const { event, data: lead, old_data: oldLead } = await req.json();

    if (!lead) {
      return Response.json({ error: 'No lead data provided' }, { status: 400, headers: corsHeaders });
    }

    console.log(`Processing lead counter update for event: ${event.type}, lead: ${lead.id}`);

    // Helper to update or create counter
    const upsertCounter = async (key: string, repEmail = '') => {
      const { data: existing } = await supabase
        .from('lead_counters')
        .select('*')
        .eq('counter_key', key)
        .eq('rep_email', repEmail || '');

      if (existing && existing.length > 0) {
        // Counter exists, increment/decrement based on event
        const current = existing[0];
        const newCount = event.type === 'create'
          ? current.count + 1
          : event.type === 'delete'
            ? Math.max(0, current.count - 1)
            : current.count; // update doesn't change total count

        await supabase
          .from('lead_counters')
          .update({ count: newCount })
          .eq('id', current.id);
      } else if (event.type === 'create') {
        // Create new counter starting at 1
        await supabase
          .from('lead_counters')
          .insert({
            counter_key: key,
            count: 1,
            rep_email: repEmail || '',
          });
      }
    };

    // Update global total
    if (event.type === 'create' || event.type === 'delete') {
      await upsertCounter('total');
    }

    // Update unassigned counter
    const isUnassigned = !lead.rep1 || lead.rep1 === '';
    const wasUnassigned = oldLead && (!oldLead.rep1 || oldLead.rep1 === '');

    if (event.type === 'create' && isUnassigned) {
      await upsertCounter('unassigned');
    } else if (event.type === 'delete' && isUnassigned) {
      await upsertCounter('unassigned'); // Will decrement
    } else if (event.type === 'update') {
      // Check if assignment status changed
      if (wasUnassigned && !isUnassigned) {
        // Was unassigned, now assigned - decrement unassigned
        const { data: counter } = await supabase
          .from('lead_counters')
          .select('*')
          .eq('counter_key', 'unassigned')
          .eq('rep_email', '');

        if (counter && counter.length > 0) {
          await supabase
            .from('lead_counters')
            .update({ count: Math.max(0, counter[0].count - 1) })
            .eq('id', counter[0].id);
        }
      } else if (!wasUnassigned && isUnassigned) {
        // Was assigned, now unassigned - increment unassigned
        await upsertCounter('unassigned');
      }
    }

    // Update rep-specific counters
    if (event.type === 'create' && lead.rep1) {
      await upsertCounter('total', lead.rep1);
    } else if (event.type === 'delete' && lead.rep1) {
      await upsertCounter('total', lead.rep1); // Will decrement
    } else if (event.type === 'update' && oldLead) {
      // Check if rep changed
      if (oldLead.rep1 !== lead.rep1) {
        // Decrement old rep
        if (oldLead.rep1) {
          const { data: oldCounter } = await supabase
            .from('lead_counters')
            .select('*')
            .eq('counter_key', 'total')
            .eq('rep_email', oldLead.rep1);

          if (oldCounter && oldCounter.length > 0) {
            await supabase
              .from('lead_counters')
              .update({ count: Math.max(0, oldCounter[0].count - 1) })
              .eq('id', oldCounter[0].id);
          }
        }
        // Increment new rep
        if (lead.rep1) {
          await upsertCounter('total', lead.rep1);
        }
      }
    }

    return Response.json({
      success: true,
      message: 'Lead counters updated successfully',
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Error updating lead counters:', error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
