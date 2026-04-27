import { useState, useEffect, useCallback } from 'react';

// Custom statuses are persisted in localStorage so admins can add ad-hoc lead
// statuses through Settings → סטטוסים without a code change. They show up
// alongside the built-in LEAD_STATUS_OPTIONS in the visible-options helper.
//
// Same persistence pattern as useHiddenStatuses for consistency: localStorage
// + a synthetic 'customStatusesChanged' event so other hooks on the same
// page re-read the list when one tab edits it.

const STORAGE_KEY = 'king_david_custom_lead_statuses';
const CHANGE_EVENT = 'customStatusesChanged';

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeToStorage(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// Generate a stable machine value from a Hebrew label. Strips everything but
// letters/digits and joins with underscore so it matches the shape of the
// built-in keys (e.g. 'deal_closed', 'no_answer_1'). Falls back to a random
// suffix if the label has no usable chars.
function slugifyLabel(label) {
  const cleaned = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9א-ת\s]/g, '')
    .replace(/\s+/g, '_');
  if (cleaned) return `custom_${cleaned}`;
  return `custom_${Math.random().toString(36).slice(2, 8)}`;
}

export function useCustomStatuses() {
  const [customStatuses, setCustomStatusesState] = useState(readFromStorage);

  useEffect(() => {
    const handler = () => setCustomStatusesState(readFromStorage());
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const setCustomStatuses = useCallback((next) => {
    writeToStorage(next);
    setCustomStatusesState(next);
  }, []);

  const addStatus = useCallback((label) => {
    const trimmed = String(label || '').trim();
    if (!trimmed) return null;
    const current = readFromStorage();
    // Don't allow exact duplicate labels (case-insensitive).
    if (current.some((s) => s.label?.trim().toLowerCase() === trimmed.toLowerCase())) {
      return null;
    }
    let value = slugifyLabel(trimmed);
    // Defend against value collision if two labels slugify to the same key.
    while (current.some((s) => s.value === value)) {
      value = `${value}_${Math.random().toString(36).slice(2, 5)}`;
    }
    const next = [...current, { value, label: trimmed }];
    writeToStorage(next);
    setCustomStatusesState(next);
    return { value, label: trimmed };
  }, []);

  const removeStatus = useCallback((value) => {
    const next = readFromStorage().filter((s) => s.value !== value);
    writeToStorage(next);
    setCustomStatusesState(next);
  }, []);

  return { customStatuses, setCustomStatuses, addStatus, removeStatus };
}
