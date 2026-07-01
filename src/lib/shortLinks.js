import { supabase } from '@/api/supabaseClient';

// Branded short-link base. Resolved by a Cloudflare Worker on kingdavid.online
// that reads the short_links row, serves the document straight from this domain
// (no external redirect, so nothing ever exposes supabase), and renders a branded
// Open-Graph preview for social scrapers. Overridable via VITE_SHORTLINK_BASE.
const BASE = (import.meta.env.VITE_SHORTLINK_BASE || 'https://kingdavid.online').replace(/\/+$/, '');

// Unambiguous alphabet (no 0/O/1/l/I) so the code is easy to read/dictate.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function randomCode(len = 7) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Create a branded short link that points at `targetUrl`. The optional title /
// subtitle drive the Open-Graph preview the Worker renders. Falls back
// to `targetUrl` itself if no branded domain is configured or creation fails —
// so a share action never breaks.
export async function getShareLink(targetUrl, { title, subtitle } = {}) {
  if (!BASE || !targetUrl) return targetUrl;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    const { error } = await supabase
      .from('short_links')
      .insert({ code, target_url: targetUrl, title: title || null, subtitle: subtitle || null });
    if (!error) return `${BASE}/${code}`;
    // 23505 = unique violation → try a fresh code; any other error → fall back.
    if (error.code !== '23505') break;
  }
  return targetUrl;
}
