import { createServiceClient, corsHeaders, getUser } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  try {
    const supabase = createServiceClient();

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Helper to fetch all records from a table with pagination
    const fetchAll = async (table: string, orderCol = 'created_date', batchSize = 500): Promise<any[]> => {
      const all: any[] = [];
      let skip = 0;
      while (true) {
        const { data: batch } = await supabase
          .from(table)
          .select('*')
          .order(orderCol, { ascending: false })
          .range(skip, skip + batchSize - 1);

        if (!batch || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < batchSize) break;
        skip += batchSize;
        await sleep(200);
      }
      return all;
    };

    // Fetch all data in parallel where possible
    const [allLeads, allOrders, allQuotes, allCallLogs, allWhatsappLogs, allUpsellSuggestions, allUsers] = await Promise.all([
      fetchAll('leads'),
      fetchAll('orders'),
      fetchAll('quotes'),
      fetchAll('call_logs', 'call_started_at'),
      fetchAll('whatsapp_message_logs'),
      fetchAll('upsell_suggestions'),
      supabase.from('users').select('*').then(r => r.data || []),
    ]);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // === Today's KPIs ===
    const todayLeads = allLeads.filter((l: any) => {
      const d = new Date(l.created_date);
      return d >= todayStart && d <= todayEnd;
    });
    const todayOrders = allOrders.filter((o: any) => {
      const d = new Date(o.created_date);
      return d >= todayStart && d <= todayEnd;
    });
    const todayQuotes = allQuotes.filter((q: any) => {
      const d = new Date(q.created_date);
      return d >= todayStart && d <= todayEnd;
    });

    // === SLA Red (no first_action_at, older than 15 min) ===
    const slaRedLeads = allLeads.filter((l: any) => {
      if (l.first_action_at) return false;
      const minutesElapsed = (now.getTime() - new Date(l.created_date).getTime()) / 60000;
      return minutesElapsed > 15;
    });

    // === Average First Response Time ===
    const leadsWithResponse = allLeads.filter((l: any) => l.first_action_at);
    const avgFirstResponseTime = leadsWithResponse.length > 0
      ? Math.round(leadsWithResponse.reduce((sum: number, l: any) => {
          return sum + (new Date(l.first_action_at).getTime() - new Date(l.created_date).getTime()) / 60000;
        }, 0) / leadsWithResponse.length)
      : 0;

    // === Upsell Rate ===
    const ordersWithUpsell = allOrders.filter((o: any) => o.extras && o.extras.length > 0).length;
    const upsellAttachRate = allOrders.length > 0
      ? Math.round((ordersWithUpsell / allOrders.length) * 100)
      : 0;

    // === No Answer + WhatsApp Stats ===
    const noAnswerCalls = allCallLogs.filter((log: any) => log.call_result === 'no_answer' || log.call_result === 'busy');
    const autoWhatsApps = allWhatsappLogs.filter((log: any) => log.message_type === 'auto');
    const whatsappReturnRate = autoWhatsApps.length > 0
      ? Math.round((autoWhatsApps.filter((wa: any) => {
          const lead = allLeads.find((l: any) => l.id === wa.lead_id);
          return lead && lead.status !== 'new';
        }).length / autoWhatsApps.length) * 100)
      : 0;

    // === Recent No-Answer list (top 5 for widget) ===
    const recentNoAnswer = noAnswerCalls.slice(0, 10).map((log: any) => {
      const lead = allLeads.find((l: any) => l.id === log.lead_id);
      const waLog = allWhatsappLogs.find((w: any) => w.lead_id === log.lead_id);
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
    const addedSuggestions = allUpsellSuggestions.filter((s: any) => s.status === 'added').length;
    const upsellSuggestionRate = totalSuggestions > 0
      ? Math.round((addedSuggestions / totalSuggestions) * 100)
      : 0;

    const declineReasons: Record<string, number> = {};
    allUpsellSuggestions.filter((s: any) => s.decline_reason).forEach((s: any) => {
      declineReasons[s.decline_reason] = (declineReasons[s.decline_reason] || 0) + 1;
    });
    const topDeclineReason = Object.entries(declineReasons).sort((a, b) => b[1] - a[1])[0];

    const quotesWithoutUpsell = allQuotes.filter((q: any) => {
      const hasSuggestion = allUpsellSuggestions.some((s: any) => s.quote_id === q.id);
      return q.status === 'sent' && !hasSuggestion;
    }).slice(0, 5).map((q: any) => ({
      id: q.id,
      quote_number: q.quote_number,
      customer_name: q.customer_name,
    }));

    // === Rep Performance ===
    const salesReps = allUsers.filter((u: any) => u.role === 'user' || u.role === 'admin');
    const repPerformance = salesReps.map((rep: any) => {
      const repLeads = allLeads.filter((l: any) =>
        l.rep1 === rep.email ||
        l.rep2 === rep.email
      );
      const openLeads = repLeads.filter((l: any) => !['won', 'lost', 'archived', 'deal_closed'].includes(l.status));
      const closedLeads = repLeads.filter((l: any) => ['won', 'lost', 'archived', 'deal_closed'].includes(l.status));
      const newLeads = repLeads.filter((l: any) => l.status === 'new_lead');
      const slaRed = repLeads.filter((l: any) => {
        if (l.first_action_at) return false;
        return (now.getTime() - new Date(l.created_date).getTime()) / 60000 > 15;
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
    }).sort((a: any, b: any) => {
      if (a.totalLeads === 0 && b.totalLeads === 0) return a.name.localeCompare(b.name);
      if (a.totalLeads === 0) return 1;
      if (b.totalLeads === 0) return -1;
      return b.totalLeads - a.totalLeads;
    });

    // === Expiring Quotes ===
    const expiringQuotes = allQuotes.filter((q: any) => {
      if (q.status !== 'sent' || !q.valid_until) return false;
      const daysUntilExpiry = Math.ceil((new Date(q.valid_until).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry <= 3 && daysUntilExpiry >= 0;
    }).slice(0, 6).map((q: any) => ({
      id: q.id,
      quote_number: q.quote_number,
      customer_name: q.customer_name,
      total: q.total,
      valid_until: q.valid_until,
      days_left: Math.ceil((new Date(q.valid_until).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    }));

    // === Build counters map ===
    const countersToSave: Record<string, any> = {
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
    const { data: existingCounters } = await supabase
      .from('dashboard_counters')
      .select('*')
      .order('created_date', { ascending: false })
      .limit(200);

    const existingMap: Record<string, any> = {};
    for (const c of existingCounters || []) {
      existingMap[c.counter_key] = c;
    }

    const toCreate: any[] = [];
    const toUpdate: any[] = [];

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
      await supabase
        .from('dashboard_counters')
        .insert(toCreate);
    }

    // Update existing
    for (let i = 0; i < toUpdate.length; i += 5) {
      const batch = toUpdate.slice(i, i + 5);
      await Promise.all(batch.map((item: any) =>
        supabase
          .from('dashboard_counters')
          .update(item.data)
          .eq('id', item.id)
      ));
      if (i + 5 < toUpdate.length) await sleep(100);
    }

    // Delete stale
    const staleIds = Object.values(existingMap).map((c: any) => c.id);
    for (const id of staleIds) {
      await supabase
        .from('dashboard_counters')
        .delete()
        .eq('id', id);
    }

    return Response.json({
      success: true,
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: staleIds.length,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
