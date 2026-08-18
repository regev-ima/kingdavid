import React, { useState } from 'react';
import ProductSelector from '@/components/quote/ProductSelector';
import BedConfigWizard from '@/components/quote/BedConfigWizard';
import DiscountPopover from '@/components/quote/DiscountPopover';
import { ProductNameSearch, ProductSizeSelect } from '@/components/quote/ProductQuickAdd';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Pencil, Package, Settings2, CornerDownLeft, PencilLine, Search } from 'lucide-react';
import { productMatchesBedType } from '@/utils/bedType';
import { genBedConfigToken, bedConfigFieldLines } from '@/lib/bedConfig';
import { lineGrossPreVat, lineDiscountPreVat } from '@/lib/quoteTotals';

const VAT = 1.18;
// Two decimals (agorot) so the displayed line totals sum exactly to the grand
// total — whole-₪ rounding per line drifted by up to ₪0.50 each.
const ils = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CATEGORY_LABELS = { bed: 'מיטה', mattress: 'מזרון', topper: 'תוספת', accessory: 'נלווה' };
const hasTrialPeriod = (p) => Boolean(p?.has_trial_period ?? p?.data?.has_trial_period);

// The items step, shared by NewQuote / NewOrder so the two are identical. One
// clean table (headers once), and "הוסף פריט" opens the product picker straight
// away — a row appears only after a product+size is chosen. Add-ons, the bed
// configurator and the fabric fields live in a per-row expander so the table
// stays tidy. Parent owns the items array; we hand back a new one via onChange
// and the parent recomputes the grand totals.
export default function ProductItemsEditor({ items = [], onChange, products = [], variations = [], addons = [], addonPrices = [] }) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [expanded, setExpanded] = useState({}); // index -> bool
  const [bedWizardIndex, setBedWizardIndex] = useState(null);
  const [bedWizardSnapshot, setBedWizardSnapshot] = useState(null);
  // Non-null while the picker is editing an existing row's product/size (pencil)
  // rather than adding a new one.
  const [editIndex, setEditIndex] = useState(null);
  // What the rep is currently typing into a custom row's price box, as text.
  // The stored unit_price is pre-VAT, so echoing it back through ×1.18 while
  // they type turns "100" into "99.99999" mid-keystroke. Hold the raw text for
  // the focused field only and let the stored value catch up behind it.
  const [customPriceDraft, setCustomPriceDraft] = useState(null); // { index, text }
  // Which finished quick-add row is back in edit mode (pencil), if any.
  const [quickEditIndex, setQuickEditIndex] = useState(null);

  const productById = (id) => products.find((p) => p.id === id);

  // Recompute a line's own pre-VAT total from qty / unit price / discount.
  const withTotal = (it) => ({ ...it, total: lineGrossPreVat(it) - lineDiscountPreVat(it) });

  const updateItem = (index, field, value) => {
    onChange(items.map((it, i) => (i === index ? withTotal({ ...it, [field]: value }) : it)));
  };

  const removeItem = (index) => {
    // Row numbers shift under a delete; a stale edit target would put the
    // search field on somebody else's line.
    setQuickEditIndex(null);
    const it = items[index];
    const token = it?.bed_config_token;
    // Removing a bed also drops the configurator lines that belong to it.
    let next = items.filter((_, i) => i !== index);
    if (token) next = next.filter((l) => l.bed_config_owner !== token);
    onChange(next);
  };

  // Pencil on a non-bed row → re-open the picker to change its product/size.
  const editProduct = (index) => { setEditIndex(index); setSelectorOpen(true); };

  // "פריט כללי" — a line that isn't in the catalog at all: the rep types the
  // name and the price. `is_custom` is what tells the rest of the app (and the
  // sub-row branch below) that a missing product_id here is deliberate.
  const addCustomItem = () => {
    onChange([...items, {
      is_custom: true,
      product_id: '',
      variation_id: '',
      sku: '',
      name: '',
      quantity: 1,
      unit_price: 0,
      discount_percent: 0,
      total: 0,
      selected_addons: [],
    }]);
  };

  // "הוסף מוצר" — the same catalog, reached by typing instead of by walking
  // the picker's category → type → product → size. The row appears empty and
  // fills itself in as the rep picks: `awaiting_size` marks the half-made
  // state, and it is gone the moment a size is chosen.
  const addQuickProductItem = () => {
    onChange([...items, {
      is_custom: true,
      is_quick_add: true,
      product_id: '',
      variation_id: '',
      sku: '',
      name: '',
      quantity: 1,
      unit_price: 0,
      discount_percent: 0,
      total: 0,
      selected_addons: [],
    }]);
  };

  // The catalog fields a chosen product + size put on a line. One definition
  // for both doors in, so a line added by typing is indistinguishable from one
  // added through the picker.
  const catalogLineFields = (product, variation) => ({
    product_id: product.id,
    name: product.name,
    sku: variation.sku || '',
    variation_id: variation.id,
    length_cm: variation.length_cm ?? null,
    width_cm: variation.width_cm ?? null,
    height_cm: variation.height_cm ?? null,
    // Catalog final_price is stored PRE-VAT, which is what the line stores too.
    unit_price: variation.final_price || 0,
  });

  // A quick-add row picks its product first and its size second; this is the
  // second half, which turns the placeholder row into a real catalog line.
  const completeQuickRow = (index, variation) => {
    const product = productById(variation.product_id);
    if (!product) return;
    const isBed = product.category === 'bed';
    const prev = items[index] || {};
    const line = withTotal({
      ...prev,
      ...catalogLineFields(product, variation),
      quantity: prev.quantity || 1,
      discount_percent: prev.discount_percent || 0,
      selected_addons: [],
      ...(isBed ? { bed_config_token: prev.bed_config_token || genBedConfigToken(), bed_config_fields: [] } : {}),
    });
    delete line.is_custom;
    delete line.awaiting_size;
    // is_quick_add stays: it is how the pencil knows to edit this row the way
    // it was written — inline — instead of opening the picker the rep chose
    // not to use.
    line.is_quick_add = true;
    onChange(items.map((it, i) => (i === index ? line : it)));
    setQuickEditIndex(null);
    if (isBed) {
      // Beds land in the configurator either way — the questions (ארגז מצעים,
      // הפרדה יהודית, קטלוג בד) are what make a bed a bed.
      setBedWizardSnapshot([]);
      setBedWizardIndex(index);
    } else {
      setExpanded((e) => ({ ...e, [index]: true }));
    }
  };

  // Add a product line straight from the picker's product + size selection.
  const addFromSelection = (variation) => {
    const product = productById(variation.product_id);
    if (!product) return;
    const isBed = product.category === 'bed';
    // Catalog final_price is stored PRE-VAT (the product page shows it under
    // "לפני מע״מ" and derives incl-VAT as ×1.18). The quote line also stores
    // pre-VAT and re-adds VAT for display, so use final_price as-is.
    const price = variation.final_price || 0;

    // Edit mode: replace the row's product/size in place (keep qty + discount).
    if (editIndex != null) {
      const prev = items[editIndex] || {};
      const sameProduct = prev.product_id === product.id;
      onChange(items.map((it, i) => (i === editIndex ? withTotal({
        ...prev,
        product_id: product.id,
        name: product.name,
        sku: variation.sku || '',
        variation_id: variation.id,
        length_cm: variation.length_cm ?? null,
        width_cm: variation.width_cm ?? null,
        height_cm: variation.height_cm ?? null,
        unit_price: price,
        selected_addons: sameProduct ? (prev.selected_addons || []) : [],
      }) : it)));
      setSelectorOpen(false);
      setEditIndex(null);
      return;
    }

    const line = {
      product_id: product.id,
      name: product.name,
      sku: variation.sku || '',
      variation_id: variation.id,
      length_cm: variation.length_cm ?? null,
      width_cm: variation.width_cm ?? null,
      height_cm: variation.height_cm ?? null,
      quantity: 1,
      unit_price: price,
      discount_percent: 0,
      total: price,
      selected_addons: [],
      ...(isBed ? { bed_config_token: genBedConfigToken(), bed_config_fields: [] } : {}),
    };
    const next = [...items, line];
    onChange(next);
    setSelectorOpen(false);
    const newIndex = next.length - 1;
    if (isBed) {
      // Beds: jump straight into the configurator after the size step.
      setBedWizardSnapshot([]);
      setBedWizardIndex(newIndex);
    } else {
      setExpanded((e) => ({ ...e, [newIndex]: true }));
    }
  };

  const applicableAddonsFor = (item) => {
    const product = productById(item.product_id);
    return addons.filter((addon) => {
      const matchesCategory = !addon.applicable_categories?.length || addon.applicable_categories.includes(product?.category);
      if (!matchesCategory) return false;
      if (addon.applies_to === 'double' && !productMatchesBedType(product, 'double')) return false;
      if (addon.applies_to === 'single' && !productMatchesBedType(product, 'single')) return false;
      return true;
    });
  };

  const resolveAddonPrice = (addon, item) => {
    const variation = variations.find((v) => v.id === item.variation_id);
    const sizePrice = addon.size_prices?.find((sp) => sp.width_cm === variation?.width_cm && sp.length_cm === variation?.length_cm);
    const specific = addonPrices.find((ap) => ap.addon_id === addon.id && ap.product_id === item.product_id && ap.product_variation_id === item.variation_id);
    const productP = addonPrices.find((ap) => ap.addon_id === addon.id && ap.product_id === item.product_id && !ap.product_variation_id);
    return specific?.price ?? productP?.price ?? sizePrice?.price ?? addon.base_price ?? 0;
  };

  const insertAddon = (index, addon, price) => {
    const line = { product_id: '', variation_id: '', sku: '', name: addon.name, quantity: 1, unit_price: price, discount_percent: 0, total: price, selected_addons: [] };
    const next = [...items];
    next.splice(index + 1, 0, line);
    onChange(next);
  };

  const openBedWizard = (index) => {
    const it = items[index];
    if (it && !it.bed_config_token) {
      onChange(items.map((l, i) => (i === index ? { ...l, bed_config_token: genBedConfigToken() } : l)));
    }
    setBedWizardSnapshot(null);
    setBedWizardIndex(index);
  };

  const bedItem = bedWizardIndex != null ? items[bedWizardIndex] : null;
  const bedProduct = bedItem ? productById(bedItem.product_id) : null;
  const bedVariation = bedItem ? variations.find((v) => v.id === bedItem.variation_id) : null;
  const bedToken = bedItem?.bed_config_token;
  const bedInitialLines = bedWizardSnapshot != null
    ? bedWizardSnapshot
    : (bedToken ? items.filter((l) => l.bed_config_owner === bedToken) : []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">פריטים</h3>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addCustomItem}>
            <PencilLine className="h-4 w-4" /> הוסף פריט כללי
          </Button>
          {/* Between the two: a catalog line without the picker's four steps.
              "הוסף פריט" and "הוסף פריט כללי" are untouched — this is an extra
              way in while the reps decide which one they like. */}
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addQuickProductItem}>
            <Search className="h-4 w-4" /> הוסף מוצר
          </Button>
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setSelectorOpen(true)}>
            <Plus className="h-4 w-4" /> הוסף פריט
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => setSelectorOpen(true)}
          className="w-full rounded-xl border-2 border-dashed border-border py-10 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
        >
          <Package className="h-8 w-8 opacity-40" />
          <span className="text-sm font-medium">לחץ להוספת מוצר ראשון</span>
        </button>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-muted/50 text-[11px] font-medium text-muted-foreground">
                <th className="text-center py-2.5 px-2 w-10">#</th>
                <th className="text-right py-2.5 px-3">מוצר</th>
                <th className="text-center py-2.5 px-2 w-28">מידה</th>
                <th className="text-center py-2.5 px-2 w-28">כמות</th>
                <th className="text-center py-2.5 px-2 w-28">מחיר יח׳<div className="text-[9px] font-normal opacity-70">לפני מע״מ</div></th>
                <th className="text-center py-2.5 px-2 w-24">הנחה</th>
                <th className="text-center py-2.5 px-2 w-28">סה״כ<div className="text-[9px] font-normal opacity-70">כולל מע״מ</div></th>
                <th className="py-2.5 px-2 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((item, index) => {
                if (item.is_custom) {
                  // Free-text line: name + price are typed, everything else
                  // (quantity, discount, totals) behaves like a catalog row.
                  return (
                    <tr key={index} className="hover:bg-muted/20 transition-colors">
                      <td className="text-center py-2.5 px-2 text-muted-foreground tabular-nums">{index + 1}</td>
                      <td className="py-2.5 px-3">
                        {item.is_quick_add ? (
                          <>
                            <ProductNameSearch
                              products={products}
                              variations={variations}
                              value={item.name || ''}
                              product={item.product_id ? productById(item.product_id) : null}
                              onPickProduct={(product, text) => {
                                // product === null → the rep typed over a
                                // chosen product; undefined → they are still
                                // typing and nothing was chosen yet.
                                onChange(items.map((it, i) => (i === index ? withTotal({
                                  ...it,
                                  name: text ?? '',
                                  ...(product
                                    ? { product_id: product.id, name: product.name, awaiting_size: true }
                                    : { product_id: '', variation_id: '', sku: '', awaiting_size: false, unit_price: 0 }),
                                }) : it)));
                              }}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {item.awaiting_size ? 'בחר מידה כדי להשלים את השורה' : 'מוצר מהקטלוג'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Input
                              value={item.name || ''}
                              onChange={(e) => updateItem(index, 'name', e.target.value)}
                              placeholder="שם הפריט"
                              className="h-8 text-sm"
                            />
                            <span className="text-[10px] text-muted-foreground">פריט כללי</span>
                          </>
                        )}
                      </td>
                      <td className="text-center py-2.5 px-2 text-xs text-muted-foreground">
                        {item.is_quick_add && item.product_id ? (
                          <ProductSizeSelect
                            variations={variations}
                            productId={item.product_id}
                            onPickVariation={(variation) => completeQuickRow(index, variation)}
                          />
                        ) : '—'}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-center">
                          <div className="flex items-center border rounded-lg overflow-hidden">
                            <button type="button" onClick={() => updateItem(index, 'quantity', Math.max(1, (item.quantity || 1) - 1))} className="h-7 w-7 flex items-center justify-center hover:bg-muted">−</button>
                            <span className="h-7 w-8 flex items-center justify-center text-sm font-semibold border-x tabular-nums">{item.quantity || 1}</span>
                            <button type="button" onClick={() => updateItem(index, 'quantity', (item.quantity || 1) + 1)} className="h-7 w-7 flex items-center justify-center hover:bg-muted">+</button>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        {/* A quick-add row waiting on its size has no price of
                            its own yet — the size sets it, and after that the
                            row is a catalog row with a locked price. */}
                        {item.awaiting_size ? (
                          <span className="block text-center text-xs text-muted-foreground">—</span>
                        ) : (
                        <>
                        {/* The rep types the price the customer pays — incl.
                            VAT — and we store the pre-VAT figure the rest of
                            the app works in. */}
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            customPriceDraft?.index === index
                              ? customPriceDraft.text
                              : round2((item.unit_price || 0) * VAT)
                          }
                          onFocus={(e) => { if (Number(e.target.value) === 0) e.target.select(); }}
                          onChange={(e) => {
                            const text = e.target.value;
                            setCustomPriceDraft({ index, text });
                            // Stored at full precision on purpose: rounding the
                            // pre-VAT figure to agorot makes ₪100 come back as
                            // ₪100.01 on the way out. Totals round once, at the
                            // end, where it belongs.
                            updateItem(index, 'unit_price', (parseFloat(text) || 0) / VAT);
                          }}
                          onBlur={() => setCustomPriceDraft(null)}
                          className="h-8 text-sm text-center"
                          dir="ltr"
                        />
                        <span className="block text-[9px] text-muted-foreground text-center mt-0.5">כולל מע״מ</span>
                        </>
                        )}
                      </td>
                      <td className="text-center py-2.5 px-2">
                        <DiscountPopover item={item} onApplyDiscount={(p) => updateItem(index, 'discount_percent', p)} />
                      </td>
                      <td className="text-center py-2.5 px-2 font-bold text-primary tabular-nums">{ils((item.total || 0) * VAT)}</td>
                      <td className="py-2.5 px-2 text-center">
                        <button type="button" onClick={() => removeItem(index)} className="text-muted-foreground/40 hover:text-red-500 p-1.5" title="מחק">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                }
                const isSub = !item.product_id;
                if (isSub) {
                  // Add-on / bed-configurator line — a compact child row.
                  return (
                    <tr key={index} className="bg-muted/20">
                      <td className="text-center py-2 px-2 text-muted-foreground/40">
                        <CornerDownLeft className="h-3.5 w-3.5 mx-auto" />
                      </td>
                      <td className="py-2 px-3 text-foreground/80" colSpan={4}>{item.name}</td>
                      <td className="text-center py-2 px-2">
                        <DiscountPopover item={item} onApplyDiscount={(p) => updateItem(index, 'discount_percent', p)} />
                      </td>
                      <td className="text-center py-2 px-2 font-semibold text-primary tabular-nums">{ils((item.total || 0) * VAT)}</td>
                      <td className="py-2 px-2 text-center">
                        <button type="button" onClick={() => removeItem(index)} className="text-muted-foreground/40 hover:text-red-500 p-1">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                }
                const product = productById(item.product_id);
                const isBed = product?.category === 'bed';
                const canExpand = !isBed && applicableAddonsFor(item).length > 0;
                const isOpen = !isBed && !!expanded[index];
                const fieldLines = isBed ? bedConfigFieldLines(item) : [];
                return (
                  <React.Fragment key={index}>
                    <tr className="hover:bg-muted/20 transition-colors">
                      <td className="text-center py-2.5 px-2 text-muted-foreground tabular-nums">{index + 1}</td>
                      <td className="py-2.5 px-3">
                        {quickEditIndex === index ? (
                          <ProductNameSearch
                            products={products}
                            variations={variations}
                            value={item.name || ''}
                            product={product}
                            onPickProduct={(picked, text) => {
                              if (!picked) {
                                updateItem(index, 'name', text ?? '');
                                return;
                              }
                              // A different product means the old size is
                              // meaningless — back to picking one.
                              onChange(items.map((it, i) => (i === index ? withTotal({
                                ...it,
                                product_id: picked.id,
                                name: picked.name,
                                variation_id: '',
                                sku: '',
                                width_cm: null,
                                length_cm: null,
                                unit_price: 0,
                                awaiting_size: true,
                                is_custom: true,
                              }) : it)));
                            }}
                          />
                        ) : (
                        <>
                        <div className="font-medium text-foreground leading-tight flex items-center gap-1.5 flex-wrap">
                          {item.name}
                          {/* 30-day trial comes from the product itself, shown on
                              its row (not a manual order-level toggle). */}
                          {hasTrialPeriod(product) ? (
                            <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 text-[9px] font-semibold px-1.5 py-0.5 rounded">30 ימי נסיון</span>
                          ) : null}
                        </div>
                        {product?.category ? (
                          <span className="text-[10px] text-muted-foreground">{CATEGORY_LABELS[product.category] || product.category}</span>
                        ) : null}
                        {/* קטלוג בד ושדות טקסט — תצוגה מהירה מתחת לשם; לעריכה
                            פותחים את האשף בכפתור התצורה. */}
                        {fieldLines.length ? (
                          <div className="mt-1 space-y-0.5">
                            {fieldLines.map((ln, i) => (
                              <div key={i} className="text-[10px] text-muted-foreground leading-snug">{ln}</div>
                            ))}
                          </div>
                        ) : null}
                        </>
                        )}
                      </td>
                      <td className="text-center py-2.5 px-2 text-xs text-muted-foreground tabular-nums" dir="ltr">
                        {quickEditIndex === index ? (
                          <ProductSizeSelect
                            variations={variations}
                            productId={item.product_id}
                            onPickVariation={(variation) => completeQuickRow(index, variation)}
                          />
                        ) : item.width_cm && item.length_cm ? `${item.width_cm}×${item.length_cm}` : '—'}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-center">
                          <div className="flex items-center border rounded-lg overflow-hidden">
                            <button type="button" onClick={() => updateItem(index, 'quantity', Math.max(1, (item.quantity || 1) - 1))} className="h-7 w-7 flex items-center justify-center hover:bg-muted">−</button>
                            <span className="h-7 w-8 flex items-center justify-center text-sm font-semibold border-x tabular-nums">{item.quantity || 1}</span>
                            <button type="button" onClick={() => updateItem(index, 'quantity', (item.quantity || 1) + 1)} className="h-7 w-7 flex items-center justify-center hover:bg-muted">+</button>
                          </div>
                        </div>
                      </td>
                      <td className="text-center py-2.5 px-2 tabular-nums">{ils(item.unit_price)}</td>
                      <td className="text-center py-2.5 px-2">
                        <DiscountPopover item={item} onApplyDiscount={(p) => updateItem(index, 'discount_percent', p)} />
                      </td>
                      <td className="text-center py-2.5 px-2 font-bold text-primary tabular-nums">{ils((item.total || 0) * VAT)}</td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-center gap-0.5">
                          {/* Pencil = edit this item. Beds open the config wizard
                              (questions/fabric/prices); other rows re-open the
                              product picker to change the product/size. */}
                          <button
                            type="button"
                            onClick={() => {
                              if (isBed) return openBedWizard(index);
                              // A row added by typing is edited by typing.
                              if (item.is_quick_add) return setQuickEditIndex(quickEditIndex === index ? null : index);
                              editProduct(index);
                            }}
                            title={isBed ? 'עריכת תצורת מיטה' : 'עריכת מוצר/מידה'}
                            className="p-1.5 rounded-md transition-colors text-primary hover:bg-primary/10"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {!isBed && canExpand ? (
                            <button
                              type="button"
                              onClick={() => setExpanded((e) => ({ ...e, [index]: !e[index] }))}
                              title="תוספות"
                              className={`p-1.5 rounded-md transition-colors ${isOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                            >
                              <Settings2 className="h-4 w-4" />
                            </button>
                          ) : null}
                          <button type="button" onClick={() => removeItem(index)} className="text-muted-foreground/40 hover:text-red-500 p-1.5" title="מחק">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Non-bed add-ons live in an expander. Beds have no expander —
                        their config (incl. add-on-like choices) is in the wizard. */}
                    {isOpen ? (
                      <tr>
                        <td colSpan={8} className="bg-muted/20 px-4 py-3 border-t border-border/40">
                          {(() => {
                            const apps = applicableAddonsFor(item);
                            if (!apps.length) return null;
                            return (
                              <div className="space-y-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground">תוספות למוצר</span>
                                <div className="flex flex-wrap gap-2">
                                  {apps.map((addon) => {
                                    const price = resolveAddonPrice(addon, item);
                                    return (
                                      <Button key={addon.id} type="button" variant="outline" size="sm" onClick={() => insertAddon(index, addon, price)} className="text-xs h-8 bg-primary/5 border-primary/20 text-primary hover:bg-primary/10">
                                        <Plus className="w-3 h-3 me-1" /> {addon.name} ({ils(price * VAT)})
                                      </Button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Product picker — opened by "הוסף פריט", straight into a fresh selection */}
      <ProductSelector
        products={products}
        variations={variations}
        value={null}
        onSelect={() => {}}
        onVariationSelect={addFromSelection}
        open={selectorOpen}
        onOpenChange={(o) => { setSelectorOpen(o); if (!o) setEditIndex(null); }}
        hideTrigger
      />

      {/* Bed configurator wizard */}
      {bedWizardIndex != null ? (
        <BedConfigWizard
          open={bedWizardIndex != null}
          onOpenChange={(o) => { if (!o) { setBedWizardIndex(null); setBedWizardSnapshot(null); } }}
          product={bedProduct}
          variation={bedVariation}
          token={bedToken}
          initialLines={bedInitialLines}
          initialFields={bedItem?.bed_config_fields || []}
          onConfirm={(lines, fields) => {
            const kept = items.filter((l) => !(bedToken && l.bed_config_owner === bedToken));
            const bedIdx = bedToken ? kept.findIndex((l) => l.bed_config_token === bedToken) : bedWizardIndex;
            // Attach the text-field answers (e.g. fabric catalog) to the bed line.
            const withFields = bedIdx >= 0
              ? kept.map((l, i) => (i === bedIdx ? { ...l, bed_config_fields: fields } : l))
              : kept;
            const at = bedIdx >= 0 ? bedIdx + 1 : Math.min(bedWizardIndex + 1, kept.length);
            onChange([...withFields.slice(0, at), ...lines, ...withFields.slice(at)]);
          }}
        />
      ) : null}
    </div>
  );
}
