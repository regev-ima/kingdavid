import React, { useState } from 'react';
import ProductSelector from '@/components/quote/ProductSelector';
import BedConfigWizard from '@/components/quote/BedConfigWizard';
import DiscountPopover from '@/components/quote/DiscountPopover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, BedDouble, Package, Settings2, CornerDownLeft } from 'lucide-react';
import { productMatchesBedType } from '@/utils/bedType';
import { genBedConfigToken } from '@/lib/bedConfig';
import { FABRIC_SUPPLIERS, FABRIC_SUPPLIER_OTHER } from '@/constants/fabricSuppliers';

const VAT = 1.18;
const ils = (n) => `₪${Math.round((n || 0)).toLocaleString()}`;
const CATEGORY_LABELS = { bed: 'מיטה', mattress: 'מזרון', topper: 'תוספת', accessory: 'נלווה' };

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

  const productById = (id) => products.find((p) => p.id === id);

  // Recompute a line's own pre-VAT total from qty / unit price / discount.
  const withTotal = (it) => {
    const addonsPrices = (it.selected_addons || []).reduce((s, a) => s + (a.price || 0), 0);
    const gross = (it.quantity || 1) * ((it.unit_price || 0) + addonsPrices);
    return { ...it, total: gross - gross * ((it.discount_percent || 0) / 100) };
  };

  const updateItem = (index, field, value) => {
    onChange(items.map((it, i) => (i === index ? withTotal({ ...it, [field]: value }) : it)));
  };

  const removeItem = (index) => {
    const it = items[index];
    const token = it?.bed_config_token;
    // Removing a bed also drops the configurator lines that belong to it.
    let next = items.filter((_, i) => i !== index);
    if (token) next = next.filter((l) => l.bed_config_owner !== token);
    onChange(next);
  };

  // Add a product line straight from the picker's product + size selection.
  const addFromSelection = (variation) => {
    const product = productById(variation.product_id);
    if (!product) return;
    const isBed = product.category === 'bed';
    const price = variation.final_price || 0;
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
      fabric_catalog_name: '', fabric_color_number: '', fabric_color: '', fabric_supplier: '', fabric_supplier_other: '',
      ...(isBed ? { bed_config_token: genBedConfigToken() } : {}),
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
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">פריטים</h3>
        <Button type="button" size="sm" className="gap-1.5" onClick={() => setSelectorOpen(true)}>
          <Plus className="h-4 w-4" /> הוסף פריט
        </Button>
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
                const canExpand = isBed || applicableAddonsFor(item).length > 0;
                const isOpen = !!expanded[index];
                return (
                  <React.Fragment key={index}>
                    <tr className="hover:bg-muted/20 transition-colors">
                      <td className="text-center py-2.5 px-2 text-muted-foreground tabular-nums">{index + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-foreground leading-tight">{item.name}</div>
                        {product?.category ? (
                          <span className="text-[10px] text-muted-foreground">{CATEGORY_LABELS[product.category] || product.category}</span>
                        ) : null}
                      </td>
                      <td className="text-center py-2.5 px-2 text-xs text-muted-foreground tabular-nums" dir="ltr">
                        {item.width_cm && item.length_cm ? `${item.width_cm}×${item.length_cm}` : '—'}
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
                          {canExpand ? (
                            <button
                              type="button"
                              onClick={() => setExpanded((e) => ({ ...e, [index]: !e[index] }))}
                              title="תוספות ותצורה"
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

                    {isOpen ? (
                      <tr>
                        <td colSpan={8} className="bg-muted/20 px-4 py-3 border-t border-border/40">
                          <div className="space-y-3">
                            {isBed ? (
                              <div>
                                <Button type="button" variant="outline" size="sm" onClick={() => openBedWizard(index)} className="gap-1.5 h-8 text-xs bg-primary/5 border-primary/20 text-primary hover:bg-primary/10">
                                  <BedDouble className="h-3.5 w-3.5" /> תצורת מיטה (אשף)
                                </Button>
                              </div>
                            ) : null}

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

                            {isBed ? (
                              <div className="space-y-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground">קטלוג בד</span>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <Input placeholder="שם קטלוג" value={item.fabric_catalog_name || ''} onChange={(e) => updateItem(index, 'fabric_catalog_name', e.target.value)} className="h-8 text-xs" />
                                  <Input placeholder="מס׳ צבע" value={item.fabric_color_number || ''} onChange={(e) => updateItem(index, 'fabric_color_number', e.target.value)} className="h-8 text-xs" />
                                  <Input placeholder="צבע" value={item.fabric_color || ''} onChange={(e) => updateItem(index, 'fabric_color', e.target.value)} className="h-8 text-xs" />
                                  <Select value={item.fabric_supplier || ''} onValueChange={(val) => { updateItem(index, 'fabric_supplier', val); if (val !== FABRIC_SUPPLIER_OTHER) updateItem(index, 'fabric_supplier_other', ''); }}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="ספק" /></SelectTrigger>
                                    <SelectContent>
                                      {FABRIC_SUPPLIERS.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {item.fabric_supplier === FABRIC_SUPPLIER_OTHER ? (
                                  <Input placeholder="שם הספק" value={item.fabric_supplier_other || ''} onChange={(e) => updateItem(index, 'fabric_supplier_other', e.target.value)} className="h-8 text-xs" />
                                ) : null}
                              </div>
                            ) : null}
                          </div>
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
        onOpenChange={setSelectorOpen}
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
          onConfirm={(lines) => {
            const kept = items.filter((l) => !(bedToken && l.bed_config_owner === bedToken));
            const bedIdx = bedToken ? kept.findIndex((l) => l.bed_config_token === bedToken) : bedWizardIndex;
            const at = bedIdx >= 0 ? bedIdx + 1 : Math.min(bedWizardIndex + 1, kept.length);
            onChange([...kept.slice(0, at), ...lines, ...kept.slice(at)]);
          }}
        />
      ) : null}
    </div>
  );
}
