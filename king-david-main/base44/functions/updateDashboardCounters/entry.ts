import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Helper to fetch all records of an entity
    const fetchAll = async (entity, sort = '-created_date', batchSize = 500) => {
      const all = [];
      let skip = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities[entity].list(sort, batchSize, skip);
        all.push(...batch);
        if (batch.length < batchSize) break;
        skip += batchSize;
        await sleep(200);
      }
      return all;
    };

    // Fetch all data in parallel where possible
    const [allLeads, allOrders, allQuotes, allCallLogs, allWhatsappLogs, allUpsellSuggestions, allUsers] = await Promise.all([
      fetchAll('Lead'),
      fetchAll('Order'),
      fetchAll('Quote'),
      fetchAll('CallLog', '-call_started_at'),
      fetchAll('WhatsAppMessageLog', '-created_date'),
      fetchAll('UpsellSuggestion'),
      base44.asServiceRole.entities.User.list(),
    ]);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // === Today's KPIs ===
    const todayLeads = allLeads.filter(l => {
      const d = new Date(l.created_date);
      return d >= todayStart && d <= todayEnd;
    });
    const todayOrders = allOrders.filter(o => {
      const d = new Date(o.created_date);
      return d >= todayStart && d <= todayEnd;
    });
    const todayQuotes = allQuotes.filter(q => {
      const d = new Date(q.created_date);
      return d >= todayStart && d <= todayEnd;
    });

    // === SLA Red (no first_action_at, older than 15 min) ===
    const slaRedLeads = allLeads.filter(l => {
      if (l.first_action_at) return false;
      const minutesElapsed = (now - new Date(l.created_date)) / 60000;
      return minutesElapsed > 15;
    });

    // === Average First Response Time ===
    const leadsWithResponse = allLeads.filter(l => l.first_action_at);
    const avgFirstResponseTime = leadsWithResponse.length > 0
      ? Math.round(leadsWithResponse.reduce((sum, l) => {
          return sum + (new Date(l.first_action_at) - new Date(l.created_date)) / 60000;
        }, 0) / leadsWithResponse.length)
      : 0;

    // === Upsell Rate ===
    const ordersWithUpsell = allOrders.filter(o => o.extras && o.extras.length > 0).length;
    const upsellAttachRate = allOrders.length > 0
      ? Math.round((ordersWithUpsell / allOrders.length) * 100)
      : 0;

    // === No Answer + WhatsApp Stats ===
    const noAnswerCalls = allCallLogs.filter(log => log.call_result === 'no_answer' || log.call_result === 'busy');
    const autoWhatsApps = allWhatsappLogs.filter(log => log.message_type === 'auto');
    const whatsappReturnRate = autoWhatsApps.length > 0
      ? Math.round((autoWhatsApps.filter(wa => {
          const lead = allLeads.find(l => l.id === wa.lead_id);
          return lead && lead.status !== 'new';
        }).length / autoWhatsApps.length) * 100)
      : 0;

    // === Recent No-Answer list (top 5 for widget) ===
    const recentNoAnswer = noAnswerCalls.slice(0, 10).map(log => {
      const lead = allLeads.find(l => l.id === log.lead_id);
      const waLog = allWhatsappLogs.find(w => w.lead_id === log.lead_id);
      if (!lead) return null;
      return {
        lead_name: lead.full_name,
        lead_phone: lead.phone,
        lead_id: lead.id,
        call_time: log.call_started_at,
        whatsapp_sent: !!waLog,
      };
    }).filter(Boolean).slice(0, 5);

    // === Upsell Widget Data ===
    const totalSuggestions = allUpsellSuggestions.length;
    const addedSuggestions = allUpsellSuggestions.filter(s => s.status === 'added').length;
    const upsellSuggestionRate = totalSuggestions > 0
      ? Math.round((addedSuggestions / totalSuggestions) * 100)
      : 0;

    const declineReasons = {};
    allUpsellSuggestions.filter(s => s.decline_reason).forEach(s => {
      declineReasons[s.decline_reason] = (declineReasons[s.decline_reason] || 0) + 1;
    });
    const topDeclineReason = Object.entries(declineReasons).sort((a, b) => b[1] - a[1])[0];

    const quotesWithoutUpsell = allQuotes.filter(q => {
      const hasSuggestion = allUpsellSuggestions.some(s => s.quote_id === q.id);
      return q.status === 'sent' && !hasSuggestion;
    }).slice(0, 5).map(q => ({
      id: q.id,
      quote_number: q.quote_number,
      customer_name: q.customer_name,
    }));

    // === Rep Performance ===
    const salesReps = allUsers.filter(u => u.role === 'user' || u.role === 'admin');
    const repPerformance = salesReps.map(rep => {
      // Include only leads assigned to rep (rep1/rep2), NOT pending leads
      const repLeads = allLeads.filter(l => 
        l.rep1 === rep.email || 
        l.rep2 === rep.email
      );
      const openLeads = repLeads.filter(l => !['won', 'lost', 'archived', 'deal_closed'].includes(l.status));
      const closedLeads = repLeads.filter(l => ['won', 'lost', 'archived', 'deal_closed'].includes(l.status));
      const newLeads = repLeads.filter(l => l.status === 'new_lead');
      const slaRed = repLeads.filter(l => {
        if (l.first_action_at) return false;
        return (now - new Date(l.created_date)) / 60000 > 15;
      }).length;

      return {
        name: rep.full_name,
        email: rep.email,
        profile_icon: rep.profile_icon,
        totalLeads: repLeads.length,
        openLeads: openLeads.length,
        closedLeads: closedLeads.length,
        newLeads: newLeads.length,
        slaRedCount: slaRed,
      };
    }).sort((a, b) => {
      // Sort by total leads
      if (a.totalLeads === 0 && b.totalLeads === 0) return a.name.localeCompare(b.name);
      if (a.totalLeads === 0) return 1;
      if (b.totalLeads === 0) return -1;
      return b.totalLeads - a.totalLeads;
    });

    // === Expiring Quotes ===
    const expiringQuotes = allQuotes.filter(q => {
      if (q.status !== 'sent' || !q.valid_until) return false;
      const daysUntilExpiry = Math.ceil((new Date(q.valid_until) - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry <= 3 && daysUntilExpiry >= 0;
    }).slice(0, 6).map(q => ({
      id: q.id,
      quote_number: q.quote_number,
      customer_name: q.customer_name,
      total: q.total,
      valid_until: q.valid_until,
      days_left: Math.ceil((new Date(q.valid_until) - now) / (1000 * 60 * 60 * 24)),
    }));

    // === Build counters map ===
    const countersToSave = {
      today_leads: { value: todayLeads.length },
      today_orders: { value: todayOrders.length },
      today_quotes: { value: todayQuotes.length },
      sla_red: { value: slaRedLeads.length },
      avg_response_time: { value: avgFirstResponseTime },
      upsell_rate: { value: upsellAttachRate },
      no_answer_count: { value: noAnswerCalls.length },
      auto_whatsapp_count: { value: autoWhatsApps.length },
      whatsapp_return_rate: { value: whatsappReturnRate },
      recent_no_answer_json: { json_value: JSON.stringify(recentNoAnswer) },
      upsell_total_suggestions: { value: totalSuggestions },
      upsell_added_suggestions: { value: addedSuggestions },
      upsell_suggestion_rate: { value: upsellSuggestionRate },
      upsell_top_decline: { json_value: topDeclineReason ? JSON.stringify({ reason: topDeclineReason[0], count: topDeclineReason[1] }) : '{}' },
      upsell_opportunities_json: { json_value: JSON.stringify(quotesWithoutUpsell) },
      rep_performance_json: { json_value: JSON.stringify(repPerformance) },
      expiring_quotes_json: { json_value: JSON.stringify(expiringQuotes) },
    };

    // === Upsert counters ===
    const existingCounters = await base44.asServiceRole.entities.DashboardCounter.list('-created_date', 200);
    const existingMap = {};
    for (const c of existingCounters) {
      existingMap[c.counter_key] = c;
    }

    const toCreate = [];
    const toUpdate = [];

    for (const [key, data] of Object.entries(countersToSave)) {
      const existing = existingMap[key];
      if (existing) {
        const needsUpdate =
          (data.value !== undefined && existing.value !== data.value) ||
          (data.json_value !== undefined && existing.json_value !== data.json_value);
        if (needsUpdate) {
          toUpdate.push({ id: existing.id, data });
        }
        delete existingMap[key];
      } else {
        toCreate.push({ counter_key: key, value: data.value || 0, json_value: data.json_value || '' });
      }
    }

    // Create new
    if (toCreate.length > 0) {
      await base44.asServiceRole.entities.DashboardCounter.bulkCreate(toCreate);
    }

    // Update existing
    for (let i = 0; i < toUpdate.length; i += 5) {
      const batch = toUpdate.slice(i, i + 5);
      await Promise.all(batch.map(item =>
        base44.asServiceRole.entities.DashboardCounter.update(item.id, item.data)
      ));
      if (i + 5 < toUpdate.length) await sleep(100);
    }

    // Delete stale
    const staleIds = Object.values(existingMap).map(c => c.id);
    for (const id of staleIds) {
      await base44.asServiceRole.entities.DashboardCounter.delete(id);
    }

    return Response.json({
      success: true,
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: staleIds.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});