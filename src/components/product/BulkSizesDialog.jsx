import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertTriangle, Ruler } from 'lucide-react';
import {
  buildVariationSku,
  formatDimensions,
  getSizeDimensions,
  resolveSizePrice,
  suggestBaseSize,
  suggestSkuPrefix,
} from '@/lib/productSizes';

/**
 * "Tick the sizes this product comes in."
 *
 * Adding sizes to a product used to be one dialog per size — type the SKU, type
 * the dimensions, type the price, save, repeat — even though the sizes are the
 * same fixed set every time and the price follows a table that's printed on the
 * showroom card: base price for the product's base size (140/190 double, 80/190
 * single), plus a fixed surcharge per larger size.
 *
 * So the whole thing is one screen: a base price, a checkbox per catalog size,
 * and every SKU and price computed in front of you before anything is written.
 * Each row stays editable — the table is the rule, not a straitjacket.
 */
export default function BulkSizesDialog({ open, onOpenChange, product, existingVariations = [], onCreated }) {
  const queryClient = useQueryClient();

  const { data: sizes = [], isLoading: sizesLoading, error: sizesError } = useQuery({
    // No server-side sort: ordering by a column the table may not have fails the
    // whole request and leaves this dialog silently empty (exactly how the
    // missing `dimensions` column behaved). Sorted below instead.
    queryKey: ['globalSizes'],
    queryFn: () => base44.entities.GlobalSize.list(),
    enabled: open,
  });

  // Per-product exceptions to the shared surcharge table.
  const { data: productSizePrices = [] } = useQuery({
    queryKey: ['productSizePrices', product?.id],
    queryFn: () => base44.entities.ProductSizePrice.filter({ product_id: product.id }),
    enabled: open && !!product?.id,
  });

  const activeSizes = useMemo(() => (
    sizes
      .filter((s) => s.is_active !== false)
      .slice()
      .sort((a, b) => {
        const order = (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0);
        if (order !== 0) return order;
        const da = getSizeDimensions(a);
        const db = getSizeDimensions(b);
        if (da && db) return (da.width_cm - db.width_cm) || (da.length_cm - db.length_cm);
        return String(a?.label || '').localeCompare(String(b?.label || ''), 'he');
      })
  ), [sizes]);

  const inactiveCount = sizes.length - activeSizes.length;

  const baseSize = useMemo(() => {
    if (!activeSizes.length) return null;
    return activeSizes.find((s) => s.id === product?.base_size_id)
      || suggestBaseSize(product?.bed_type, activeSizes);
  }, [activeSizes, product?.base_size_id, product?.bed_type]);

  // A size the product already has — matched on dimensions, not on SKU, because
  // the SKU is derived from them and an older variation may spell it differently.
  const existingByDims = useMemo(() => {
    const map = new Map();
    for (const v of existingVariations) {
      if (v?.width_cm && v?.length_cm) map.set(`${v.width_cm}x${v.length_cm}`, v);
    }
    return map;
  }, [existingVariations]);

  const [prefix, setPrefix] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [selected, setSelected] = useState({});   // sizeId → true
  const [priceEdits, setPriceEdits] = useState({}); // sizeId → typed price

  useEffect(() => {
    if (!open) return;
    setPrefix(product?.sku_prefix || suggestSkuPrefix(product?.name));
    setSelected({});
    setPriceEdits({});
    // Seed the base price from the variation the product already sells at its
    // base size — that IS the base price, so nobody should retype it.
    const baseDims = getSizeDimensions(baseSize);
    const baseVariation = baseDims ? existingByDims.get(`${baseDims.width_cm}x${baseDims.length_cm}`) : null;
    setBasePrice(baseVariation?.base_price != null ? String(baseVariation.base_price) : '');
  }, [open, product?.id, product?.name, product?.sku_prefix, baseSize, existingByDims]);

  const rows = useMemo(() => activeSizes.map((size) => {
    const dims = getSizeDimensions(size);
    const key = dims ? `${dims.width_cm}x${dims.length_cm}` : null;
    const existing = key ? existingByDims.get(key) : null;
    const suggestedPrice = resolveSizePrice({
      basePrice,
      size,
      productSizePrice: productSizePrices.find((psp) => psp.global_size_id === size.id),
    });
    return {
      size,
      dims,
      existing,
      isBase: !!baseSize && size.id === baseSize.id,
      sku: buildVariationSku(prefix, dims),
      price: priceEdits[size.id] !== undefined
        ? priceEdits[size.id]
        : (suggestedPrice != null ? String(suggestedPrice) : ''),
    };
  }), [activeSizes, existingByDims, baseSize, prefix, basePrice, priceEdits, productSizePrices]);

  const selectableRows = rows.filter((r) => r.dims && !r.existing);
  const selectedRows = selectableRows.filter((r) => selected[r.size.id]);
  const missingDims = rows.filter((r) => !r.dims);

  const toggleAll = (checked) => {
    setSelected(checked
      ? Object.fromEntries(selectableRows.map((r) => [r.size.id, true]))
      : {});
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      // Remember the prefix and the base size on the product, so the next batch
      // — and anyone reading the product later — starts from the same answer.
      const productPatch = {};
      if (prefix && prefix !== product.sku_prefix) productPatch.sku_prefix = prefix;
      if (baseSize?.id && baseSize.id !== product.base_size_id) productPatch.base_size_id = baseSize.id;
      if (Object.keys(productPatch).length) {
        await base44.entities.Product.update(product.id, productPatch);
      }

      const created = [];
      for (const row of selectedRows) {
        const price = Number(row.price);
        created.push(await base44.entities.ProductVariation.create({
          product_id: product.id,
          sku: row.sku,
          width_cm: row.dims.width_cm,
          length_cm: row.dims.length_cm,
          base_price: Number.isFinite(price) && price > 0 ? price : null,
          discount_percent: 0,
          stock_quantity: 0,
          is_active: true,
        }));
      }
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['product-variations'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`נוצרו ${created.length} מידות`);
      onCreated?.(created);
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`יצירת המידות נכשלה: ${err?.message || 'שגיאה לא צפויה'}`);
    },
  });

  if (!product) return null;

  const allSelected = selectableRows.length > 0 && selectedRows.length === selectableRows.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5 text-primary" />
            הוספת מידות — {product.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>קידומת מק״ט</Label>
              <Input
                value={prefix}
                dir="ltr"
                maxLength={4}
                onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                placeholder="EDN"
              />
              <p className="text-[11px] text-muted-foreground">
                המק״ט מורכב מהקידומת + רוחב + אורך. לדוגמה: EDN140190
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>
                מחיר בסיס{baseSize ? ` (${formatDimensions(getSizeDimensions(baseSize))})` : ''}
              </Label>
              <Input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="5900"
              />
              <p className="text-[11px] text-muted-foreground">
                {baseSize
                  ? 'המחיר של כל מידה מחושב כבסיס + התוספת שלה בקטלוג, וניתן לעריכה בשורה.'
                  : 'לא נמצאה מידת בסיס למוצר — אפשר למלא מחיר לכל מידה ידנית.'}
              </p>
            </div>
          </div>

          {sizesLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline me-2" />
              טוען מידות...
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(c) => toggleAll(!!c)}
                  disabled={selectableRows.length === 0}
                />
                <span className="text-xs font-medium">
                  בחר הכל ({selectableRows.length} זמינות)
                </span>
              </div>

              <div className="divide-y divide-border/60">
                {rows.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground space-y-1">
                    {sizesError ? (
                      <p className="text-destructive">טעינת קטלוג המידות נכשלה: {sizesError.message}</p>
                    ) : sizes.length === 0 ? (
                      <>
                        <p className="font-medium text-foreground">קטלוג המידות ריק</p>
                        <p>יש להוסיף את המידות הקבועות במסך "מידות גלובליות", ואז הן יופיעו כאן לכל מוצר.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">כל המידות בקטלוג מסומנות כלא פעילות</p>
                        <p>{inactiveCount} מידות קיימות אך כבויות. יש להפעיל אותן במסך "מידות גלובליות".</p>
                      </>
                    )}
                  </div>
                )}
                {rows.map((row) => {
                  const disabled = !row.dims || !!row.existing;
                  return (
                    <div
                      key={row.size.id}
                      className={`flex items-center gap-3 px-3 py-2 ${disabled ? 'opacity-60' : ''}`}
                    >
                      <Checkbox
                        checked={!!selected[row.size.id]}
                        disabled={disabled}
                        onCheckedChange={(c) => setSelected((prev) => ({ ...prev, [row.size.id]: !!c }))}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <span className="font-medium">{row.size.label}</span>
                          {row.dims ? (
                            <span className="text-muted-foreground" dir="ltr">{formatDimensions(row.dims)}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              חסרות מידות — יש להשלים במסך המידות
                            </span>
                          )}
                          {row.isBase && (
                            <span className="text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-0.5 font-semibold">
                              מידת בסיס
                            </span>
                          )}
                          {row.existing && (
                            <span className="text-[10px] rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 font-semibold">
                              כבר קיימת
                            </span>
                          )}
                          {!row.isBase && Number(row.size.size_surcharge) > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              תוספת +₪{Number(row.size.size_surcharge).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {row.sku && !row.existing && (
                          <p className="text-[11px] text-muted-foreground font-mono mt-0.5" dir="ltr">{row.sku}</p>
                        )}
                      </div>
                      <div className="w-32 flex-shrink-0">
                        <Input
                          type="number"
                          className="h-8 text-sm"
                          value={row.price}
                          disabled={disabled}
                          placeholder="מחיר"
                          onChange={(e) => setPriceEdits((prev) => ({ ...prev, [row.size.id]: e.target.value }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {missingDims.length > 0 && (
            <p className="text-xs text-amber-700">
              {missingDims.length} מידות ללא רוחב/אורך ולכן לא ניתנות לסימון. אפשר להשלים אותן במסך "מידות גלובליות".
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={selectedRows.length === 0 || !prefix || createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            צור {selectedRows.length || ''} מידות
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
