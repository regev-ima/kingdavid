import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, api_key, x-webhook-secret, Authorization',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      });
    }

    const expectedSecret = Deno.env.get('UPSERT_LEAD_WEBHOOK_SECRET');
    const authorizationHeader = req.headers.get('authorization') || '';
    const providedSecret =
      req.headers.get('api_key') ||
      req.headers.get('x-webhook-secret') ||
      authorizationHeader.replace(/^Bearer\s+/i, '');

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return Response.json(
        { success: false, error: 'Unauthorized' },
        {
          status: 401,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const base44 = createClientFromRequest(req);
    const leadData = await req.json();

    if (!leadData.full_name || !leadData.phone) {
      return Response.json(
        { error: 'Missing required fields: full_name and phone are required' },
        {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

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
      leadData.status = 'new_lead';
    }

    let existingLead = null;

    if (leadData.unique_id) {
      const leads = await base44.asServiceRole.entities.Lead.filter({ unique_id: leadData.unique_id }, '', 1);
      if (leads.length > 0) {
        existingLead = leads[0];
      }
    }

    if (!existingLead) {
      const leads = await base44.asServiceRole.entities.Lead.filter({ phone: leadData.phone }, '', 1);
      if (leads.length > 0) {
        existingLead = leads[0];
      }
    }

    let allUsers = null;
    const needsUserCheck = leadData.pending_rep_email || (existingLead?.pending_rep_email && !existingLead?.rep1);
    if (needsUserCheck) {
      try {
        allUsers = await base44.asServiceRole.entities.User.list();
      } catch (e) {
        console.warn('Could not load users:', e.message);
      }
    }

    if (leadData.pending_rep_email && allUsers) {
      const matchingUser = allUsers.find((u) => u.email === leadData.pending_rep_email);
      if (matchingUser) {
        leadData.rep1 = leadData.pending_rep_email;
        leadData.pending_rep_email = '';
      }
    }

    if (existingLead) {
      const now = new Date().toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      const newNote = `עודכן מ-API - ${now}`;
      const nowISO = new Date().toISOString();
      const updateData = {
        ...leadData,
        notes: existingLead.notes ? `${existingLead.notes}\n${newNote}` : newNote,
        last_api_update: nowISO,
        effective_sort_date: nowISO,
      };

      if (existingLead.pending_rep_email && !existingLead.rep1 && !updateData.rep1 && allUsers) {
        const matchingUser = allUsers.find((u) => u.email === existingLead.pending_rep_email);
        if (matchingUser) {
          updateData.rep1 = existingLead.pending_rep_email;
          updateData.pending_rep_email = '';
        }
      }

      const updatedLead = await base44.asServiceRole.entities.Lead.update(existingLead.id, updateData);

      return Response.json(
        {
          success: true,
          action: 'updated',
          lead: updatedLead,
          message: `ליד ${leadData.full_name} עודכן בהצלחה`
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const nowISO = new Date().toISOString();
    const newLead = await base44.asServiceRole.entities.Lead.create({
      ...leadData,
      last_api_update: nowISO,
      effective_sort_date: nowISO,
    });

    return Response.json(
      {
        success: true,
        action: 'created',
        lead: newLead,
        message: `ליד ${leadData.full_name} נוצר בהצלחה`
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Upsert lead error:', error);
    return Response.json(
      {
        error: error.message,
        success: false
      },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});