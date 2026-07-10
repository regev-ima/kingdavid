import { getCorsHeaders, getUser, createServiceClient } from '../_shared/supabase.ts';

// Model ids (substrings) that flag a catalog entry as a "smart / flagship"
// recommendation in the AI-settings picker, regardless of price. Kept here
// (not hardcoded model ids on the frontend) so the recommended set tracks
// whatever's actually live in OpenRouter's catalog instead of going stale.
const SMART_MODEL_HINTS = [
  'gpt-4o', 'gpt-5', 'o1', 'o3', 'claude-3.5', 'claude-3-opus', 'claude-sonnet-4',
  'claude-opus', 'gemini-1.5-pro', 'gemini-2', 'deepseek-r1', 'deepseek-v3',
  'llama-3.1-405b', 'llama-3.3-70b', 'qwen2.5-72b', 'grok-2', 'grok-3', 'mistral-large',
];

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

Deno.serve(async (req) => {
  // Dynamic CORS so Vercel preview origins (…-regevs-projects.vercel.app) are
  // allowed too — the static corsHeaders only permits the canonical domain,
  // which made every invokeLLM call fail from a preview deployment.
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });

    const body = await req.json();

    // Proxy OpenRouter's public model catalog so the AI-settings picker gets
    // a live, price-sorted list without any key reaching the browser.
    if (body?.action === 'list_models') {
      const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: openrouterKey ? { Authorization: `Bearer ${openrouterKey}` } : {},
      });
      if (!res.ok) {
        return Response.json({ ok: false, error: 'openrouter_unavailable' }, { status: 502, headers: cors });
      }
      const json = await res.json();
      const all = (json?.data || [])
        .filter((m: any) => !String(m?.id || '').endsWith(':free'))
        .map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          context_length: m.context_length || null,
          prompt_price: Number(m.pricing?.prompt) || 0,
          completion_price: Number(m.pricing?.completion) || 0,
        }))
        .filter((m: any) => m.prompt_price > 0 || m.completion_price > 0);

      const cheapest = [...all]
        .sort((a: any, b: any) => (a.prompt_price + a.completion_price) - (b.prompt_price + b.completion_price))
        .slice(0, 15);
      const recommended = all.filter((m: any) =>
        SMART_MODEL_HINTS.some((hint) => m.id.toLowerCase().includes(hint)));

      return Response.json(
        { ok: true, openrouter_configured: !!openrouterKey, recommended, cheapest },
        { headers: cors },
      );
    }

    const { prompt, response_json_schema, model: modelOverride } = body;

    if (!prompt) {
      return Response.json({ error: 'Missing required field: prompt' }, { status: 400, headers: cors });
    }

    // OpenRouter (phase 2, admin-selectable model) takes priority once
    // configured; otherwise fall back to the original direct Anthropic/OpenAI
    // path below so nothing breaks before the secret is added.
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (openrouterKey) {
      let model = modelOverride;
      if (!model) {
        const svc = createServiceClient();
        const { data: settings } = await svc.from('ai_settings').select('model').eq('id', 1).maybeSingle();
        model = settings?.model || DEFAULT_OPENROUTER_MODEL;
      }

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://kingdavid.imagick.ai',
          'X-Title': 'King David CRM',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4096,
        }),
      });

      const result = await res.json();
      if (!res.ok) return Response.json({ error: 'LLM API error', details: result }, { status: 500, headers: cors });

      const text = result.choices?.[0]?.message?.content || '';

      if (response_json_schema) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) return Response.json(JSON.parse(jsonMatch[0]), { headers: cors });
        } catch { /* fall through to raw text below */ }
      }

      return Response.json({ result: text }, { headers: cors });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('OPENAI_API_KEY');

    if (!apiKey) {
      return Response.json({
        error: 'No LLM API key configured (set OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)',
      }, { status: 500, headers: cors });
    }

    // Try Anthropic first
    if (Deno.env.get('ANTHROPIC_API_KEY')) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelOverride || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const result = await res.json();
      if (!res.ok) return Response.json({ error: 'LLM API error', details: result }, { status: 500, headers: cors });

      const text = result.content?.[0]?.text || '';

      // If JSON schema requested, try to parse
      if (response_json_schema) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) return Response.json(JSON.parse(jsonMatch[0]), { headers: cors });
        } catch {}
      }

      return Response.json({ result: text }, { headers: cors });
    }

    // Fallback to OpenAI
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify({
        model: modelOverride || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
    });

    const result = await res.json();
    if (!res.ok) return Response.json({ error: 'LLM API error', details: result }, { status: 500, headers: cors });

    const text = result.choices?.[0]?.message?.content || '';

    if (response_json_schema) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return Response.json(JSON.parse(jsonMatch[0]), { headers: cors });
      } catch {}
    }

    return Response.json({ result: text }, { headers: cors });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: cors });
  }
});
