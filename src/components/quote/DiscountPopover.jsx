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
  isTypedPercent,
  roundDiscountPercent,
} from "@/lib/discount";
import { lineGrossPreVat, round2, VAT_MULTIPLIER } from "@/lib/quoteTotals";

const ils = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const discountTypes = [
  { value: 'percent', label: 'אחוז הנחה' },
  { value: 'amount', label: 'סכום הנחה (₪)' },
  { value: 'final', label: 'מחיר סופי (₪)' },
];

export default function DiscountPopover({ item, onApplyDiscount }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('percent');
  const [inputValue, setInputValue] = useState('');

  // The line's list price including VAT — the base every discount type is
  // stated against, and the same figure the totals panel bills off.
  const priceWithVat = lineGrossPreVat(item) * VAT_MULTIPLIER;

  // Reopen on the tab the discount was actually set in. A percent the rep
  // typed comes back as a percent; one we derived from a shekel figure comes
  // back as that shekel figure, so pressing "החל" again re-applies the same
  // discount rather than a percent rounded off it.
  useEffect(() => {
    if (!open) return;
    const stored = Number(item.discount_percent) || 0;
    if (stored <= 0) {
      setType('percent');
      setInputValue('');
    } else if (isTypedPercent(stored)) {
      setType('percent');
      setInputValue(String(stored));
    } else {
      setType('amount');
      setInputValue(String(discountAmountOf(stored, priceWithVat)));
    }
  }, [open]);

  const getDiscountPercent = () => {
    const val = parseFloat(inputValue) || 0;
    if (val <= 0) return 0;

    switch (type) {
      case 'percent':
        return roundDiscountPercent(val);
      case 'amount':
        return discountPercentFromAmount(val, priceWithVat);
      case 'final': {
        const clampedFinal = Math.max(0, Math.min(val, priceWithVat));
        return discountPercentFromAmount(priceWithVat - clampedFinal, priceWithVat);
      }
      default:
        return 0;
    }
  };

  const getMaxValue = () => {
    switch (type) {
      case 'percent': return 100;
      case 'amount': return round2(priceWithVat);
      case 'final': return round2(priceWithVat);
      default: return 100;
    }
  };

  // Apply the percent at full precision — rounding it to two decimals here is
  // what used to turn a ₪480 discount into ₪480.05.
  const handleApply = () => {
    onApplyDiscount(getDiscountPercent());
    setOpen(false);
  };

  const previewPercent = getDiscountPercent();
  const previewAmount = discountAmountOf(previewPercent, priceWithVat);
  // Off the rounded price the rep is reading above, so the three figures in
  // the popover add up on screen.
  const previewFinal = round2(round2(priceWithVat) - previewAmount);

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

          {/* Discount type tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {discountTypes.map(dt => (
              <button
                key={dt.value}
                type="button"
                onClick={() => { setType(dt.value); setInputValue(''); }}
                className={`flex-1 text-[11px] py-1.5 px-1 rounded-md font-medium transition-colors ${type === dt.value ? 'bg-white shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground/80'}`}
              >
                {dt.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="space-y-1">
            <Label className="text-xs">
              {type === 'percent' && 'אחוז הנחה'}
              {type === 'amount' && 'סכום הנחה בשקלים'}
              {type === 'final' && 'מחיר סופי כולל מע״מ'}
            </Label>
            <Input
              type="number"
              min="0"
              max={getMaxValue()}
              step="0.01"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={type === 'percent' ? '0-100' : '₪'}
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
              <div className="flex justify-between">
                <span className="text-red-700">מחיר אחרי הנחה:</span>
                <span className="font-bold text-red-700">{ils(previewFinal)}</span>
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