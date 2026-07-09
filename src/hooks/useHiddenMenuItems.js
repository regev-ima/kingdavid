import { useState, useEffect, useCallback } from 'react';

// Admin-configurable sidebar: which items are hidden AND their order
// (Settings → תפריט). Persisted in localStorage, same pattern as
// useStatusColors / useHiddenStatuses — per-browser, instant, no backend.
//
// First run (nothing stored) hides the club + landing-pages entries by
// default. The moment the admin toggles/reorders anything the stored value
// takes over.
const HIDDEN_KEY = 'king_david_hidden_menu_items';
const ORDER_KEY = 'king_david_menu_order';
const CHANGE_EVENT = 'menuPrefsChanged';
const DEFAULT_HIDDEN = ['ClubSignups', 'LandingPages'];

// Never allow the Settings entry itself to be hidden — otherwise the admin
// loses the only way back to this screen.
export const NON_HIDEABLE_HREFS = ['Settings'];

function readHidden() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw === null) return [...DEFAULT_HIDDEN];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h) => !NON_HIDEABLE_HREFS.includes(h)) : [];
  } catch {
    return [...DEFAULT_HIDDEN];
  }
}

function readOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function broadcast() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
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
  const [hiddenMenuItems, setHiddenState] = useState(readHidden);
  const [menuOrder, setOrderState] = useState(readOrder);

  useEffect(() => {
    const handler = () => {
      setHiddenState(readHidden());
      setOrderState(readOrder());
    };
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // hidden=true → hide the item; hidden=false → show it.
  const setMenuItemHidden = useCallback((href, hidden) => {
    if (!href || NON_HIDEABLE_HREFS.includes(href)) return;
    const cur = readHidden();
    const next = hidden
      ? Array.from(new Set([...cur, href]))
      : cur.filter((h) => h !== href);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    setHiddenState(next);
    broadcast();
  }, []);

  const setMenuOrder = useCallback((order) => {
    const next = Array.isArray(order) ? order : [];
    localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    setOrderState(next);
    broadcast();
  }, []);

  const isMenuItemHidden = useCallback(
    (href) => hiddenMenuItems.includes(href),
    [hiddenMenuItems],
  );

  return { hiddenMenuItems, menuOrder, setMenuItemHidden, setMenuOrder, isMenuItemHidden };
}
