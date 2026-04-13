import { corsHeaders } from '../_shared/supabase.ts';

function buildEmailTemplate(subject: string, body: string, options?: {
  quote_number?: string;
  customer_name?: string;
  total?: string;
  pdf_url?: string;
  valid_until?: string;
}) {
  const logoUrl = 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png';

  // If it's a quote email, use special template
  if (options?.quote_number) {
    return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;direction:rtl;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;direction:rtl;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);padding:40px 32px;text-align:center;">
      <img src="${logoUrl}" alt="King David" style="height:70px;margin-bottom:12px;">
      <p style="color:#fbbf24;font-size:16px;margin:0 0 4px;font-weight:600;">לילות שלווים</p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 16px;">מתחילים במזרן הנכון | מזרני קינג דוד</p>
      <div style="height:1px;background:linear-gradient(90deg,transparent,#fbbf24,transparent);margin:16px auto 12px;max-width:200px;"></div>
      <h1 style="color:#ffffff;font-size:18px;margin:0;font-weight:400;">הצעת מחיר מס׳ ${options.quote_number}</h1>
    </div>

    <!-- Body -->
    <div style="padding:32px;text-align:right;direction:rtl;">
      <p style="font-size:16px;color:#1e293b;margin:0 0 16px;text-align:right;">שלום ${options.customer_name || ''},</p>
      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;text-align:right;">
        מצורפת הצעת מחיר מקינג דוד.<br>
        אנו מקווים שתמצא את ההצעה מתאימה עבורך.
      </p>

      <!-- Quote Summary Card -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:0 0 24px;direction:rtl;">
        <table style="width:100%;border-collapse:collapse;direction:rtl;">
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;text-align:right;">מספר הצעה</td>
            <td style="padding:8px 0;color:#1e293b;font-weight:600;font-size:14px;text-align:left;">${options.quote_number}</td>
          </tr>
          ${options.total ? `<tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;text-align:right;">סה״כ</td>
            <td style="padding:8px 0;color:#1e293b;font-weight:700;font-size:18px;text-align:left;">₪${options.total}</td>
          </tr>` : ''}
          ${options.valid_until ? `<tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;text-align:right;">תוקף ההצעה</td>
            <td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:left;">${options.valid_until}</td>
          </tr>` : ''}
        </table>
      </div>

      ${options.pdf_url ? `
      <!-- CTA Button -->
      <div style="text-align:center;margin:32px 0;">
        <a href="${options.pdf_url}" style="display:inline-block;background:linear-gradient(135deg,#1e293b,#334155);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:600;">
          צפה בהצעת המחיר
        </a>
      </div>` : ''}

      <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:24px 0 0;text-align:center;">
        לשאלות או הבהרות, אנחנו כאן בשבילך.<br>
        ניתן ליצור קשר בטלפון: 1700-700-464
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">
        בברכה, צוות קינג דוד<br>
        <a href="https://kingdavid4u.co.il" style="color:#fbbf24;text-decoration:none;">kingdavid4u.co.il</a>
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  // Default styled email template
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);padding:40px 32px;text-align:center;">
      <img src="${logoUrl}" alt="King David" style="height:70px;margin-bottom:12px;">
      <p style="color:#fbbf24;font-size:16px;margin:0 0 4px;font-weight:600;">לילות שלווים</p>
      <p style="color:#94a3b8;font-size:13px;margin:0;">מתחילים במזרן הנכון | מזרני קינג דוד</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;text-align:right;">
      <div style="font-size:15px;color:#374151;line-height:1.8;text-align:right;">
        ${body.replace(/\n/g, '<br>')}
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">
        בברכה, צוות קינג דוד<br>
        <a href="https://kingdavid4u.co.il" style="color:#fbbf24;text-decoration:none;">kingdavid4u.co.il</a> | 1700-700-464
      </p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, subject, body, html, quote_number, customer_name, total, pdf_url, valid_until } = await req.json();

    if (!to || !subject) {
      return Response.json({ error: 'Missing required fields: to, subject' }, { status: 400, headers: corsHeaders });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'King David CRM <noreply@kingdavid.co.il>';

    if (!resendApiKey) {
      console.log(`[EMAIL] To: ${to}, Subject: ${subject}`);
      return Response.json({ success: true, message: 'Email logged (RESEND_API_KEY not configured)', to, subject }, { headers: corsHeaders });
    }

    // Build styled HTML
    const styledHtml = html || buildEmailTemplate(subject, body || '', { quote_number, customer_name, total, pdf_url, valid_until });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: styledHtml,
        text: body || '',
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      return Response.json({ error: 'Failed to send email', details: result }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ success: true, id: result.id }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: corsHeaders });
  }
});
