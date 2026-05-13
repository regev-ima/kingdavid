import { createServiceClient, getUser, getCorsHeaders } from '../_shared/supabase.ts';

// Audio playback proxy. Voicenter exposes recording URLs over HTTP only,
// and the browser refuses to play them inline because the app runs on HTTPS
// (Mixed Content). This function fetches the recording server-side and
// streams it back over our HTTPS origin.

// Ensure ?code=<VOICENTER_API_KEY> is on the URL — most Voicenter HTTP
// endpoints require it (clickToCall, CDR, etc.) and recording downloads
// behave the same. If Voicenter already included the code we leave it as-is.
function withAuthCode(rawUrl: string, code: string): string {
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has('code') && code) {
      u.searchParams.set('code', code);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

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

    const voicenterApiKey = Deno.env.get('VOICENTER_API_KEY') ?? '';
    const fetchUrl = withAuthCode(callLog.recording_url, voicenterApiKey);

    // Voicenter parks recording downloads behind Cloudflare. Without a
    // browser-like User-Agent and Accept header, Cloudflare answers with a
    // 403 "Just a moment..." JavaScript challenge instead of the audio file.
    const upstream = await fetch(fetchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'audio/mpeg, audio/*, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const upstreamContentType = upstream.headers.get('content-type') ?? '';

    if (!upstream.ok || !upstream.body) {
      const bodyText = await upstream.text().catch(() => '');
      console.error('streamRecording upstream error', {
        status: upstream.status,
        contentType: upstreamContentType,
        fetchUrl,
        bodyPreview: bodyText.slice(0, 200),
      });
      return Response.json(
        {
          error: `Upstream returned ${upstream.status}`,
          upstreamContentType,
          upstreamBodyPreview: bodyText.slice(0, 200),
        },
        { status: 502, headers: corsHeaders },
      );
    }

    // Voicenter sometimes responds 200 with an HTML error page instead of audio
    // (e.g. when the recording is gone). Catch that here so the client gets a
    // useful error instead of a silently-broken audio element.
    if (
      upstreamContentType &&
      !upstreamContentType.startsWith('audio/') &&
      !upstreamContentType.startsWith('application/octet-stream') &&
      !upstreamContentType.startsWith('binary/')
    ) {
      const bodyText = await upstream.text().catch(() => '');
      console.error('streamRecording non-audio response', {
        contentType: upstreamContentType,
        fetchUrl,
        bodyPreview: bodyText.slice(0, 200),
      });
      return Response.json(
        {
          error: 'Upstream returned non-audio content',
          upstreamContentType,
          upstreamBodyPreview: bodyText.slice(0, 200),
        },
        { status: 502, headers: corsHeaders },
      );
    }

    const contentLength = upstream.headers.get('content-length');
    const headers: Record<string, string> = {
      ...corsHeaders,
      'Content-Type': upstreamContentType || 'audio/mpeg',
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
