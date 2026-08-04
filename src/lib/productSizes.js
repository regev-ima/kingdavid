/**
 * Sizes, SKUs and size pricing — the rules a product's variations are built from.
 *
 * The showroom card is the source of truth for how this business prices a
 * mattress: one base price for the product's base size, and a fixed surcharge
 * per larger size ("תוספת") that is the same across every double mattress —
 * 140/200 and 150/190 add ₪390, 160/200 adds ₪490, 200/200 adds ₪1,290. So a
 * product isn't a list of independently-priced sizes; it's one price plus a
 * shared table, with the occasional per-product exception.
 *
 * Dimensions are read from the catalog's own columns when they're there and
 * parsed out of the free-text `dimensions` field when they aren't — the field
 * held "140/190"-style text long before there were columns to put it in, and
 * the parse keeps every existing size usable instead of hiding it.
 */

/** Israeli mattress dimensions are whole centimetres in a sane range. */
const MIN_CM = 30;
const MAX_CM = 400;

const toCm = (value) => {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= MIN_CM && rounded <= MAX_CM ? rounded : null;
};

/**
 * Pull width/length out of a free-text size. Handles every separator the
 * catalog has collected — "140/190", "140x190", "140X190", "140*190",
 * "140 על 190" — and ignores anything trailing (e.g. a height).
 */
export function parseDimensionsText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d{2,3})\s*(?:[xX×*\/]|על)\s*(\d{2,3})/);
  if (!match) return null;
  const a = toCm(match[1]);
  const b = toCm(match[2]);
  if (a == null || b == null) return null;
  // A mattress is never wider than it is long — the same rule migration
  // 20260702000002 enforced on existing variations — so the smaller number is
  // the width whichever order it was typed in.
  return { width_cm: Math.min(a, b), length_cm: Math.max(a, b) };
}

/**
 * Width/length for a catalog size: the stored columns first, the text as a
 * fallback. Returns null when neither yields a usable pair, which is what makes
 * a size un-tickable in the bulk dialog rather than silently wrong.
 */
export function getSizeDimensions(size) {
  const width = toCm(size?.width_cm);
  const length = toCm(size?.length_cm);
  if (width != null && length != null) {
    return { width_cm: Math.min(width, length), length_cm: Math.max(width, length) };
  }
  return parseDimensionsText(size?.dimensions) || parseDimensionsText(size?.label);
}

/** "140/190" — how this business writes a size, everywhere. */
export function formatDimensions(dims) {
  if (!dims) return '';
  return `${dims.width_cm}/${dims.length_cm}`;
}

// ── Base size ────────────────────────────────────────────────────────────────

/**
 * The size a product's price is quoted for before any surcharge: 140/190 on a
 * double, 80/190 on a single. Only a default — a product can point at any size
 * in the catalog — but it's the right answer for almost every product, so the
 * form arrives with it already chosen.
 */
export const DEFAULT_BASE_DIMENSIONS = {
  double: { width_cm: 140, length_cm: 190 },
  single: { width_cm: 80, length_cm: 190 },
};

/**
 * Where single ends and double begins. 120/200 is still a single here — a wide
 * one ("יחיד רחב") — which matches the size list the business works with: the
 * singles run 80…120 and the doubles start at 140.
 */
export const DOUBLE_MIN_WIDTH_CM = 140;

/** 'single' | 'double' for a catalog size, or null when it has no dimensions. */
export function sizeBedType(size) {
  const dims = getSizeDimensions(size);
  if (!dims) return null;
  return dims.width_cm >= DOUBLE_MIN_WIDTH_CM ? 'double' : 'single';
}

/**
 * Only the sizes a product can actually come in. A single mattress has no
 * business offering 200/200, and a list that mixes them makes the rep read
 * sixteen rows to find the eight that apply.
 *
 * A product with no bed type — or one that is sold as both — gets everything,
 * because narrowing on a guess would hide sizes someone needs.
 */
export function filterSizesForBedTypes(sizes = [], bedTypes) {
  const types = (Array.isArray(bedTypes) ? bedTypes : [bedTypes]).filter(Boolean);
  const wantsSingle = types.includes('single');
  const wantsDouble = types.includes('double');
  if (wantsSingle === wantsDouble) return sizes; // both, or neither
  return sizes.filter((size) => {
    const type = sizeBedType(size);
    // A size we can't classify stays visible — it's flagged as missing
    // dimensions anyway, and hiding it would bury the reason it's unusable.
    return type === null || type === (wantsSingle ? 'single' : 'double');
  });
}

/** The catalog size that should be a product's base, by its bed type. */
export function suggestBaseSize(bedTypes, sizes = []) {
  const types = Array.isArray(bedTypes) ? bedTypes : [bedTypes].filter(Boolean);
  // Double wins when a product is sold as both: it's the price on the card.
  const key = types.includes('double') ? 'double' : types.includes('single') ? 'single' : null;
  if (!key) return null;

  const target = DEFAULT_BASE_DIMENSIONS[key];
  return sizes.find((size) => {
    const dims = getSizeDimensions(size);
    return dims && dims.width_cm === target.width_cm && dims.length_cm === target.length_cm;
  }) || null;
}

// ── SKU ──────────────────────────────────────────────────────────────────────

// Hebrew letters to the Latin ones the existing SKUs use (עדן → EDN). Only the
// consonants matter: the catalog spells "EDN", not "EDEN".
const HEBREW_TO_LATIN = {
  א: '', ב: 'B', ג: 'G', ד: 'D', ה: 'H', ו: 'V', ז: 'Z', ח: 'H', ט: 'T',
  י: 'Y', כ: 'K', ך: 'K', ל: 'L', מ: 'M', ם: 'M', נ: 'N', ן: 'N', ס: 'S',
  ע: '', פ: 'P', ף: 'P', צ: 'TZ', ץ: 'TZ', ק: 'K', ר: 'R', ש: 'SH', ת: 'T',
};

/**
 * A starting point for the product's SKU prefix, never the last word on it —
 * transliteration guesses, and the person naming the product knows better. The
 * product form shows this filled in and lets it be typed over.
 */
export function suggestSkuPrefix(productName) {
  const name = String(productName ?? '').trim();
  if (!name) return '';

  const firstWord = name.split(/\s+/)[0] || '';
  let out = '';
  for (const char of firstWord) {
    if (out.length >= 3) break;
    if (/[a-zA-Z]/.test(char)) out += char.toUpperCase();
    else if (HEBREW_TO_LATIN[char] !== undefined) out += HEBREW_TO_LATIN[char];
  }
  return out.slice(0, 3);
}

/** `EDN` + `120` + `200` — the shape every SKU in the catalog already has. */
export function buildVariationSku(prefix, dims) {
  const letters = String(prefix ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!letters || !dims) return '';
  return `${letters}${dims.width_cm}${dims.length_cm}`;
}

// ── Price ────────────────────────────────────────────────────────────────────

/**
 * The categories that are priced by size. A bed frame in 160/200 doesn't carry
 * the mattress's ₪490 just because the size matches, so the amount lives per
 * (size, category) — but only these two are sold that way. Toppers and
 * accessories aren't sized off this table and are deliberately absent.
 */
export const SIZED_PRODUCT_CATEGORIES = [
  { value: 'mattress', label: 'מזרון' },
  { value: 'bed', label: 'מיטה' },
];

/**
 * The surcharge for a size in a given category.
 *
 * Falls back to the size's single `size_surcharge` for a category nobody has
 * filled in yet — that column held the mattress numbers before the split, so
 * an unfilled category prices exactly as it did before rather than dropping to
 * zero behind everyone's back.
 */
export function getSizeSurcharge(size, category) {
  const perCategory = size?.surcharges?.[category];
  if (perCategory !== undefined && perCategory !== null && perCategory !== '') {
    const n = Number(perCategory);
    if (Number.isFinite(n)) return n;
  }
  // The legacy single column holds the MATTRESS numbers — that is what those
  // amounts have always meant — so it stands in for mattresses (and for a
  // product with no category at all, which is how the app behaved before the
  // split). A bed with no amount of its own adds nothing rather than silently
  // inheriting a mattress's upcharge.
  if (category && category !== 'mattress') return 0;
  const fallback = Number(size?.size_surcharge);
  return Number.isFinite(fallback) ? fallback : 0;
}

/**
 * What a given size costs for a given product.
 *
 * Order of precedence, most specific first:
 *   1. a per-product price for that exact size (product_size_prices) — the
 *      exception a manager set by hand;
 *   2. the product's base price plus the catalog's surcharge for the size;
 *   3. the base price alone, for the base size (surcharge 0) and for any size
 *      the catalog has no surcharge for.
 *
 * Returns null when there's no base price to work from, so the caller can show
 * an empty field instead of a confident ₪0.
 */
export function resolveSizePrice({ basePrice, size, productSizePrice, category }) {
  const override = Number(productSizePrice?.price);
  if (Number.isFinite(override) && override > 0) return override;

  const base = Number(basePrice);
  if (!Number.isFinite(base) || base <= 0) return null;

  return base + getSizeSurcharge(size, category);
}
