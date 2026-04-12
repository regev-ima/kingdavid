import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export default function ProductSizeSelector({ 
  productId, 
  onSizeSelect, 
  onAddonsSelect,
  selectedSizeId,
  selectedAddonIds = []
}) {
  const [localSelectedSizeId, setLocalSelectedSizeId] = useState(selectedSizeId || '');
  const [localSelectedAddonIds, setLocalSelectedAddonIds] = useState(selectedAddonIds);

  // Fetch global sizes
  const { data: globalSizes = [] } = useQuery({
    queryKey: ['globalSizes'],
    queryFn: () => base44.entities.GlobalSize.filter({ is_active: true }),
  });

  // Fetch product-size price overrides
  const { data: productSizePrices = [] } = useQuery({
    queryKey: ['productSizePrices', productId],
    queryFn: () => base44.entities.ProductSizePrice.filter({ product_id: productId }),
    enabled: !!productId,
  });

  // Fetch product addons
  const { data: productAddons = [] } = useQuery({
    queryKey: ['productAddons'],
    queryFn: () => base44.entities.ProductAddon.filter({ is_active: true }),
  });

  // Fetch addon prices for this product and size (for overrides)
  const { data: addonPriceOverrides = [] } = useQuery({
    queryKey: ['productAddonPrices', productId, localSelectedSizeId],
    queryFn: () => base44.entities.ProductAddonPrice.filter({ 
      product_id: productId,
      global_size_id: localSelectedSizeId 
    }),
    enabled: !!productId && !!localSelectedSizeId,
  });

  useEffect(() => {
    if (selectedSizeId !== localSelectedSizeId) {
      setLocalSelectedSizeId(selectedSizeId || '');
    }
  }, [selectedSizeId]);

  useEffect(() => {
    if (JSON.stringify(selectedAddonIds) !== JSON.stringify(localSelectedAddonIds)) {
      setLocalSelectedAddonIds(selectedAddonIds);
    }
  }, [selectedAddonIds]);

  const handleSizeChange = (sizeId) => {
    setLocalSelectedSizeId(sizeId);
    const globalSize = globalSizes.find(s => s.id === sizeId);
    if (globalSize) {
      // Get price override for this product+size combination
      const priceOverride = productSizePrices.find(psp => 
        psp.product_id === productId && psp.global_size_id === sizeId
      );
      const finalPrice = priceOverride 
        ? (globalSize.price || 0) + priceOverride.price_delta 
        : (globalSize.price || 0);
      
      onSizeSelect({
        ...globalSize,
        price: finalPrice
      });
      // Reset addons when size changes
      setLocalSelectedAddonIds([]);
      onAddonsSelect([]);
    }
  };

  const handleAddonToggle = (addonId) => {
    const newSelectedAddonIds = localSelectedAddonIds.includes(addonId)
      ? localSelectedAddonIds.filter(id => id !== addonId)
      : [...localSelectedAddonIds, addonId];
    
    setLocalSelectedAddonIds(newSelectedAddonIds);

    const selectedAddons = newSelectedAddonIds.map(id => {
      const addon = productAddons.find(a => a.id === id);
      const priceOverride = addonPriceOverrides.find(p => p.product_addon_id === id);
      return {
        addon_id: id,
        name: addon?.name || '',
        price: priceOverride?.price || addon?.price || 0
      };
    });

    onAddonsSelect(selectedAddons);
  };

  const selectedSize = globalSizes.find(s => s.id === localSelectedSizeId);
  
  // Show all active product addons with their prices (using override if exists)
  const availableAddons = productAddons
    .map(addon => {
      const priceOverride = addonPriceOverrides.find(p => p.product_addon_id === addon.id);
      return {
        ...addon,
        price: priceOverride?.price || addon.price || 0
      };
    })
    .filter(a => a.is_active);

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted">
      <div className="space-y-2">
        <Label>בחר מידה *</Label>
        <Select value={localSelectedSizeId} onValueChange={handleSizeChange}>
            <SelectTrigger>
              <SelectValue placeholder="בחר מידה" />
            </SelectTrigger>
            <SelectContent>
              {globalSizes.map(size => (
                <SelectItem key={size.id} value={size.id}>
                  {size.label} {size.dimensions && `(${size.dimensions})`} - ₪{size.price?.toLocaleString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
      </div>

      {selectedSize && (
        <div className="p-3 bg-white rounded border">
          <p className="text-sm text-muted-foreground">מחיר מידה</p>
          <p className="text-2xl font-bold text-primary">₪{selectedSize.price?.toLocaleString()}</p>
        </div>
      )}

      {localSelectedSizeId && availableAddons.length > 0 && (
        <div className="space-y-2">
          <Label>תוספות זמינות</Label>
          <div className="space-y-2">
            {availableAddons.map(addon => (
              <div key={addon.id} className="flex items-center gap-3 p-2 bg-white rounded border">
                <Checkbox
                  checked={localSelectedAddonIds.includes(addon.id)}
                  onCheckedChange={() => handleAddonToggle(addon.id)}
                />
                <div className="flex-1">
                  <p className="font-medium">{addon.name}</p>
                  {addon.description && (
                    <p className="text-xs text-muted-foreground">{addon.description}</p>
                  )}
                </div>
                <span className="font-semibold text-primary">+₪{addon.price?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {localSelectedSizeId && availableAddons.length === 0 && (
         <p className="text-sm text-muted-foreground text-center py-2">
           אין תוספות מוגדרות
         </p>
       )}
    </div>
  );
}