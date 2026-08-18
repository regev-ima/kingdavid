import React, { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Percent, Check } from "lucide-react";
import {
  discountAmountOf,
  discountPercentFromAmount,
  formatDiscountPercent,
} from "@/lib/discount";
import { lineGrossPreVat, round2, VAT_MULTIPLIER } from "@/lib/quoteTotals";

const ils = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A discount is given as the price the customer ends up paying, and nothing
// else. Reps quote a bed at a number — "give it to him for 5,000" — so the
// shekel-off and percent-off entries were two more ways to say the same thing,
// each with its own rounding to argue with. The line still stores a percent;
// that is a storage detail the popover no longer asks anyone to think in.
export default function DiscountPopover({ item, onApplyDiscount }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  // The line's list price including VAT — what the final price is measured
  // against, and the same figure the totals panel bills off.
  const priceWithVat = lineGrossPreVat(item) * VAT_MULTIPLIER;

  // Reopen on the price the line is actually at, so pressing "החל" again
  // re-applies the same discount instead of reading as a fresh one off the
  // list price.
  useEffect(() => {
    if (!open) return;
    const stored = Number(item.discount_percent) || 0;
    if (stored <= 0) {
      setInputValue('');
    } else {
      setInputValue(String(round2(round2(priceWithVat) - discountAmountOf(stored, priceWithVat))));
    }
  }, [open]);

  const getDiscountPercent = () => {
    const val = parseFloat(inputValue) || 0;
    if (val <= 0) return 0;
    const clampedFinal = Math.max(0, Math.min(val, priceWithVat));
    return discountPercentFromAmount(priceWithVat - clampedFinal, priceWithVat);
  };

  // Apply the percent at full precision — rounding it to two decimals here is
  // what used to turn a ₪480 discount into ₪480.05.
  const handleApply = () => {
    onApplyDiscount(getDiscountPercent());
    setOpen(false);
  };

  const previewPercent = getDiscountPercent();
  // Off the rounded price the rep is reading above, so the figure that comes
  // off and the price they typed add back up on screen.
  const previewAmount = discountAmountOf(previewPercent, priceWithVat);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={item.discount_percent > 0 ? "default" : "outline"}
          size="sm"
          className={`w-20 h-9 text-xs ${item.discount_percent > 0 ? 'bg-red-500 hover:bg-red-600 text-white' : 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700'}`}
        >
          {item.discount_percent > 0 ? formatDiscountPercent(item.discount_percent) : (
            <><Percent className="w-3 h-3 me-1" />הנחה</>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="start" side="top">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">הנחה על פריט</p>
          <p className="text-xs text-muted-foreground">מחיר כולל מע״מ: {ils(priceWithVat)}</p>

          {/* Input */}
          <div className="space-y-1">
            <Label className="text-xs">מחיר סופי כולל מע״מ</Label>
            <Input
              type="number"
              min="0"
              max={round2(priceWithVat)}
              step="0.01"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="₪"
              className="text-left"
              dir="ltr"
              autoFocus
            />
          </div>

          {/* Preview */}
          {parseFloat(inputValue) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-red-700">הנחה:</span>
                <span className="font-bold text-red-700">{formatDiscountPercent(previewPercent)} ({ils(previewAmount)})</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="flex-1" onClick={handleApply}>
              <Check className="w-3 h-3 me-1" />
              החל
            </Button>
            {item.discount_percent > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-red-600"
                onClick={() => { onApplyDiscount(0); setOpen(false); }}
              >
                הסר
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}