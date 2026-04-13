import { corsHeaders, getUser } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { prompt, response_json_schema, model } = await req.json();

    if (!prompt) {
      return Response.json({ error: 'Missing required field: prompt' }, { status: 400, headers: corsHeaders });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('OPENAI_API_KEY');

    if (!apiKey) {
      return Response.json({
        error: 'No LLM API key configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)',
      }, { status: 500, headers: corsHeaders });
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
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const result = await res.json();
      if (!res.ok) return Response.json({ error: 'LLM API error', details: result }, { status: 500, headers: corsHeaders });

      const text = result.content?.[0]?.text || '';

      // If JSON schema requested, try to parse
      if (response_json_schema) {
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) return Response.json(JSON.parse(jsonMatch[0]), { headers: corsHeaders });
        } catch {}
      }

      return Response.json({ result: text }, { headers: corsHeaders });
    }

    // Fallback to OpenAI
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
    });

    const result = await res.json();
    if (!res.ok) return Response.json({ error: 'LLM API error', details: result }, { status: 500, headers: corsHeaders });

    const text = result.choices?.[0]?.message?.content || '';

    if (response_json_schema) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return Response.json(JSON.parse(jsonMatch[0]), { headers: corsHeaders });
      } catch {}
    }

    return Response.json({ result: text }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
