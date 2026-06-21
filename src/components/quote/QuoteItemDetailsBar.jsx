import React from 'react';
import { Trash2, X } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import DiscountPopover from '@/components/quote/DiscountPopover';

const VAT_RATE = 1.18;
const ils = (n) => `₪${Math.round(n || 0).toLocaleString()}`;

// One labelled cell: a tiny muted caption over its value, so every number on
// the row says what it is (original price / discount / final total) instead of
// a cramped strip of bare numbers.
function Field({ label, align = 'start', children }) {
  return (
    <div className={`flex flex-col gap-1 ${align === 'end' ? 'items-end text-right' : 'items-start'}`}>
      <span className="text-[10px] font-medium text-muted-foreground/70 whitespace-nowrap">{label}</span>
      {children}
    </div>
  );
}

/**
 * The labelled price/quantity/discount bar under a quote line item.
 * Shared by NewQuote and EditQuote so both read identically.
 *
 * Expects a TooltipProvider somewhere above it (both pages already wrap the
 * item card in one).
 */
export default function QuoteItemDetailsBar({ item, onUpdateQuantity, onApplyDiscount, onRemove }) {
  const qty = item.quantity || 1;
  const unitPrice = item.unit_price || 0;
  const discountPct = item.discount_percent || 0;
  const hasDiscount = discountPct > 0;

  const addonsTotal = (item.selected_addons || []).reduce((s, a) => s + (a.price || 0), 0);
  const lineBeforeVat = (unitPrice + addonsTotal) * qty;      // pre-discount, incl. add-ons
  const originalInclVat = lineBeforeVat * VAT_RATE;           // "מחיר מקורי"
  const finalInclVat = (item.total || 0) * VAT_RATE;          // "סה״כ"
  const savingsInclVat = Math.max(0, originalInclVat - finalInclVat);

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-4 py-3 bg-muted/20 border-t border-border/40">
      {/* SKU */}
      <Field label="מק״ט">
        <span className="font-mono text-xs text-foreground" dir="ltr">{item.sku || '—'}</span>
      </Field>

      {/* Quantity */}
      <Field label="כמות">
        <div className="flex items-center border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => onUpdateQuantity(Math.max(1, qty - 1))}
            className="h-7 w-7 flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors"
          >
            −
          </button>
          <span className="h-7 w-9 flex items-center justify-center text-xs font-semibold border-x">{qty}</span>
          <button
            type="button"
            onClick={() => onUpdateQuantity(qty + 1)}
            className="h-7 w-7 flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors"
          >
            +
          </button>
        </div>
      </Field>

      {/* Unit price (before VAT) */}
      <Field label="מחיר ליחידה · לפני מע״מ">
        <span className="text-sm font-medium text-foreground">{ils(unitPrice)}</span>
      </Field>

      {/* Discount: the % lives on the edit button, the ₪ saved next to it */}
      <Field label="הנחה">
        <div className="flex items-center gap-2">
          <DiscountPopover item={item} onApplyDiscount={onApplyDiscount} />
          {hasDiscount && (
            <>
              <span className="text-xs font-semibold text-red-600 whitespace-nowrap">−{ils(savingsInclVat)}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onApplyDiscount(0)}
                    className="text-muted-foreground/50 hover:text-red-600 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>הסר הנחה</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </Field>

      <div className="flex-1 min-w-[12px]" />

      {/* Original price — only when a discount applies */}
      {hasDiscount && (
        <Field label="מחיר מקורי · כולל מע״מ" align="end">
          <span className="text-sm text-muted-foreground line-through">{ils(originalInclVat)}</span>
        </Field>
      )}

      {/* Final total */}
      <Field label="סה״כ · כולל מע״מ" align="end">
        <span className="text-base font-bold text-primary">{ils(finalInclVat)}</span>
      </Field>

      {/* Delete (caption spacer keeps the icon aligned with the value row) */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] text-transparent select-none" aria-hidden>.</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRemove}
              className="text-muted-foreground/40 hover:text-red-500 transition-colors p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>מחק שורה</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
