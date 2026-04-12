import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data: lead, old_data: oldLead } = await req.json();
    
    if (!lead) {
      return Response.json({ error: 'No lead data provided' }, { status: 400 });
    }

    console.log(`Processing lead counter update for event: ${event.type}, lead: ${lead.id}`);

    // Helper to update or create counter
    const upsertCounter = async (key, repEmail = '') => {
      const existing = await base44.asServiceRole.entities.LeadCounter.filter({
        counter_key: key,
        rep_email: repEmail || ''
      });

      if (existing.length > 0) {
        // Counter exists, increment/decrement based on event
        const current = existing[0];
        const newCount = event.type === 'create' 
          ? current.count + 1 
          : event.type === 'delete' 
            ? Math.max(0, current.count - 1)
            : current.count; // update doesn't change total count

        await base44.asServiceRole.entities.LeadCounter.update(current.id, {
          count: newCount
        });
      } else if (event.type === 'create') {
        // Create new counter starting at 1
        await base44.asServiceRole.entities.LeadCounter.create({
          counter_key: key,
          count: 1,
          rep_email: repEmail || ''
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
        const counter = await base44.asServiceRole.entities.LeadCounter.filter({
          counter_key: 'unassigned',
          rep_email: ''
        });
        if (counter.length > 0) {
          await base44.asServiceRole.entities.LeadCounter.update(counter[0].id, {
            count: Math.max(0, counter[0].count - 1)
          });
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
          const oldCounter = await base44.asServiceRole.entities.LeadCounter.filter({
            counter_key: 'total',
            rep_email: oldLead.rep1
          });
          if (oldCounter.length > 0) {
            await base44.asServiceRole.entities.LeadCounter.update(oldCounter[0].id, {
              count: Math.max(0, oldCounter[0].count - 1)
            });
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
      message: 'Lead counters updated successfully'
    });

  } catch (error) {
    console.error('Error updating lead counters:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});