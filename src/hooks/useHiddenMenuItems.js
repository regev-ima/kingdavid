import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

// Admin-configurable sidebar: which items are hidden AND their order
// (Settings → תפריט).
//
// Persisted SERVER-SIDE in the menu_settings singleton (id = 1) so the
// configuration survives new releases and applies on every browser/device.
// It used to live only in localStorage, which is scoped per-browser AND
// per-domain — every new Vercel deployment URL started clean, so the admin's
// curation "reset itself" after each version. localStorage is now only an
// instant-paint cache: the sidebar renders from it immediately while the
// server value loads, then the server wins.
//
// Reading is open to every authenticated user (the sidebar needs it);
// writing is admin-only, enforced by RLS (the ניהול תפריט tab is the only
// writer and is already admin-gated).
const HIDDEN_KEY = 'king_david_hidden_menu_items';
const ORDER_KEY = 'king_david_menu_order';
const DEFAULT_HIDDEN = ['ClubSignups', 'LandingPages'];

// Never allow the Settings entry itself to be hidden — otherwise the admin
// loses the only way back to this screen.
export const NON_HIDEABLE_HREFS = ['Settings'];

function readCache(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeCache(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* ignore */ }
}

// Pure: reorder `items` (array of objects with an `href`) by the saved order.
// Items whose href is in `order` come first, in that order; everything else
// (newly-added pages, the pinned Settings entry) keeps its original relative
// order and is appended.
export function applyMenuOrder(items, order) {
  if (!order || order.length === 0) return items;
  const pos = new Map(order.map((h, i) => [h, i]));
  const ranked = items.filter((it) => pos.has(it.href)).sort((a, b) => pos.get(a.href) - pos.get(b.href));
  const rest = items.filter((it) => !pos.has(it.href));
  return [...ranked, ...rest];
}

export function useHiddenMenuItems() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['menu-settings'],
    queryFn: async () => {
      const rows = await base44.entities.MenuSettings.list();
      const row = rows?.find((r) => r.id === 1) || rows?.[0] || null;
      if (row) {
        // Refresh the paint cache so the next hard load starts correct.
        writeCache(HIDDEN_KEY, Array.isArray(row.hidden_items) ? row.hidden_items : []);
        writeCache(ORDER_KEY, Array.isArray(row.menu_order) ? row.menu_order : []);
      }
      return row;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Server value when loaded; otherwise the local cache (or defaults) so the
  // sidebar never flashes the full menu while the query is in flight.
  const hiddenMenuItems = (Array.isArray(data?.hidden_items)
    ? data.hidden_items
    : readCache(HIDDEN_KEY, DEFAULT_HIDDEN)
  ).filter((h) => !NON_HIDEABLE_HREFS.includes(h));

  const menuOrder = Array.isArray(data?.menu_order)
    ? data.menu_order
    : readCache(ORDER_KEY, []);

  // Optimistic write: update the shared query cache (every mounted hook —
  // including the live sidebar — re-renders instantly), mirror to the paint
  // cache, then persist. On failure, resync from the server.
  const persist = useCallback(async (patch) => {
    queryClient.setQueryData(['menu-settings'], (prev) => ({ id: 1, ...(prev || {}), ...patch }));
    if (patch.hidden_items) writeCache(HIDDEN_KEY, patch.hidden_items);
    if (patch.menu_order) writeCache(ORDER_KEY, patch.menu_order);
    try {
      await base44.entities.MenuSettings.update(1, patch);
    } catch (err) {
      toast.error(`שמירת הגדרות התפריט נכשלה: ${err?.message || 'שגיאה'}`);
      queryClient.invalidateQueries({ queryKey: ['menu-settings'] });
    }
  }, [queryClient]);

  // hidden=true → hide the item; hidden=false → show it.
  const setMenuItemHidden = useCallback((href, hidden) => {
    if (!href || NON_HIDEABLE_HREFS.includes(href)) return;
    const next = hidden
      ? Array.from(new Set([...hiddenMenuItems, href]))
      : hiddenMenuItems.filter((h) => h !== href);
    persist({ hidden_items: next });
  }, [hiddenMenuItems, persist]);

  const setMenuOrder = useCallback((order) => {
    persist({ menu_order: Array.isArray(order) ? order : [] });
  }, [persist]);

  const isMenuItemHidden = useCallback(
    (href) => hiddenMenuItems.includes(href),
    [hiddenMenuItems],
  );

  return { hiddenMenuItems, menuOrder, setMenuItemHidden, setMenuOrder, isMenuItemHidden };
}
