import { useState, useEffect, useCallback, useMemo } from 'react';
import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';
import { useCustomStatuses } from './useCustomStatuses';

const STORAGE_KEY = 'king_david_hidden_lead_statuses';

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeToStorage(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  // Dispatch event so other hooks on the same page update
  window.dispatchEvent(new Event('hiddenStatusesChanged'));
}

export function useHiddenStatuses() {
  const [hiddenStatuses, setHiddenStatusesState] = useState(readFromStorage);

  useEffect(() => {
    const handler = () => setHiddenStatusesState(readFromStorage());
    window.addEventListener('hiddenStatusesChanged', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('hiddenStatusesChanged', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const setHiddenStatuses = useCallback((newList) => {
    writeToStorage(newList);
    setHiddenStatusesState(newList);
  }, []);

  return { hiddenStatuses, isLoading: false, setHiddenStatuses, isPending: false };
}

/**
 * Returns filtered status options:
 *   - Built-in LEAD_STATUS_OPTIONS + admin-added custom statuses
 *   - Hides statuses marked as hidden by admin
 *   - BUT keeps the currentStatus visible even if it's hidden, so a lead
 *     that already sits in a hidden status doesn't display blank.
 *
 * `extraOptions` lets callers pass in custom statuses they fetched via the
 * useCustomStatuses hook (kept as a parameter so this stays a pure helper
 * usable in non-React contexts). Use useStatusOptions() in React.
 */
export function getVisibleStatusOptions(hiddenStatuses = [], currentStatus = '', extraOptions = []) {
  const merged = [...LEAD_STATUS_OPTIONS, ...extraOptions];
  return merged.filter(
    (opt) => !hiddenStatuses.includes(opt.value) || opt.value === currentStatus
  );
}

/**
 * React hook returning the full set of status options (built-in + custom)
 * already filtered by the admin's hidden list. Re-renders when either list
 * changes via localStorage. Pass the lead's current status as `currentStatus`
 * so it stays visible even if the admin hid it.
 */
export function useStatusOptions(currentStatus = '') {
  const { hiddenStatuses } = useHiddenStatuses();
  const { customStatuses } = useCustomStatuses();
  return useMemo(
    () => getVisibleStatusOptions(hiddenStatuses, currentStatus, customStatuses),
    [hiddenStatuses, currentStatus, customStatuses],
  );
}
