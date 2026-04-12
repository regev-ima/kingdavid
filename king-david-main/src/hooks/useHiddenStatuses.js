import { useState, useEffect, useCallback } from 'react';
import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';

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
 * Returns filtered LEAD_STATUS_OPTIONS:
 * - Hides statuses marked as hidden by admin
 * - BUT keeps them visible if the current lead already has that status
 */
export function getVisibleStatusOptions(hiddenStatuses = [], currentStatus = '') {
  return LEAD_STATUS_OPTIONS.filter(
    (opt) => !hiddenStatuses.includes(opt.value) || opt.value === currentStatus
  );
}
