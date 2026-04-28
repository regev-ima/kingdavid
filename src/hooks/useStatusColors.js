import { useState, useEffect, useCallback } from 'react';

// Per-status color overrides (admin-configurable in Settings → סטטוסים).
// Persisted in localStorage as { [statusValue]: presetId } where presetId
// matches an entry in STATUS_COLOR_PRESETS. Same persistence pattern as
// useCustomStatuses / useHiddenStatuses so all three stay consistent.

const STORAGE_KEY = 'king_david_status_colors';
const CHANGE_EVENT = 'statusColorsChanged';

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeToStorage(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useStatusColors() {
  const [statusColors, setStatusColorsState] = useState(readFromStorage);

  useEffect(() => {
    const handler = () => setStatusColorsState(readFromStorage());
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const setStatusColor = useCallback((statusValue, presetId) => {
    if (!statusValue) return;
    const next = { ...readFromStorage() };
    if (presetId) {
      next[statusValue] = presetId;
    } else {
      delete next[statusValue];
    }
    writeToStorage(next);
    setStatusColorsState(next);
  }, []);

  const removeStatusColor = useCallback((statusValue) => {
    const next = { ...readFromStorage() };
    delete next[statusValue];
    writeToStorage(next);
    setStatusColorsState(next);
  }, []);

  return { statusColors, setStatusColor, removeStatusColor };
}

// Read the currently-stored color map without subscribing to updates. Useful
// for one-off lookups in non-React modules / synchronous code paths.
export function readStatusColors() {
  return readFromStorage();
}
