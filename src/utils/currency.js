// Single source of truth for ₪ rendering. Uses he-IL grouping and rounds to
// integers — Hebrew finance views in this app don't show the agorot column.
// Replaces the inline `₪${n.toLocaleString()}` pattern that used to live in
// every page.
export function formatCurrency(n) {
  const value = Number.isFinite(n) ? n : 0;
  return `₪${Math.round(value).toLocaleString('he-IL')}`;
}
