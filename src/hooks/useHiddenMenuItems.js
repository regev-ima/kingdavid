import { useState, useEffect, useCallback } from 'react';

// Admin-configurable sidebar visibility (Settings → תפריט). Persisted in
// localStorage as an array of hidden page hrefs, same pattern as
// useStatusColors / useHiddenStatuses so all the menu/status prefs behave the
// same (per-browser, instant, no backend).
//
// First run (nothing stored yet) hides the club, club-signups-adjacent and
// landing-pages entries by default — the owner asked for these gone out of the
// box. The moment the admin toggles anything the stored array takes over, so
// they can bring any of them back.
const STORAGE_KEY = 'king_david_hidden_menu_items';
const CHANGE_EVENT = 'hiddenMenuItemsChanged';
const DEFAULT_HIDDEN = ['ClubSignups', 'LandingPages'];

// Never allow the Settings entry itself to be hidden — otherwise the admin
// loses the only way back to this screen.
export const NON_HIDEABLE_HREFS = ['Settings'];

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [...DEFAULT_HIDDEN];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h) => !NON_HIDEABLE_HREFS.includes(h)) : [];
  } catch {
    return [...DEFAULT_HIDDEN];
  }
}

function writeToStorage(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useHiddenMenuItems() {
  const [hiddenMenuItems, setHiddenState] = useState(readFromStorage);

  useEffect(() => {
    const handler = () => setHiddenState(readFromStorage());
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
    const cur = readFromStorage();
    const next = hidden
      ? Array.from(new Set([...cur, href]))
      : cur.filter((h) => h !== href);
    writeToStorage(next);
    setHiddenState(next);
  }, []);

  const isMenuItemHidden = useCallback(
    (href) => hiddenMenuItems.includes(href),
    [hiddenMenuItems],
  );

  return { hiddenMenuItems, setMenuItemHidden, isMenuItemHidden };
}
