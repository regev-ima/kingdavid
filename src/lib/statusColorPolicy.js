/**
 * The company's status colours, cached for synchronous readers.
 *
 * Mirrors lib/leadVisibility: the source of truth is app_policies (singleton
 * id = 1), useStatusColors owns the fetch, and this module just remembers the
 * answer so code that renders a badge — which is a synchronous render path,
 * and in some places a plain helper with no access to hooks — can ask without
 * awaiting anything.
 *
 * The map is { [statusValue]: presetId }. A status with no entry keeps the
 * built-in colour compiled into StatusBadge, and an unknown preset id is
 * treated as no entry, so a row written by an older or newer version of the
 * app can never produce an unstyled badge.
 */

import { STATUS_COLOR_BY_ID } from '@/constants/statusColors';

const LEGACY_STORAGE_KEY = 'king_david_status_colors';

let cachedColors = {};

/** Drop anything that isn't a known preset id, so bad data can't reach a badge. */
export function sanitizeStatusColors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  for (const [status, presetId] of Object.entries(raw)) {
    if (status && typeof presetId === 'string' && STATUS_COLOR_BY_ID[presetId]) {
      clean[status] = presetId;
    }
  }
  return clean;
}

export function hydrateStatusColors(raw) {
  cachedColors = sanitizeStatusColors(raw);
  return cachedColors;
}

export function getStatusColors() {
  return cachedColors;
}

/**
 * What this browser had before colours were shared.
 *
 * Read-only and deliberately not merged into the live map: one admin's local
 * picks silently becoming the whole company's colours is exactly the surprise
 * this change exists to remove. Settings offers the upload explicitly.
 */
export function readLegacyLocalStatusColors() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return sanitizeStatusColors(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

export function clearLegacyLocalStatusColors() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* a browser that refuses storage has nothing to clear */
  }
}
