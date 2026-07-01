// King David — branded document links on kingdavid.online.
//
// A short link like https://kingdavid.online/Ab12cd maps to a row in the Supabase
// `short_links` table. This Worker (deployed on the kingdavid.online apex as a
// Cloudflare Worker Custom Domain):
//
//   • serves the document (PDF) straight from kingdavid.online — it fetches the
//     stored URL server-side and streams the bytes back, so the browser never
//     leaves the domain and nothing ever exposes supabase. There is NO external
//     redirect, which is what tripped antivirus phishing filters before.
//   • gives social scrapers (WhatsApp / Facebook / …) a branded Open-Graph
//     preview card (logo + title) so the message looks professional.
//   • sends the bare domain / unknown paths to the main marketing site.
//
// Environment variables (Worker → Settings → Variables and Secrets):
//   SUPABASE_URL       e.g. https://njfrqbzkwwalwpzzxecy.supabase.co
//   SUPABASE_ANON_KEY  the project's anon/public key
//   LOGO_URL           (optional) preview logo; defaults to the main-site logo

const BOT_RE = /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|slackbot|twitterbot|linkedinbot|discordbot|embedly|preview|snippet/i;

async function serveDocument(target, request) {
  // Forward Range so PDF viewers can seek; pass the upstream status/headers back.
  const range = request.headers.get('range');
  const upstream = await fetch(target, { headers: range ? { Range: range } : {} });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Document unavailable', { status: 502 });
  }
  const h = new Headers();
  h.set('content-type', upstream.headers.get('content-type') || 'application/pdf');
  h.set('content-disposition', 'inline');
  for (const k of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set('cache-control', 'public, max-age=300');
  return new Response(upstream.body, { status: upstream.status, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const code = url.pathname.slice(1).split('/')[0];

    // Bare domain / unknown path → the main site (a real, trusted destination).
    if (!code) return Response.redirect('https://kingdavid4u.co.il', 302);

    // Look up the short code in Supabase.
    const api = `${env.SUPABASE_URL}/rest/v1/short_links?code=eq.${encodeURIComponent(code)}&select=target_url,title,subtitle&limit=1`;
    const res = await fetch(api, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
    });
    const rows = await res.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.target_url) return new Response('Link not found', { status: 404 });

    const target = row.target_url;

    // Explicit document request (used by the preview page's JS fallback below).
    if (url.searchParams.has('raw')) return serveDocument(target, request);

    // A real person → serve the document straight from this domain.
    const ua = request.headers.get('user-agent') || '';
    if (!BOT_RE.test(ua)) return serveDocument(target, request);

    // A social scraper → branded Open-Graph preview card. (A human wrongly matched
    // here is bounced to the document by the script, which scrapers ignore.)
    const title = row.title || 'קינג דיוויד';
    const subtitle = row.subtitle || 'לחצו לצפייה במסמך';
    const logo = env.LOGO_URL || 'https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(subtitle)}">
<meta property="og:image" content="${esc(logo)}">
<meta property="og:url" content="${esc(url.origin + url.pathname)}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body><script>location.replace(location.pathname + '?raw=1')</script></body>
</html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};
