import React, { useMemo, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ChevronDown, Ruler } from 'lucide-react';

const VAT = 1.18;
const ils = (n) => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`;
const CATEGORY_LABELS = { bed: 'מיטות', mattress: 'מזרנים', topper: 'תוספות', accessory: 'נלווים' };

const productValue = (product, key, fallback = '') => product?.[key] ?? product?.data?.[key] ?? fallback;

// "הוסף מוצר" — the catalog reached by typing its name, for the rep who already
// knows what they are selling. The full picker (קטגוריה → יחיד/זוגי → מוצר →
// מידה) stays exactly where it was; this is a second door into the same room,
// and both end in the same product+variation the row is built from.

/**
 * The name field of a quick-add row: type, pick a product from the catalog.
 *
 * Shows the price range and the number of sizes per result, because "which
 * מיטת עלית" is usually answered by the price band rather than the name. The
 * dropdown opens on the second character — one letter matches most of the
 * catalog and is never a real search.
 */
export function ProductNameSearch({ products = [], variations = [], value, product, onPickProduct }) {
  const [open, setOpen] = useState(false);
  // `query` is what filters the list; the field itself shows what the row
  // holds, so a re-render from the parent never wipes what was typed.
  const [query, setQuery] = useState('');
  const text = product ? productValue(product, 'name') : (value ?? '');

  const sizesByProduct = useMemo(() => {
    const map = new Map();
    for (const v of variations) {
      if (!v?.product_id) continue;
      const list = map.get(v.product_id);
      if (list) list.push(v);
      else map.set(v.product_id, [v]);
    }
    return map;
  }, [variations]);

  const matches = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) => {
        const name = String(productValue(p, 'name')).toLowerCase();
        const desc = String(productValue(p, 'description')).toLowerCase();
        return name.includes(q) || desc.includes(q);
      })
      .slice(0, 8);
  }, [products, query]);

  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
          <Input
            value={text}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              // Typing un-chooses whatever was chosen: the row goes back to
              // waiting for a pick rather than keeping a product behind a name
              // that no longer matches it.
              onPickProduct(null, e.target.value);
            }}
            onFocus={() => setOpen(true)}
            placeholder="הקלד שם מוצר..."
            className="h-8 text-sm pr-7"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        dir="rtl"
        className="w-80 p-0 overflow-hidden"
        // Focus stays in the input so the rep can keep typing while the list
        // narrows under their hand.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/60 border-b border-border">
          מוצרים בקטלוג
        </div>
        <ul className="list-none m-0 p-0 max-h-64 overflow-y-auto">
          {matches.map((p) => {
            const sizes = sizesByProduct.get(p.id) || [];
            const prices = sizes.map((v) => (Number(v.final_price) || 0) * VAT).filter((n) => n > 0);
            const low = prices.length ? Math.min(...prices) : 0;
            const high = prices.length ? Math.max(...prices) : 0;
            return (
              <li key={p.id} className="border-b border-border/50 last:border-b-0">
                <button
                  type="button"
                  onClick={() => { onPickProduct(p, productValue(p, 'name')); setQuery(''); setOpen(false); }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-start hover:bg-muted/60 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{productValue(p, 'name')}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {CATEGORY_LABELS[productValue(p, 'category')] || productValue(p, 'category')}
                      {sizes.length ? ` · ${sizes.length} מידות` : ' · ללא מידות'}
                    </span>
                  </span>
                  {prices.length ? (
                    <span className="flex-none text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                      {low === high ? ils(low) : `${ils(low)}–${ils(high)}`}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The size cell of a quick-add row: the sizes THIS product has, priced.
 *
 * "מידה מיוחדת" is the same deal the full picker offers — the rep types a
 * width and it is charged at the next size up, so a 165 wide bed is billed as
 * the 180 it is cut from. The variation handed back carries the typed width
 * with the priced variation behind it, exactly the shape the picker produces.
 */
export function ProductSizeSelect({ variations = [], productId, onPickVariation }) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [width, setWidth] = useState('');
  const [length, setLength] = useState(null);

  const sizes = useMemo(
    () => variations
      .filter((v) => v.product_id === productId)
      .slice()
      .sort((a, b) => (a.width_cm || 0) - (b.width_cm || 0)),
    [variations, productId],
  );
  const lengths = useMemo(
    () => [...new Set(sizes.map((v) => v.length_cm))].filter(Boolean).sort((a, b) => b - a),
    [sizes],
  );
  const activeLength = length ?? lengths[0] ?? null;

  const enteredWidth = parseInt(width, 10) || 0;
  const group = sizes.filter((v) => v.length_cm === activeLength);
  const pricedAt = enteredWidth > 0
    ? (group.find((v) => (v.width_cm || 0) >= enteredWidth) || group[group.length - 1])
    : null;

  const close = () => { setOpen(false); setCustomOpen(false); setWidth(''); setLength(null); };

  return (
    <Popover open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="h-8 w-full justify-between gap-1 text-xs font-normal"
        >
          בחר מידה
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverAnchor>
      <PopoverContent align="center" side="bottom" dir="rtl" className="w-56 p-0 overflow-hidden">
        {sizes.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">למוצר הזה אין מידות בקטלוג.</p>
        ) : (
          <ul className="list-none m-0 p-0 max-h-60 overflow-y-auto">
            {sizes.map((v) => (
              <li key={v.id} className="border-b border-border/50">
                <button
                  type="button"
                  onClick={() => { onPickVariation(v); close(); }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                >
                  <span className="tabular-nums" dir="ltr">{v.width_cm}×{v.length_cm}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                    {ils((Number(v.final_price) || 0) * VAT)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {sizes.length > 0 ? (
          <div className="border-t border-border bg-muted/40">
            {!customOpen ? (
              <button
                type="button"
                onClick={() => setCustomOpen(true)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-primary hover:bg-muted transition-colors"
              >
                <Ruler className="h-3.5 w-3.5" />
                מידה מיוחדת…
              </button>
            ) : (
              <div className="p-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="50"
                    max="220"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    placeholder="רוחב"
                    className="h-8 w-20 text-center text-sm"
                    dir="ltr"
                    autoFocus
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                  {lengths.length > 1 ? (
                    <select
                      value={activeLength ?? ''}
                      onChange={(e) => setLength(Number(e.target.value))}
                      className="h-8 rounded-md border border-border bg-card text-sm px-1"
                      dir="ltr"
                    >
                      {lengths.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  ) : (
                    <span className="text-sm tabular-nums" dir="ltr">{activeLength}</span>
                  )}
                </div>
                {enteredWidth > 220 ? (
                  <p className="text-[11px] text-red-500">מקסימום 220 ס״מ</p>
                ) : pricedAt ? (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      מחיר לפי {pricedAt.width_cm} ס״מ ·{' '}
                      <span className="tabular-nums" dir="ltr">{ils((Number(pricedAt.final_price) || 0) * VAT)}</span>
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full h-8 text-xs"
                      onClick={() => {
                        onPickVariation({
                          ...pricedAt,
                          width_cm: enteredWidth,
                          _customWidth: enteredWidth,
                          _originalVariation: pricedAt,
                        });
                        close();
                      }}
                    >
                      בחר מידה זו
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
