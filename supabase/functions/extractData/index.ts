import { corsHeaders, getUser } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { file_url, json_schema } = await req.json();

    if (!file_url) {
      return Response.json({ error: 'Missing required field: file_url' }, { status: 400, headers: corsHeaders });
    }

    // Fetch the file content
    const fileRes = await fetch(file_url);
    if (!fileRes.ok) {
      return Response.json({ error: 'Failed to fetch file' }, { status: 400, headers: corsHeaders });
    }

    const fileContent = await fileRes.text();

    // Use LLM to extract structured data
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('OPENAI_API_KEY');

    if (!apiKey) {
      // Fallback: try CSV parsing
      const lines = fileContent.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        return Response.json({ rows: [], headers: [] }, { headers: corsHeaders });
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = values[i] || ''; });
        return row;
      });

      return Response.json({ headers, rows }, { headers: corsHeaders });
    }

    // Use LLM for smarter extraction
    const prompt = `Extract structured data from the following file content. ${json_schema ? `Use this schema: ${JSON.stringify(json_schema)}` : 'Return an array of objects.'}\n\nFile content:\n${fileContent.slice(0, 10000)}\n\nReturn valid JSON only.`;

    const llmUrl = Deno.env.get('ANTHROPIC_API_KEY')
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.openai.com/v1/chat/completions';

    const llmHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let llmBody: any;

    if (Deno.env.get('ANTHROPIC_API_KEY')) {
      llmHeaders['x-api-key'] = Deno.env.get('ANTHROPIC_API_KEY')!;
      llmHeaders['anthropic-version'] = '2023-06-01';
      llmBody = { model: 'claude-sonnet-4-20250514', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] };
    } else {
      llmHeaders['Authorization'] = `Bearer ${Deno.env.get('OPENAI_API_KEY')}`;
      llmBody = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 4096 };
    }

    const llmRes = await fetch(llmUrl, { method: 'POST', headers: llmHeaders, body: JSON.stringify(llmBody) });
    const llmResult = await llmRes.json();

    let text = '';
    if (Deno.env.get('ANTHROPIC_API_KEY')) {
      text = llmResult.content?.[0]?.text || '';
    } else {
      text = llmResult.choices?.[0]?.message?.content || '';
    }

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) return Response.json(JSON.parse(jsonMatch[0]), { headers: corsHeaders });
    } catch {}

    return Response.json({ raw: text }, { headers: corsHeaders });
  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
});
