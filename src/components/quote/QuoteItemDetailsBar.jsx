import React from 'react';
import { Trash2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import DiscountPopover from '@/components/quote/DiscountPopover';

const VAT_RATE = 1.18;
const ils = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// One symmetric column: a fixed-height caption block (main + optional VAT
// qualifier) over a fixed-height value block, both centered. Every cell shares
// the same heights so the whole row lines up like a tidy table.
function Cell({ label, sub, children }) {
  return (
    <div className="flex-1 min-w-[110px] flex flex-col items-center justify-center gap-1.5 px-3 py-3 text-center">
      <div className="h-7 flex flex-col items-center justify-center leading-tight">
        <span className="text-[11px] font-medium text-muted-foreground/80 whitespace-nowrap">{label}</span>
        {sub ? <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap">{sub}</span> : null}
      </div>
      <div className="h-9 flex items-center justify-center">{children}</div>
    </div>
  );
}

/**
 * Symmetric, labelled price/quantity/discount bar under a quote line item.
 * Shared by NewQuote and EditQuote. Expects a TooltipProvider above it
 * (both pages wrap the item card in one).
 */
export default function QuoteItemDetailsBar({ item, onUpdateQuantity, onApplyDiscount, onRemove }) {
  const qty = item.quantity || 1;
  const unitPrice = item.unit_price || 0;
  const discountPct = item.discount_percent || 0;
  const hasDiscount = discountPct > 0;

  const addonsTotal = (item.selected_addons || []).reduce((s, a) => s + (a.price || 0), 0);
  const originalInclVat = (unitPrice + addonsTotal) * qty * VAT_RATE;
  const finalInclVat = (item.total || 0) * VAT_RATE;

  return (
    <div className="flex flex-wrap items-stretch divide-x divide-border/40 border-t border-border/40 bg-muted/20">
      <Cell label="מק״ט">
        <span className="font-mono text-xs text-foreground" dir="ltr">{item.sku || '—'}</span>
      </Cell>

      <Cell label="כמות">
        <div className="flex items-center border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => onUpdateQuantity(Math.max(1, qty - 1))}
            className="h-8 w-8 flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors"
          >
            −
          </button>
          <span className="h-8 w-9 flex items-center justify-center text-sm font-semibold border-x">{qty}</span>
          <button
            type="button"
            onClick={() => onUpdateQuantity(qty + 1)}
            className="h-8 w-8 flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors"
          >
            +
          </button>
        </div>
      </Cell>

      <Cell label="מחיר ליחידה" sub="לפני מע״מ">
        <span className="text-sm font-semibold text-foreground">{ils(unitPrice)}</span>
      </Cell>

      <Cell label="הנחה">
        <DiscountPopover item={item} onApplyDiscount={onApplyDiscount} />
      </Cell>

      <Cell label="מחיר מקורי" sub="כולל מע״מ">
        {hasDiscount ? (
          <span className="text-sm font-medium text-muted-foreground line-through">{ils(originalInclVat)}</span>
        ) : (
          <span className="text-sm text-muted-foreground/40">—</span>
        )}
      </Cell>

      <Cell label="סה״כ" sub="כולל מע״מ">
        <span className="text-sm font-bold text-primary">{ils(finalInclVat)}</span>
      </Cell>

      {/* Delete — trailing, vertically centred with the value row */}
      <div className="flex-none flex items-center justify-center px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRemove}
              className="text-muted-foreground/40 hover:text-red-500 transition-colors p-1.5"
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
