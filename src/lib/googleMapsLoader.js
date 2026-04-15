/**
 * Singleton loader for the Google Maps JavaScript API.
 *
 * Why singleton: Google's loader complains if the script is injected more than
 * once, and we'd waste bandwidth. Multiple AddressAutocomplete mounts on the
 * same page all share one <script> tag and one loader Promise.
 *
 * The browser key is expected at build time as VITE_GOOGLE_MAPS_BROWSER_KEY.
 * Restrict that key (in Google Cloud Console) to:
 *   - HTTP referrers = your production + preview domains
 *   - API restriction = Maps JavaScript API + Places API
 * The server-side GOOGLE_MAPS_API_KEY (in Supabase Secrets) is a DIFFERENT
 * key with different restrictions — do not reuse it here.
 */

let loaderPromise = null;

export function getBrowserMapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY || '';
}

export function isGoogleMapsConfigured() {
  return Boolean(getBrowserMapsKey());
}

/**
 * Load the Google Maps JS API (with the `places` library).
 * Resolves with the global `google` object when ready.
 * Rejects if the key is missing or the script fails to load.
 */
export function loadGoogleMaps() {
  if (loaderPromise) return loaderPromise;

  const apiKey = getBrowserMapsKey();
  if (!apiKey) {
    loaderPromise = Promise.reject(
      new Error('Google Maps browser key is not configured (VITE_GOOGLE_MAPS_BROWSER_KEY).'),
    );
    return loaderPromise;
  }

  // Already loaded?
  if (typeof window !== 'undefined' && window.google?.maps?.places) {
    loaderPromise = Promise.resolve(window.google);
    return loaderPromise;
  }

  loaderPromise = new Promise((resolve, reject) => {
    // A previous mount may have started loading — in that case, attach to that script.
    const existing = document.querySelector('script[data-google-maps-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', () => reject(new Error('Google Maps script load error')));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=iw&region=IL&loading=async`;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-google-maps-loader', 'true');
    script.onload = () => {
      if (window.google?.maps?.places) {
        resolve(window.google);
      } else {
        reject(new Error('Google Maps loaded but places library is missing'));
      }
    };
    script.onerror = () => reject(new Error('Google Maps script load error'));
    document.head.appendChild(script);
  });

  return loaderPromise;
}
