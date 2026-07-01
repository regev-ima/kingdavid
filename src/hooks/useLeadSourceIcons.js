import { useState, useEffect, useCallback } from 'react';
import { matchSourceIconId, DEFAULT_SOURCE_ICON_ID } from '@/constants/leadSourceIcons';

// Per-source icon overrides (admin-configurable in Settings → מקורות הגעה).
// Persisted in localStorage as { [normalizedSource]: iconId }. Same pattern as
// useStatusColors / useCustomStatuses so all settings config stays consistent.
// When no override exists the icon is auto-matched from the source string.

const STORAGE_KEY = 'king_david_lead_source_icons';
const CHANGE_EVENT = 'leadSourceIconsChanged';

// Sources are matched case-insensitively; store overrides under a normalized
// key so "Facebook Form" and "facebook form" share one assignment.
export function normalizeSourceKey(source) {
  return String(source ?? '').trim().toLowerCase();
}

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

export function readLeadSourceIconOverrides() {
  return readFromStorage();
}

// Resolve a source → icon id: explicit override wins, else auto-match.
export function resolveSourceIconId(source, overrides) {
  const map = overrides || readFromStorage();
  const key = normalizeSourceKey(source);
  if (key && map[key]) return map[key];
  return matchSourceIconId(source);
}

export function useLeadSourceIcons() {
  const [overrides, setOverridesState] = useState(readFromStorage);

  useEffect(() => {
    const handler = () => setOverridesState(readFromStorage());
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // Assign an explicit icon to a source. Passing null/undefined removes the
  // override so the source reverts to automatic matching.
  const setSourceIcon = useCallback((source, iconId) => {
    const key = normalizeSourceKey(source);
    if (!key) return;
    const next = { ...readFromStorage() };
    if (iconId) {
      next[key] = iconId;
    } else {
      delete next[key];
    }
    writeToStorage(next);
    setOverridesState(next);
  }, []);

  const removeSourceIcon = useCallback((source) => {
    const key = normalizeSourceKey(source);
    const next = { ...readFromStorage() };
    delete next[key];
    writeToStorage(next);
    setOverridesState(next);
  }, []);

  const resolveIconId = useCallback((source) => resolveSourceIconId(source, overrides), [overrides]);

  return { overrides, setSourceIcon, removeSourceIcon, resolveIconId, DEFAULT_SOURCE_ICON_ID };
}
