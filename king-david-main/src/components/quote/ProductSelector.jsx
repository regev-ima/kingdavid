import React, { useState, useMemo } from 'react';
import { Check, Search, Bed, Armchair, Layers, Package, X, ChevronLeft, Ruler, Clock, AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const categoryConfig = {
  bed: { label: 'מיטות', icon: Bed, bgColor: 'bg-purple-100', iconColor: 'text-purple-600' },
  mattress: { label: 'מזרנים', icon: Layers, bgColor: 'bg-blue-100', iconColor: 'text-blue-600' },
  // topper category hidden from product selector
  accessory: { label: 'מוצרים נלווים', icon: Package, bgColor: 'bg-amber-100', iconColor: 'text-amber-600' }
};

const bedTypeConfig = {
  single: { label: 'יחיד' },
  double: { label: 'זוגי' }
};

const getProductValue = (product, key, fallback = '') => {
  const value = product?.[key] ?? product?.data?.[key];
  return value ?? fallback;
};

const hasManagerNotes = (product) => String(getProductValue(product, 'manager_notes', '')).trim().length > 0;
const hasTrialPeriod = (product) => Boolean(getProductValue(product, 'has_trial_period', false));

export default function ProductSelector({
  products = [],
  variations = [],
  value,
  selectedVariationId,
  onSelect,
  onVariationSelect,
  placeholder = "בחר מוצר"
}) {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedBedType, setSelectedBedType] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [customWidthInput, setCustomWidthInput] = useState({});
  const [pendingVariation, setPendingVariation] = useState(null);

  const selectedProduct = products.find(p => p.id === value);
  const selectedVariation = variations.find(v => v.id === selectedVariationId);

  const handleOpenChange = (isOpen) => {
    setOpen(isOpen);
    if (!isOpen) {
      setSelectedCategory(null);
      setSelectedBedType(null);
      setSelectedProductId(null);
      setSearchQuery('');
      setPendingVariation(null);
      setCustomWidthInput({});
    }
  };

  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (selectedCategory) {
      filtered = filtered.filter(p => getProductValue(p, 'category') === selectedCategory);
    }
    if (selectedBedType && (selectedCategory === 'bed' || selectedCategory === 'mattress')) {
      filtered = filtered.filter(p => getProductValue(p, 'bed_type') === selectedBedType);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        String(getProductValue(p, 'name')).toLowerCase().includes(query) ||
        String(getProductValue(p, 'description')).toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [products, selectedCategory, selectedBedType, searchQuery]);

  const handleProductSelect = (productId, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    setSelectedProductId(productId);
    onSelect(productId);
  };

  const handleVariationSelect = (variation, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    setPendingVariation(variation);
  };

  const handleConfirmVariation = () => {
    if (pendingVariation) {
      onVariationSelect(pendingVariation);
      setTimeout(() => { handleOpenChange(false); }, 50);
    }
  };

  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
    setSelectedBedType(null);
    setSearchQuery('');
  };

  const needsBedTypeSelection = selectedCategory === 'bed' || selectedCategory === 'mattress';

  const availableVariations = useMemo(() => {
    if (!selectedProductId) return [];
    return variations.filter(v => v.product_id === selectedProductId);
  }, [variations, selectedProductId]);

  // Current step for breadcrumb
  const currentStep = selectedProductId ? 3 : (selectedCategory && (!needsBedTypeSelection || selectedBedType)) ? 2 : 1;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full justify-between h-auto min-h-[40px] py-2"
      >
        {selectedProduct ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{getProductValue(selectedProduct, 'name')}</span>
            {getProductValue(selectedProduct, 'bed_type') && (
              <Badge variant="outline" className="text-[11px] font-medium">
                {bedTypeConfig[getProductValue(selectedProduct, 'bed_type')]?.label}
              </Badge>
            )}
            {selectedVariation && (
              <span className="text-xs text-muted-foreground">
                {selectedVariation.width_cm}×{selectedVariation.length_cm} ס"מ
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0" dir="rtl">
          {/* Header */}
          <div className="px-5 pt-4 pb-3 border-b border-border/50 bg-muted/30">
            <DialogHeader className="mb-0">
              <DialogTitle className="text-base font-bold">בחר מוצר</DialogTitle>
            </DialogHeader>

            {/* Breadcrumb navigation */}
            <div className="flex items-center gap-1.5 mt-2 text-xs">
              <button
                type="button"
                onClick={() => { setSelectedCategory(null); setSelectedBedType(null); setSelectedProductId(null); setSearchQuery(''); setPendingVariation(null); }}
                className={cn("transition-colors", currentStep === 1 ? "text-foreground font-semibold" : "text-primary hover:text-primary/80 cursor-pointer underline")}
              >
                קטגוריה
              </button>
              {selectedCategory && (
                <>
                  <ChevronLeft className="h-3 w-3 text-muted-foreground/40" />
                  <button
                    type="button"
                    onClick={() => { setSelectedProductId(null); setPendingVariation(null); }}
                    className={cn("transition-colors", currentStep === 2 ? "text-foreground font-semibold" : currentStep > 2 ? "text-primary hover:text-primary/80 cursor-pointer underline" : "text-muted-foreground")}
                  >
                    {categoryConfig[selectedCategory]?.label}
                  </button>
                </>
              )}
              {selectedProductId && (
                <>
                  <ChevronLeft className="h-3 w-3 text-muted-foreground/40" />
                  <span className="text-foreground font-semibold">בחירת מידה</span>
                </>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-5">

              {/* Step 1: Category Selection */}
              {!selectedCategory && (
                <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
                  {Object.entries(categoryConfig).map(([key, config]) => {
                    const Icon = config.icon;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleCategorySelect(key)}
                        className={cn(
                          "flex flex-col items-center gap-3 py-6 px-3 rounded-2xl border-2 transition-all duration-200",
                          "hover:shadow-lg hover:-translate-y-1 active:translate-y-0",
                          "border-border bg-white hover:border-primary/30 hover:bg-primary/[0.02]"
                        )}
                      >
                        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", config.bgColor)}>
                          <Icon className={cn("h-6 w-6", config.iconColor)} />
                        </div>
                        <span className="text-sm font-semibold text-foreground">{config.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Step 1b: Bed Type Selection (conditional) */}
              {selectedCategory && needsBedTypeSelection && !selectedBedType && (
                <div className="space-y-3 max-w-sm mx-auto">
                  <Label className="text-sm font-semibold text-foreground text-center block">בחר סוג</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(bedTypeConfig).map(([key, config]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedBedType(key)}
                        className="py-5 rounded-2xl border-2 border-border bg-white hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 font-bold text-lg text-foreground"
                      >
                        {config.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Search and Product List */}
              {selectedCategory && (!needsBedTypeSelection || selectedBedType) && !selectedProductId && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground/60" />
                    <Input
                      placeholder="חפש מוצר..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-9 h-10"
                      autoFocus
                    />
                  </div>

                  <div className="rounded-xl border border-border max-h-[380px] overflow-y-auto">
                    {filteredProducts.length === 0 ? (
                      <div className="p-10 text-center">
                        <Package className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                        <p className="text-sm text-muted-foreground">לא נמצאו מוצרים</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {filteredProducts.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={(e) => handleProductSelect(product.id, e)}
                            className="w-full flex items-center justify-between px-4 py-3 transition-colors text-right hover:bg-muted/40 group"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">{getProductValue(product, 'name')}</div>
                              {getProductValue(product, 'description') && (
                                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{getProductValue(product, 'description')}</div>
                              )}
                              {(getProductValue(product, 'has_trial_period', false) || getProductValue(product, 'manager_notes', '')) && (
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  {getProductValue(product, 'has_trial_period', false) && (
                                    <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 text-[9px] font-semibold px-1.5 py-0.5 rounded">
                                      <Clock className="h-2.5 w-2.5" /> 30 ימי נסיון
                                    </span>
                                  )}
                                  {getProductValue(product, 'manager_notes', '') && (
                                    <span className="inline-flex items-center gap-0.5 bg-orange-100 text-orange-700 text-[9px] font-semibold px-1.5 py-0.5 rounded" title={getProductValue(product, 'manager_notes', '')}>
                                      <AlertTriangle className="h-2.5 w-2.5" /> הערת מנהל
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mr-3 flex-shrink-0">
                              {getProductValue(product, 'bed_type') && (
                                <Badge variant="outline" className={cn(
                                  "text-[10px] font-medium",
                                  getProductValue(product, 'bed_type') === 'double' ? "border-blue-200 text-blue-700 bg-blue-50" : "border-amber-200 text-amber-700 bg-amber-50"
                                )}>
                                  {getProductValue(product, 'bed_type') === 'double' ? 'זוגי' : 'יחיד'}
                                </Badge>
                              )}
                              <ChevronLeft className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Variation Selection */}
              {selectedProductId && availableVariations.length > 0 && (() => {
                const sorted = [...availableVariations].sort((a, b) => (a.width_cm || 0) - (b.width_cm || 0));
                const lengths = [...new Set(sorted.map(v => v.length_cm))].sort((a, b) => b - a);

                const renderVariationButton = (variation) => {
                  const isSelected = pendingVariation?.id === variation.id && !pendingVariation?._customWidth;
                  const priceWithVat = Math.round((variation.final_price || 0) * 1.18);
                  const priceWithoutVat = Math.round(variation.final_price || 0);
                  return (
                    <button
                      key={variation.id}
                      type="button"
                      onClick={(e) => handleVariationSelect(variation, e)}
                      className={cn(
                        "relative p-3.5 rounded-2xl border-2 transition-all duration-200 text-center group",
                        "hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0",
                        isSelected
                          ? "border-primary bg-primary/[0.05] shadow-[0_0_0_1px_hsl(var(--primary)/0.2)] ring-2 ring-primary/10"
                          : "border-border/80 bg-white hover:border-primary/40"
                      )}
                    >
                      {isSelected && (
                        <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-sm">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                      <div className="text-base font-extrabold text-foreground tracking-tight">
                        {variation.width_cm}×{variation.length_cm}
                      </div>
                      <div className="mt-2 text-lg font-bold text-primary leading-none">
                        ₪{priceWithVat.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                        לפני מע״מ ₪{priceWithoutVat.toLocaleString()}
                      </div>
                    </button>
                  );
                };

                const renderCustomWidthCard = (length, pricingVariation) => {
                  const cwKey = String(length);
                  const cwValue = customWidthInput[cwKey] || '';
                  // Find the first variation whose width is >= entered width (next up pricing)
                  const group = sorted.filter(v => v.length_cm === length).sort((a, b) => a.width_cm - b.width_cm);
                  const enteredWidth = parseInt(cwValue) || 0;
                  const pricedAt = enteredWidth > 0
                    ? group.find(v => (v.width_cm || 0) >= enteredWidth) || group[group.length - 1]
                    : pricingVariation;

                  const customPriceWithVat = Math.round((pricedAt.final_price || 0) * 1.18);
                  const customPriceWithoutVat = Math.round(pricedAt.final_price || 0);

                  return (
                    <div
                      key={`custom-${length}`}
                      className="relative p-3.5 rounded-2xl border-2 border-dashed border-amber-300 bg-gradient-to-b from-amber-50/50 to-white text-center space-y-2"
                    >
                      <div className="text-sm font-bold text-foreground">מידה מיוחדת</div>
                      <div className="flex items-center gap-1.5 justify-center">
                        <Input
                          type="number"
                          min="50"
                          max="220"
                          placeholder="רוחב"
                          value={cwValue}
                          onChange={(e) => setCustomWidthInput({ ...customWidthInput, [cwKey]: e.target.value })}
                          className="h-9 w-20 text-center text-sm font-semibold border-amber-200 focus:border-amber-400"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-xs text-muted-foreground font-medium">×{length}</span>
                      </div>
                      {enteredWidth > 0 && enteredWidth <= 220 && (
                        <>
                          <div className="text-lg font-bold text-primary leading-none">
                            ₪{customPriceWithVat.toLocaleString()}
                          </div>
                          <div className="text-[10px] text-muted-foreground/60">
                            לפני מע״מ ₪{customPriceWithoutVat.toLocaleString()} · לפי {pricedAt.width_cm} ס"מ
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            className="w-full h-8 text-xs font-semibold"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVariationSelect({
                                ...pricedAt,
                                width_cm: enteredWidth,
                                _customWidth: enteredWidth,
                                _originalVariation: pricedAt,
                              }, e);
                            }}
                          >
                            בחר מידה זו
                          </Button>
                        </>
                      )}
                      {enteredWidth > 220 && (
                        <div className="text-xs text-red-500 font-medium">מקסימום 220 ס"מ</div>
                      )}
                    </div>
                  );
                };

                const selectedProd = products.find(p => p.id === selectedProductId);

                return (
                  <div className="space-y-4">
                    {selectedProd && (() => {
                      const trialPeriod = getProductValue(selectedProd, 'has_trial_period', false);
                      const managerNotes = getProductValue(selectedProd, 'manager_notes', '');
                      return (
                      <div className="space-y-2">
                        <h3 className="text-lg font-bold text-foreground">{getProductValue(selectedProd, 'name')}</h3>
                        {(trialPeriod || managerNotes) && (
                          <div className="flex flex-wrap gap-2">
                            {trialPeriod && (
                              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium px-3 py-1.5 rounded-lg">
                                <Clock className="h-3.5 w-3.5" />
                                <span>למוצר זה 30 ימי נסיון</span>
                              </div>
                            )}
                            {managerNotes && (
                              <div className="flex items-start gap-1.5 bg-orange-50 border border-orange-200 text-orange-800 text-xs font-medium px-3 py-1.5 rounded-lg">
                                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                <span>{managerNotes}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      ); })()}
                    <div className="flex items-center gap-2">
                      <Ruler className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-sm font-semibold text-foreground">בחר מידות</Label>
                      <span className="text-xs text-muted-foreground">({availableVariations.length} אפשרויות)</span>
                    </div>
                    {lengths.map((length) => {
                      const group = sorted.filter(v => v.length_cm === length);
                      const maxWidthVariation = group[group.length - 1];
                      return (
                        <div key={length} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="h-px flex-1 bg-border/60" />
                            <span className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest">אורך {length} ס"מ</span>
                            <div className="h-px flex-1 bg-border/60" />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {group.map((v) => renderVariationButton(v))}
                            {renderCustomWidthCard(length, maxWidthVariation)}
                          </div>
                        </div>
                      );
                    })}

                  </div>
                );
              })()}
            </div>
          </div>

          {/* Sticky confirm footer */}
          {pendingVariation && (() => {
            const footerWithVat = Math.round((pendingVariation.final_price || 0) * 1.18);
            const footerWithout = Math.round(pendingVariation.final_price || 0);
            return (
              <div className="px-5 py-3.5 border-t-2 border-primary/20 bg-gradient-to-l from-primary/[0.06] to-primary/[0.02]">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-extrabold text-foreground text-lg">
                        {pendingVariation._customWidth
                          ? `${pendingVariation._customWidth}×${pendingVariation.length_cm}`
                          : `${pendingVariation.width_cm}×${pendingVariation.length_cm}`
                        }
                      </span>
                      <span className="font-bold text-primary text-xl">₪{footerWithVat.toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground/60">לפני מע״מ ₪{footerWithout.toLocaleString()}</div>
                  </div>
                  <Button size="lg" className="h-11 px-8 text-sm font-bold shadow-md rounded-xl" onClick={handleConfirmVariation}>
                    הוסף פריט
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}