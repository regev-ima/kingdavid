import React, { useState } from 'react';
import { Check, Info, Trash2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeCounts, describeChargeRule } from '@/lib/deliveryCharges';

// The "תוספות להובלה" picker, shared by NewQuote / EditQuote / NewOrder so the
// three screens offer exactly the same set for the same items.
//
// Two things it does that the old inline grids didn't:
//   • states the order's composition ("1 מיטה, 1 מזרן"), so a mis-detected
//     count is visible instead of only showing up as a wrong price;
//   • when a category on the order has no matching charge row it says so and
//     lets the rep open the full list, instead of silently offering nothing (or
//     the row for the wrong quantity).
export default function DeliveryExtrasPicker({
  charges = [],            // the applicable rows
  allCharges = [],         // every selectable row, for the manual override
  missingCategories = [],
  counts,
  selectedExtras = [],     // what's on the quote/order now
  onToggle,
  onRemoveAt,
}) {
  const [showAll, setShowAll] = useState(false);
  const composition = describeCounts(counts);
  const hiddenCount = Math.max(0, allCharges.length - charges.length);
  const selectedIds = selectedExtras.map((ex) => ex.extra_charge_id);
  // An extra already on the document whose row isn't in the visible grid —
  // typically carried over from the quote and no longer applicable, or its
  // catalog row was deactivated. It still costs money, so it must stay visible
  // and removable rather than disappear from the screen.
  const orphans = selectedExtras
    .map((ex, index) => ({ ex, index }))
    .filter(({ ex }) => !(showAll ? allCharges : charges).some((c) => c.id === ex.extra_charge_id));
  const list = showAll ? allCharges : charges;

  return (
    <div className="space-y-3">
      {composition ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Truck className="h-3.5 w-3.5" />
          <span>הרכב ההזמנה: <span className="font-medium text-foreground">{composition}</span></span>
          <span className="opacity-60">· התוספות מסוננות לפי הקטגוריות והכמויות האלה</span>
        </div>
      ) : null}

      {missingCategories.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              לא נמצאה תוספת הובלה שמתאימה ל
              {missingCategories.map((c) => `${c.count} ${c.label}`).join(' ול')}.
            </p>
            <p className="opacity-80">
              הגדר תוספת מתאימה בעמוד "תוספות להזמנות" (קטגוריה + טווח כמות), או בחר ידנית מהרשימה המלאה.
            </p>
          </div>
        </div>
      ) : null}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">אין תוספות זמינות</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {list.map((ec) => {
            const isSelected = selectedIds.includes(ec.id);
            return (
              <button
                key={ec.id}
                type="button"
                onClick={() => onToggle(ec)}
                title={describeChargeRule(ec)}
                className={`relative p-4 border rounded-xl text-center transition-all duration-200 ${
                  isSelected
                    ? 'border-primary/40 bg-primary/[0.04] shadow-[0_0_0_1px_rgba(79,70,229,0.15)]'
                    : 'border-border bg-white hover:border-primary/20 hover:bg-muted/30'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className="font-medium text-sm text-foreground">{ec.name}</div>
                <div className={`text-lg font-bold mt-1.5 ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                  ₪{Number(ec.cost || 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{describeChargeRule(ec)}</div>
              </button>
            );
          })}
        </div>
      )}

      {orphans.length ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">תוספות שנבחרו ואינן ברשימה שמעל</p>
          {orphans.map(({ ex, index }) => (
            <div key={`${ex.extra_charge_id}-${index}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium text-foreground">{ex.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">₪{Number(ex.cost || 0).toLocaleString()}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500"
                  onClick={() => onRemoveAt?.(index)}
                  title="הסר תוספת"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {hiddenCount > 0 || showAll ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'הצג רק תוספות שמתאימות להזמנה' : `הצג את כל התוספות (${hiddenCount} מוסתרות)`}
        </Button>
      ) : null}
    </div>
  );
}
