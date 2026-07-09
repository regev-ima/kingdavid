// Customer-facing PDF links (WhatsApp / SMS) should be on OUR domain, not the
// raw *.supabase.co storage URL. A Vercel rewrite (vercel.json) proxies
// `/pdf/*` → the Supabase storage public path, so we just swap the host+prefix
// for the current app origin. Internal "view/download PDF" buttons keep using
// the raw URL — this is only for links we send to customers.
//
// Using window.location.origin means the link works wherever the app is served
// (the preview domain during testing, kingdavid.imagick.ai in production).
export function toShareablePdfUrl(fileUrl) {
  if (!fileUrl) return fileUrl || '';
  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  if (!origin) return fileUrl;
  return String(fileUrl).replace(
    /^https:\/\/[^/]+\/storage\/v1\/object\/public\//,
    `${origin}/pdf/`,
  );
}
