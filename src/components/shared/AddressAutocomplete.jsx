import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';
import { loadGoogleMaps, isGoogleMapsConfigured } from '@/lib/googleMapsLoader';

/**
 * Address input with Google Places Autocomplete.
 *
 * Props:
 *   value         — current string (the address typed/selected)
 *   onChange      — (value, details | null) => void
 *                   `details` is provided only when the user SELECTS a suggestion
 *                   from the dropdown. When the user is just typing, details is null.
 *                   Shape of details:
 *                     {
 *                       fullAddress: string,
 *                       streetNumber: string,
 *                       route: string,
 *                       city: string,
 *                       postalCode: string,
 *                       country: string,
 *                       latitude: number,
 *                       longitude: number,
 *                     }
 *   placeholder   — passed through to <Input>
 *   disabled      — passed through
 *   className     — passed through
 *   restrictToIsrael — default true. Biases + restricts results to IL.
 *   inputType     — 'address' (default) requests street-level results, or
 *                   'geocode' for any geocoded result (less strict).
 *   autoFocus     — passed through
 *
 * Fallback: if VITE_GOOGLE_MAPS_BROWSER_KEY isn't set, renders a plain <Input>.
 * The app stays usable; only autocomplete is missing.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const configured = isGoogleMapsConfigured();

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !inputRef.current) return;
        if (autocompleteRef.current) return; // already attached

        const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          types: [inputType],
          componentRestrictions: restrictToIsrael ? { country: 'il' } : undefined,
          fields: ['address_components', 'formatted_address', 'geometry'],
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place || !place.address_components) {
            // User typed but didn't select a suggestion.
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
              comp.administrative_area_level_1 ||
              '',
            postalCode: comp.postal_code || '',
            country: comp.country || '',
            latitude: place.geometry?.location?.lat() ?? null,
            longitude: place.geometry?.location?.lng() ?? null,
          };

          // Build "Route StreetNumber" as the street address (no city/country).
          const streetOnly = [details.route, details.streetNumber].filter(Boolean).join(' ').trim();
          const addressValue = streetOnly || place.formatted_address || '';

          if (onChange) onChange(addressValue, details);
        });

        autocompleteRef.current = autocomplete;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[AddressAutocomplete] load failed:', err.message);
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
      autocompleteRef.current = null;
    };
  }, [configured, inputType, restrictToIsrael, onChange]);

  const handleChange = (e) => {
    if (onChange) onChange(e.target.value, null);
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
        autoComplete="off"
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
