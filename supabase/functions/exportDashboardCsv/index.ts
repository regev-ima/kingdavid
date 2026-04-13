import { getUser, corsHeaders } from '../_shared/supabase.ts';

function normalizeLower(v: unknown) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }

function buildCsv(headers: string[], rows: any[][]) {
  const eh = headers.map(h => `"${String(h).replace(/"/g, '""')}"`);
  const er = rows.map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  return [eh.join(','), ...er].join('\n');
}

function buildExport(data: any, exportType: string) {
  const t = normalizeLower(exportType);
  if (t === 'reps') {
    const h = ['נציג','אימייל','לידים בטווח','נסגרו','המרה %','הכנסות ₪','משימות פתוחות','באיחור','SLA אדום'];
    const r = (data?.sales_performance?.reps || []).map((row: any) => [row.rep_name,row.rep_email,row.leads_range,row.won_range,row.conversion_rate,row.revenue,row.workload_open_tasks,row.workload_overdue_tasks,row.sla_red_open]);
    return { filename: 'dashboard_reps.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'sources') {
    const h = ['מקור','לידים','הצעות %','המרה %','הכנסות ₪','הוצאות ₪','ROAS'];
    const r = (data?.marketing_performance?.sources || []).map((row: any) => [row.source,row.leads,row.quote_rate,row.conversion_rate,row.attributed_revenue,row.spend,row.roas ?? '']);
    return { filename: 'dashboard_sources.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'campaigns') {
    const h = ['קמפיין','מקור','לידים','הצעות %','המרה %','הכנסות ₪','הוצאות ₪','ROAS'];
    const r = (data?.marketing_performance?.campaigns || []).map((row: any) => [row.campaign,row.source,row.leads,row.quote_rate,row.conversion_rate,row.attributed_revenue,row.spend,row.roas ?? '']);
    return { filename: 'dashboard_campaigns.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'landing_pages') {
    const h = ['דף נחיתה','מקור','לידים','הצעות %','המרה %','הכנסות ₪'];
    const r = (data?.marketing_performance?.landing_pages || []).map((row: any) => [row.landing_page,row.source,row.leads,row.quote_rate,row.conversion_rate,row.attributed_revenue]);
    return { filename: 'dashboard_landing_pages.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  if (t === 'alerts') {
    const h = ['סוג','חומרה','בעלים','השפעה','סיבה'];
    const r = (data?.smart_alerts || []).map((row: any) => [row.type,row.severity,row.owner,row.impact,row.reason]);
    return { filename: 'dashboard_alerts.csv', csv: buildCsv(h, r), rows_count: r.length };
  }
  return { filename: 'dashboard_export.csv', csv: buildCsv(['הודעה'], [['סוג ייצוא לא נתמך']]), rows_count: 1 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const exportType = String(body.exportType || 'reps');

    // Call getDashboardStats edge function internally
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authHeader = req.headers.get('Authorization') || '';

    const statsRes = await fetch(`${supabaseUrl}/functions/v1/getDashboardStats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ startDate: body.startDate, endDate: body.endDate }),
    });

    const data = await statsRes.json();
    const csvPayload = buildExport(data, exportType);

    return Response.json({
      exportType,
      file_name: csvPayload.filename,
      csv: csvPayload.csv,
      rows_count: csvPayload.rows_count,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
