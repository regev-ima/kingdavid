import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';
import { loadGoogleMaps, isGoogleMapsConfigured } from '@/lib/googleMapsLoader';

/**
 * Address input with Google Places Autocomplete.
 *
 * Props:
 *   value         — current string (controlled)
 *   onChange      — (value, details | null) => void
 *                   `details` is provided ONLY when the user picks a suggestion
 *                   from the dropdown. When typing, details is null.
 *                   Shape:
 *                     {
 *                       fullAddress, streetNumber, route, city, postalCode,
 *                       country, latitude, longitude
 *                     }
 *   placeholder, disabled, className, autoFocus, name, id — pass-through
 *   restrictToIsrael — default true
 *   inputType        — 'address' (default) | 'geocode'
 *
 * Fallback: if VITE_GOOGLE_MAPS_BROWSER_KEY is missing, renders a plain Input.
 *
 * Implementation note:
 *   The `onChange` prop is held in a ref so that the parent passing a new
 *   inline arrow function on every render does NOT cause this effect to
 *   tear down and re-create the Google Autocomplete instance. (That bug
 *   destroyed the dropdown on every keystroke and made it look "broken".)
 */
export default function AddressAutocomplete({
  value = '',
  onChange,
  placeholder = 'הקלד כתובת...',
  disabled = false,
  className = '',
  restrictToIsrael = true,
  inputType = 'address',
  autoFocus = false,
  name,
  id,
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const configured = isGoogleMapsConfigured();

  // Keep the onChange ref fresh without re-running the attach effect.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Attach Google Autocomplete to the input — exactly once per mount.
  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !inputRef.current || autocompleteRef.current) return;

        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          types: [inputType],
          componentRestrictions: restrictToIsrael ? { country: 'il' } : undefined,
          fields: ['address_components', 'formatted_address', 'geometry'],
        });

        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place || !place.address_components) {
            // User typed but didn't select a suggestion — ignore.
            return;
          }
          const comp = {};
          for (const c of place.address_components) {
            for (const t of c.types) {
              comp[t] = c.long_name;
            }
          }
          const details = {
            fullAddress: place.formatted_address || '',
            streetNumber: comp.street_number || '',
            route: comp.route || '',
            city:
              comp.locality ||
              comp.postal_town ||
              comp.administrative_area_level_2 ||
              comp.administrative_area_level_1  ||
              '',
            postalCode: comp.postal_code || '',
            country: comp.country || '',
            latitude: place.geometry?.location?.lat() ?? null,
            longitude: place.geometry?.location?.lng() ?? null,
          };
          const streetOnly = [details.route, details.streetNumber].filter(Boolean).join(' ').trim();
          const addressValue = streetOnly || place.formatted_address || '';
          // Use the ref so we always call the LATEST onChange, even though
          // the effect captured a stale closure.
          onChangeRef.current?.(addressValue, details);
        });

        autocompleteRef.current = ac;
        setLoading(false);
        // Diagnostic — remove once verified in production
        // eslint-disable-next-line no-console
        console.log('[AddressAutocomplete] attached to input', inputRef.current);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[AddressAutocomplete] load failed:', err.message);
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      // We deliberately do NOT clearInstanceListeners + null the ref on every
      // re-render — only on real unmount. Since this effect's deps array is
      // mount-only ([configured, inputType, restrictToIsrael]), this cleanup
      // will only fire when the component truly unmounts or those props change.
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [configured, inputType, restrictToIsrael]); // ← onChange intentionally NOT here

  const handleChange = (e) => {
    onChangeRef.current?.(e.target.value, null);
  };

  return (
    <div className="relative">
      <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
      <Input
        ref={inputRef}
        type="text"
        name={name}
        id={id}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`pe-8 ${className}`}
        // Autofill bypass — Chrome ignores 'off' but respects unrecognized values.
        autoComplete="address-line1-fake"
      />
      {loading && configured && (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 animate-spin" />
      )}
      {error && (
        <p className="text-[10px] text-amber-600 mt-0.5">
          השלמה אוטומטית לא זמינה ({error.includes('key') ? 'חסר API key' : 'שגיאה'})
        </p>
      )}
    </div>
  );
}
