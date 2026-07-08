// Single source of truth for ₪ rendering. Uses he-IL grouping and rounds to
// integers — Hebrew finance views in this app don't show the agorot column.
// Replaces the inline `₪${n.toLocaleString()}` pattern that used to live in
// every page.
export function formatCurrency(n) {
  const value = Number.isFinite(n) ? n : 0;
  return `₪${Math.round(value).toLocaleString('he-IL')}`;
}

// Money to agorot (2 decimals). Used in the quote/order line-item views where
// the displayed lines must sum to the displayed total — rounding each line to a
// whole ₪ drifts by up to ₪0.50 per line, so the parts stopped matching the sum.
export function formatCurrency2(n) {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `₪${value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Round a money value to agorot for storage/summation (avoids float dust).
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
