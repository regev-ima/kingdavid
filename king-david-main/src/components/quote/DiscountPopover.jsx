import React, { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Percent, Check } from "lucide-react";

const VAT_RATE = 1.18;

const discountTypes = [
  { value: 'percent', label: 'אחוז הנחה' },
  { value: 'amount', label: 'סכום הנחה (₪)' },
  { value: 'final', label: 'מחיר סופי (₪)' },
];

export default function DiscountPopover({ item, onApplyDiscount }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('percent');
  const [inputValue, setInputValue] = useState('');

  // Price with VAT for calculation base
  const addonsTotal = (item.selected_addons || []).reduce((s, a) => s + (a.price || 0), 0);
  const basePrice = (item.unit_price + addonsTotal) * item.quantity;
  const priceWithVat = basePrice * VAT_RATE;

  useEffect(() => {
    if (open) {
      setType('percent');
      setInputValue(item.discount_percent > 0 ? String(item.discount_percent) : '');
    }
  }, [open]);

  const getDiscountPercent = () => {
    const val = parseFloat(inputValue) || 0;
    if (val <= 0) return 0;

    switch (type) {
      case 'percent':
        return Math.min(val, 100);
      case 'amount': {
        const maxAmount = priceWithVat;
        const clampedAmount = Math.min(val, maxAmount);
        return (clampedAmount / priceWithVat) * 100;
      }
      case 'final': {
        const clampedFinal = Math.max(0, Math.min(val, priceWithVat));
        const discountAmount = priceWithVat - clampedFinal;
        return (discountAmount / priceWithVat) * 100;
      }
      default:
        return 0;
    }
  };

  const getMaxValue = () => {
    switch (type) {
      case 'percent': return 100;
      case 'amount': return Math.round(priceWithVat * 100) / 100;
      case 'final': return Math.round(priceWithVat * 100) / 100;
      default: return 100;
    }
  };

  const handleApply = () => {
    const percent = Math.round(getDiscountPercent() * 100) / 100;
    onApplyDiscount(percent);
    setOpen(false);
  };

  const previewPercent = getDiscountPercent();
  const previewAmount = priceWithVat * (previewPercent / 100);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={item.discount_percent > 0 ? "default" : "outline"}
          size="sm"
          className={`w-20 h-9 text-xs ${item.discount_percent > 0 ? 'bg-red-500 hover:bg-red-600 text-white' : 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700'}`}
        >
          {item.discount_percent > 0 ? `${item.discount_percent}%` : (
            <><Percent className="w-3 h-3 me-1" />הנחה</>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="start" side="top">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">הנחה על פריט</p>
          <p className="text-xs text-muted-foreground">מחיר כולל מע״מ: ₪{priceWithVat.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>

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
                <span className="font-bold text-red-700">{previewPercent.toFixed(1)}% (₪{previewAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
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