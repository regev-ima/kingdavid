import { corsHeaders } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, subject, body, html } = await req.json();

    if (!to || !subject) {
      return Response.json({ error: 'Missing required fields: to, subject' }, { status: 400, headers: corsHeaders });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'King David CRM <noreply@kingdavid.co.il>';

    if (!resendApiKey) {
      // Fallback: log the email and return success (for testing)
      console.log(`[EMAIL] To: ${to}, Subject: ${subject}`);
      return Response.json({
        success: true,
        message: 'Email logged (RESEND_API_KEY not configured)',
        to, subject
      }, { headers: corsHeaders });
    }

    // Send via Resend API
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
        html: html || body?.replace(/\n/g, '<br>') || '',
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
