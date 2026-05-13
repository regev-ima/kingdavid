import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

// Audio playback proxy. Voicenter exposes recording URLs over HTTP only,
// and the browser refuses to play them inline because the app runs on HTTPS
// (Mixed Content). This function fetches the recording server-side and
// streams it back over our HTTPS origin.

Deno.serve(async (req) => {
  const corsHeaders = {
    ...getCorsHeaders(req),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Accept call_log id from either query string (GET, easy for <audio src>)
    // or JSON body (POST, used by base44.functions.invoke).
    let callLogId: string | null = null;
    const url = new URL(req.url);
    callLogId = url.searchParams.get('id');
    if (!callLogId && req.method === 'POST') {
      try {
        const body = await req.json();
        callLogId = body?.id ?? null;
      } catch {
        // ignore
      }
    }

    if (!callLogId) {
      return Response.json({ error: 'Missing id' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createServiceClient();
    const { data: callLog, error } = await supabase
      .from('call_logs')
      .select('recording_url')
      .eq('id', callLogId)
      .single();

    if (error || !callLog?.recording_url) {
      return Response.json({ error: 'Recording not found' }, { status: 404, headers: corsHeaders });
    }

    const upstream = await fetch(callLog.recording_url);
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: 502, headers: corsHeaders },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg';
    const contentLength = upstream.headers.get('content-length');

    const headers: Record<string, string> = {
      ...corsHeaders,
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
    };
    if (contentLength) headers['Content-Length'] = contentLength;

    return new Response(upstream.body, { headers });
  } catch (error) {
    console.error('streamRecording error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message || 'Internal server error' }, { status: 500, headers: getCorsHeaders(req) });
  }
});
