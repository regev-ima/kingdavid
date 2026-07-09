import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, Check } from 'lucide-react';
import { FABRIC_SUPPLIER_OTHER } from '@/constants/fabricSuppliers';
import { bedConfigFieldLines } from '@/lib/bedConfig';

const fmt = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Reusable "are you sure?" preview shown right before a quote is persisted.
// Lists every item with its size/fabric/addons + the document totals so the
// rep can spot a typo or wrong supplier before the row hits the DB.
export default function QuoteConfirmDialog({
  open,
  onOpenChange,
  formData,
  products = [],
  variations = [],
  onConfirm,
  isPending = false,
  title = 'אישור לפני שמירת ההצעה',
  confirmLabel = 'אישור ושמירה',
}) {
  const items = formData?.items || [];
  const extras = formData?.extras || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{title}</DialogTitle>
          <p className="text-xs text-muted-foreground text-right mt-1">
            סקור את הפרטים. ניתן לחזור לעריכה במידת הצורך — שמירה תעדכן את הלקוח ותפיק PDF.
          </p>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Customer */}
          <section className="rounded-xl border border-border bg-muted/30 p-3 space-y-1">
            <div className="text-xs font-semibold text-muted-foreground mb-1">לקוח</div>
            <div className="font-medium">{formData?.customer_name || '—'}</div>
            <div className="text-muted-foreground text-xs">
              {formData?.customer_phone || '—'}
              {formData?.customer_email ? ` · ${formData.customer_email}` : ''}
            </div>
            {(formData?.delivery_address || formData?.delivery_city) && (
              <div className="text-muted-foreground text-xs">
                {[formData?.delivery_address, formData?.delivery_city].filter(Boolean).join(', ')}
              </div>
            )}
          </section>

          {/* Items */}
          <section className="rounded-xl border border-border p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground">פריטים ({items.length})</div>
            {items.length === 0 ? (
              <div className="text-xs text-muted-foreground">לא נבחרו פריטים</div>
            ) : (
              <ul className="space-y-3">
                {items.map((item, idx) => {
                  const product = products.find(p => p.id === item.product_id);
                  const variation = variations.find(v => v.id === item.variation_id);
                  const hasSize = item.length_cm && item.width_cm;
                  const size = hasSize
                    ? `${item.length_cm}×${item.width_cm}${item.height_cm ? `×${item.height_cm}` : ''} ס"מ`
                    : variation ? `${variation.length_cm}×${variation.width_cm} ס"מ` : null;
                  // Bed text-question answers (fabric catalog etc.) — generic
                  // path, with a fallback to legacy fabric_* columns.
                  let fieldLines = bedConfigFieldLines(item);
                  if (!fieldLines.length) {
                    const supplier = item.fabric_supplier === FABRIC_SUPPLIER_OTHER
                      ? (item.fabric_supplier_other || 'אחר')
                      : item.fabric_supplier;
                    const fabricParts = [
                      item.fabric_catalog_name && `קטלוג: ${item.fabric_catalog_name}`,
                      item.fabric_color_number && `מס׳ צבע: ${item.fabric_color_number}`,
                      item.fabric_color && `צבע: ${item.fabric_color}`,
                      supplier && `ספק: ${supplier}`,
                    ].filter(Boolean);
                    if (fabricParts.length) fieldLines = [`בד: ${fabricParts.join(' · ')}`];
                  }
                  const addons = item.selected_addons || [];
                  const lineTotal = Number(item.total) || 0;
                  return (
                    <li key={idx} className="border-b border-border/50 last:border-0 pb-3 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{item.name || product?.name || '—'}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
                            {item.sku && <div dir="ltr" className="text-right">SKU: {item.sku}</div>}
                            {size && <div>מידה: {size}</div>}
                            {fieldLines.map((ln, i) => (
                              <div key={i}>{ln}</div>
                            ))}
                            {addons.length > 0 && (
                              <div>
                                תוספות: {addons.map(a => `${a.name} (+${fmt(a.price)})`).join(', ')}
                              </div>
                            )}
                            {item.discount_percent > 0 && (
                              <div className="text-emerald-700">הנחה: -{item.discount_percent}%</div>
                            )}
                          </div>
                        </div>
                        <div className="text-left shrink-0">
                          <div className="text-[11px] text-muted-foreground">× {item.quantity || 1}</div>
                          <div className="font-semibold">{fmt(lineTotal * 1.18)}</div>
                          <div className="text-[10px] text-muted-foreground">כולל מע״מ</div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Extras (delivery / assembly) */}
          {extras.length > 0 && (
            <section className="rounded-xl border border-border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">תוספות הובלה</div>
              <ul className="space-y-1">
                {extras.map((ex, i) => (
                  <li key={i} className="flex justify-between text-xs">
                    <span>{ex.name}</span>
                    <span className="font-medium">{fmt(ex.cost)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Totals */}
          <section className="rounded-xl border border-border bg-muted/30 p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">סכום לפני מע״מ</span>
              <span>{fmt(formData?.subtotal)}</span>
            </div>
            {Number(formData?.discount_total) > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-emerald-700">הנחה</span>
                <span className="text-emerald-700">-{fmt(formData?.discount_total)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">מע״מ</span>
              <span>{fmt(formData?.vat_amount)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-1 border-t border-border/50">
              <span>סה״כ לתשלום</span>
              <span className="text-primary">{fmt(formData?.total)}</span>
            </div>
          </section>

          {/* Special requests */}
          {formData?.special_requests?.trim() && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-1">
              <div className="text-xs font-semibold text-amber-900">בקשות מיוחדות</div>
              <div className="text-xs text-amber-900 whitespace-pre-wrap">{formData.special_requests}</div>
            </section>
          )}
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="bg-primary hover:bg-primary/90"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                שומר…
              </>
            ) : (
              <>
                <Check className="h-4 w-4 me-2" />
                {confirmLabel}
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            <ArrowRight className="h-4 w-4 me-2" />
            חזרה לעריכה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
