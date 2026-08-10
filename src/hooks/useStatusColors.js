import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  getStatusColors,
  hydrateStatusColors,
  sanitizeStatusColors,
} from '@/lib/statusColorPolicy';

// Per-status colour overrides, shared by the whole company.
//
// These used to live in localStorage, which made them a property of one
// browser: an admin coloured the statuses, saw the result, and nobody else did.
// They now come from app_policies (singleton id = 1, column status_colors),
// the same row the lead-visibility policy uses, and follow the same shape:
// { [statusValue]: presetId }.
//
// The hook's surface is unchanged — { statusColors, setStatusColor,
// removeStatusColor } — so the Settings picker and every badge call site work
// as before.

export const STATUS_COLORS_QUERY_KEY = ['app-policies', 'status-colors'];

export function useStatusColors() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: STATUS_COLORS_QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      try {
        const rows = await base44.entities.AppPolicy.filter({ id: 1 });
        const value = Array.isArray(rows) ? rows[0]?.status_colors : rows?.status_colors;
        return hydrateStatusColors(value);
      } catch {
        // Column or table missing (migration not applied yet), or the read was
        // denied. Every status has a built-in colour, so falling back to "no
        // overrides" degrades to the stock palette instead of an error the
        // viewer cannot act on.
        return hydrateStatusColors({});
      }
    },
  });

  const statusColors = data || getStatusColors();

  const saveMutation = useMutation({
    mutationFn: async (nextMap) => {
      const clean = sanitizeStatusColors(nextMap);
      await base44.entities.AppPolicy.update(1, {
        status_colors: clean,
        updated_date: new Date().toISOString(),
      });
      return clean;
    },
    onSuccess: (clean) => {
      // Update the synchronous cache and the query cache before any refetch
      // lands, so the picker and every badge on screen agree immediately.
      hydrateStatusColors(clean);
      queryClient.setQueryData(STATUS_COLORS_QUERY_KEY, clean);
      queryClient.invalidateQueries({ queryKey: STATUS_COLORS_QUERY_KEY });
    },
  });

  const setStatusColor = useCallback((statusValue, presetId) => {
    if (!statusValue) return;
    const next = { ...(queryClient.getQueryData(STATUS_COLORS_QUERY_KEY) || getStatusColors()) };
    if (presetId) next[statusValue] = presetId;
    else delete next[statusValue];
    saveMutation.mutate(next);
  }, [queryClient, saveMutation]);

  const removeStatusColor = useCallback((statusValue) => {
    setStatusColor(statusValue, null);
  }, [setStatusColor]);

  return {
    statusColors,
    setStatusColor,
    removeStatusColor,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error || null,
    /** Replace the whole map at once — used by the one-time upload in Settings. */
    replaceStatusColors: saveMutation.mutate,
  };
}

// Read the currently-cached map without subscribing. For one-off lookups in
// non-React modules and synchronous code paths.
export function readStatusColors() {
  return getStatusColors();
}
