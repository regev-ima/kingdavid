import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function normalizeLower(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }

function buildCsv(headers, rows) {
  const eh = headers.map(h => `"${String(h).replace(/"/g, '""')}"`);
  const er = rows.map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  return [eh.join(','), ...er].join('\n');
}

function buildExport(data, exportType) {
  const t = normalizeLower(exportType);
  if (t === 'reps') {
    const h = ['נציג','אימייל','לידים בטווח','נסגרו','המרה %','הכנסות ₪','משימות פתוחות','באיחור','SLA אדום'];
    const r = (data?.sales_performance?.reps || []).map(row => [row.rep_name,row.rep_email,row.leads_range,row.won_range,row.conversion_rate,row.revenue,row.workload_open_tasks,row.workload_overdue_tasks,row.sla_red_open]);
    return { filename: 'dashboard_reps.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'sources') {
    const h = ['מקור','לידים','הצעות %','המרה %','הכנסות ₪','הוצאות ₪','ROAS'];
    const r = (data?.marketing_performance?.sources || []).map(row => [row.source,row.leads,row.quote_rate,row.conversion_rate,row.attributed_revenue,row.spend,row.roas ?? '']);
    return { filename: 'dashboard_sources.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'campaigns') {
    const h = ['קמפיין','מקור','לידים','הצעות %','המרה %','הכנסות ₪','הוצאות ₪','ROAS'];
    const r = (data?.marketing_performance?.campaigns || []).map(row => [row.campaign,row.source,row.leads,row.quote_rate,row.conversion_rate,row.attributed_revenue,row.spend,row.roas ?? '']);
    return { filename: 'dashboard_campaigns.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'landing_pages') {
    const h = ['דף נחיתה','מקור','לידים','הצעות %','המרה %','הכנסות ₪'];
    const r = (data?.marketing_performance?.landing_pages || []).map(row => [row.landing_page,row.source,row.leads,row.quote_rate,row.conversion_rate,row.attributed_revenue]);
    return { filename: 'dashboard_landing_pages.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'alerts') {
    const h = ['סוג','חומרה','בעלים','השפעה','סיבה'];
    const r = (data?.smart_alerts || []).map(row => [row.type,row.severity,row.owner,row.impact,row.reason]);
    return { filename: 'dashboard_alerts.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  return { filename: 'dashboard_export.csv', csv: buildCsv(['הודעה'], [['סוג ייצוא לא נתמך']]), rows_count: 1 };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    const exportType = String(body.exportType || 'reps');

    // Call getDashboardStats to get the data
    const statsResponse = await base44.functions.invoke('getDashboardStats', {
      startDate: body.startDate,
      endDate: body.endDate,
    });

    const data = statsResponse.data || statsResponse;
    const csvPayload = buildExport(data, exportType);

    return Response.json({
      exportType,
      file_name: csvPayload.filename,
      csv: csvPayload.csv,
      rows_count: csvPayload.rows_count,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
});