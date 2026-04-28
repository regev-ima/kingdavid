import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import QuotePdfGenerator from '@/components/quotes/QuotePdfGenerator';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Save, Loader2, Plus, Trash2, Check, X } from "lucide-react";
import { hasBedType, productMatchesBedType } from '@/utils/bedType';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import UpsellPanel from '@/components/upsell/UpsellPanel';
import ProductSelector from '@/components/quote/ProductSelector';
import DiscountPopover from '@/components/quote/DiscountPopover';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canAccessSalesWorkspace, canViewQuote } from '@/lib/rbac';

export default function EditQuote() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [currentStep, setCurrentStep] = useState(1);
  const steps = [
    { id: 1, name: 'פרטי לקוח' },
    { id: 2, name: 'מוצרים' },
    { id: 3, name: 'תוספות להובלה ותנאים' }
  ];
  const urlParams = new URLSearchParams(window.location.search);
  const quoteId = urlParams.get('id');

  const [formData, setFormData] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    delivery_address: '',
    delivery_city: '',
    property_type: 'apartment',
    floor: 0,
    apartment_number: '',
    elevator_type: 'none',
    items: [],
    extras: [],
    subtotal: 0,
    discount_total: 0,
    vat_amount: 0,
    total: 0,
    valid_until: '',
    terms: '',
    warranty_terms: '',
    notes: '',
  });

  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  const { data: quote, isLoading: quoteLoading } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => base44.entities.Quote.filter({ id: quoteId }).then(res => res[0]),
    enabled: !!quoteId && canAccessSales,
  });

  const { data: lead = null } = useQuery({
    queryKey: ['lead-for-edit-quote', quote?.lead_id],
    queryFn: () => base44.entities.Lead.filter({ id: quote.lead_id }).then(res => res[0] || null),
    enabled: !!quote?.lead_id && canAccessSales,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const all = await base44.entities.Product.list('-created_date');
      return all.filter(p => p.is_active !== false);
    },
    enabled: canAccessSales,
  });

  const { data: variations = [] } = useQuery({
    queryKey: ['product-variations'],
    queryFn: () => base44.entities.ProductVariation.filter({ is_active: true }),
    enabled: canAccessSales,
  });

  const { data: extraCharges = [] } = useQuery({
    queryKey: ['extraCharges'],
    queryFn: () => base44.entities.ExtraCharge.filter({ is_active: true }),
    enabled: canAccessSales,
  });

  const { data: addons = [] } = useQuery({
    queryKey: ['product-addons'],
    queryFn: () => base44.entities.ProductAddon.filter({ is_active: true }),
    enabled: canAccessSales,
  });

  const { data: addonPrices = [] } = useQuery({
    queryKey: ['product-addon-prices'],
    queryFn: () => base44.entities.ProductAddonPrice.list(),
    enabled: canAccessSales,
  });

  useEffect(() => {
    if (quote && variations.length > 0) {
      // Enrich items with product_id from variations
      const enrichedItems = (quote.items || []).map(item => {
        if (!item.product_id && item.variation_id) {
          const variation = variations.find(v => v.id === item.variation_id);
          if (variation) {
            return { ...item, product_id: variation.product_id };
          }
        }
        return item;
      });

      setFormData({
        customer_name: quote.customer_name || '',
        customer_phone: quote.customer_phone || '',
        customer_email: quote.customer_email || '',
        delivery_address: quote.delivery_address || '',
        delivery_city: quote.delivery_city || '',
        property_type: quote.property_type || 'apartment',
        floor: quote.floor || 0,
        apartment_number: quote.apartment_number || '',
        elevator_type: quote.elevator_type || 'none',
        items: enrichedItems,
        extras: quote.extras || [],
        subtotal: quote.subtotal || 0,
        discount_total: quote.discount_total || 0,
        vat_amount: quote.vat_amount || 0,
        total: quote.total || 0,
        valid_until: quote.valid_until || '',
        terms: quote.terms || '',
        warranty_terms: quote.warranty_terms || '',
        notes: quote.notes || '',
      });
    }
  }, [quote, variations]);

  const updateQuoteMutation = useMutation({
    mutationFn: async (data) => {
      const updateData = {
        ...data,
        items: data.items.map(item => ({
          product_id: item.product_id || '',
          variation_id: item.variation_id || '',
          sku: item.sku || '',
          name: item.name || '',
          length_cm: item.length_cm || null,
          width_cm: item.width_cm || null,
          height_cm: item.height_cm || null,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          discount_percent: item.discount_percent || 0,
          total: item.total || 0,
          selected_addons: (item.selected_addons || []).map(addon => ({
            addon_id: addon.addon_id || '',
            name: addon.name || '',
            price: addon.price || 0
          }))
        }))
      };

      await base44.entities.Quote.update(quoteId, updateData);

      // Regenerate PDF
      try {
        const updatedQuote = await base44.entities.Quote.filter({ id: quoteId }).then(res => res[0]);
        const pdfUrl = await QuotePdfGenerator(updatedQuote);
        await base44.entities.Quote.update(quoteId, { pdf_url: pdfUrl });
      } catch (error) {
        console.error('Failed to generate PDF:', error);
      }

      return quoteId;
    },
    onSuccess: () => {
      navigate(createPageUrl('QuoteDetails') + `?id=${quoteId}`);
    },
  });

  const calculateTotals = (items, extras = []) => {
    const itemsSubtotal = items.reduce((sum, item) => {
      const addonsPrices = (item.selected_addons || []).reduce((addonSum, addon) => addonSum + (addon.price || 0), 0);
      const itemTotal = item.quantity * (item.unit_price + addonsPrices);
      const discount = itemTotal * (item.discount_percent / 100);
      return sum + (itemTotal - discount);
    }, 0);
    
    const discount_total = items.reduce((sum, item) => {
      const addonsPrices = (item.selected_addons || []).reduce((addonSum, addon) => addonSum + (addon.price || 0), 0);
      const itemTotal = item.quantity * (item.unit_price + addonsPrices);
      return sum + (itemTotal * (item.discount_percent / 100));
    }, 0);

    // Extras (תוספות) costs are stored VAT-inclusive, so they should not have
    // VAT recomputed on top of them. VAT is only applied to the items subtotal.
    const extrasTotal = extras.reduce((sum, extra) => sum + (extra.cost || 0), 0);

    const subtotal = itemsSubtotal + extrasTotal;
    const vat_amount = itemsSubtotal * 0.18;
    const total = subtotal + vat_amount;

    return { subtotal, discount_total, vat_amount, total };
  };

  const updateItem = (index, field, value) => {
    setFormData(prev => {
      const newItems = prev.items.map((item, idx) => {
        if (idx !== index) return item;
        
        const updatedItem = { ...item, [field]: value };
        const addonsPrices = (updatedItem.selected_addons || []).reduce((sum, addon) => sum + (addon.price || 0), 0);
        const itemTotal = updatedItem.quantity * (updatedItem.unit_price + addonsPrices);
        const discount = itemTotal * (updatedItem.discount_percent / 100);
        updatedItem.total = itemTotal - discount;
        
        return updatedItem;
      });
      
      const totals = calculateTotals(newItems, prev.extras);
      return { ...prev, items: newItems, ...totals };
    });
  };

  const addExtra = (extraChargeId) => {
    const extraCharge = extraCharges.find(ec => ec.id === extraChargeId);
    if (!extraCharge) return;
    
    setFormData(prev => {
      const newExtras = [...prev.extras, { 
        extra_charge_id: extraCharge.id,
        name: extraCharge.name, 
        cost: extraCharge.cost 
      }];
      const totals = calculateTotals(prev.items, newExtras);
      return { ...prev, extras: newExtras, ...totals };
    });
  };

  const removeExtra = (index) => {
    const newExtras = formData.extras.filter((_, i) => i !== index);
    const totals = calculateTotals(formData.items, newExtras);
    setFormData(prev => ({ ...prev, extras: newExtras, ...totals }));
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { sku: '', name: '', product_id: '', variation_id: '', quantity: 1, unit_price: 0, discount_percent: 0, total: 0, selected_addons: [] }]
    }));
  };

  const removeItem = (index) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const leadsById = buildLeadsById(lead ? [lead] : []);

  if (isLoadingUser || quoteLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canAccessSales) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לערוך הצעות מחיר</p>
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור להצעות המחיר</Button>
        </Link>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הצעת המחיר לא נמצאה</p>
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור להצעות המחיר</Button>
        </Link>
      </div>
    );
  }

  if (!canViewQuote(effectiveUser, quote, leadsById)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לערוך הצעת מחיר זו</p>
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור להצעות המחיר</Button>
        </Link>
      </div>
    );
  }

  const addUpsellItem = (item) => {
    const newItems = [...formData.items, item];
    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const selectProduct = (index, productId) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      const newItems = [...formData.items];
      newItems[index] = {
        ...newItems[index],
        product_id: productId,
        name: product.name,
        sku: '',
        variation_id: '',
        unit_price: 0,
        total: 0,
        selected_addons: []
      };
      const totals = calculateTotals(newItems, formData.extras);
      setFormData(prev => ({ ...prev, items: newItems, ...totals }));
    }
  };

  const handleVariationSelect = (index, variation) => {
    setFormData(prev => {
      const newItems = prev.items.map((item, idx) => {
        if (idx !== index) return item;
        
        const itemTotal = item.quantity * (variation.final_price || 0);
        const discount = itemTotal * (item.discount_percent / 100);
        
        return {
          ...item,
          variation_id: variation.id,
          sku: variation.sku,
          length_cm: variation.length_cm,
          width_cm: variation.width_cm,
          height_cm: variation.height_cm,
          unit_price: variation.final_price || 0,
          selected_addons: [],
          total: itemTotal - discount
        };
      });

      const totals = calculateTotals(newItems, prev.extras);
      return { ...prev, items: newItems, ...totals };
    });
  };

  const handleAddonsSelect = (index, addons) => {
    setFormData(prev => {
      const newItems = prev.items.map((item, idx) => {
        if (idx !== index) return item;
        
        const addonsTotal = addons.reduce((sum, addon) => sum + (addon.price || 0), 0);
        const itemTotal = item.quantity * (item.unit_price + addonsTotal);
        const discount = itemTotal * (item.discount_percent / 100);
        
        return {
          ...item,
          selected_addons: addons,
          total: itemTotal - discount
        };
      });
      
      const totals = calculateTotals(newItems, prev.extras);
      return { ...prev, items: newItems, ...totals };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    updateQuoteMutation.mutate(formData);
  };

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  if (isExpired || quote.status === 'expired') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-lg font-medium text-foreground">לא ניתן לערוך הצעה שפג תוקפה</p>
        <p className="text-muted-foreground">ניתן לשכפל את ההצעה עם תוקף חדש מתוך מסך פרטי ההצעה</p>
        <Link to={createPageUrl('QuoteDetails') + `?id=${quoteId}`}>
          <Button className="mt-4">חזור להצעה</Button>
        </Link>
      </div>
    );
  }

  const mattressCount = formData.items.reduce((count, item) => {
    const product = products.find(p => p.id === item.product_id);
    return count + (product?.category === 'mattress' ? (item.quantity || 0) : 0);
  }, 0);

  const hasBeds = formData.items.some(item => {
    const product = products.find(p => p.id === item.product_id);
    return hasBedType(product);
  });

  const filteredExtraCharges = extraCharges.filter(ec => {
    if (ec.name === 'שירותי מנוף') return false;
    if (ec.name.includes('מחויב במנוף') || ec.name.includes('כל מיטה החל מקומה')) return false;
    if (ec.name.includes('מיטות') && !hasBeds) return false;
    const multiMatch = ec.name.match(/הובלה ל[- ]?(\d+) מזרנים/);
    if (multiMatch) return mattressCount === parseInt(multiMatch[1]);
    if (ec.name === 'הובלה למזרן') return mattressCount <= 1;
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to={createPageUrl('QuoteDetails') + `?id=${quoteId}`}>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">עריכת הצעת מחיר #{quote.quote_number}</h1>
          <p className="text-sm text-muted-foreground">ערוך את פרטי ההצעה</p>
        </div>
      </div>

      <div className="mb-8 mt-6">
        <div className="flex items-center justify-center">
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className="flex flex-col items-center gap-2 group relative"
              >
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm sm:text-base font-bold transition-all duration-300 ${
                  currentStep > step.id
                    ? 'bg-emerald-500 text-white shadow-md'
                    : currentStep === step.id
                    ? 'gradient-brand text-white shadow-primary-glow ring-4 ring-indigo-100'
                    : 'bg-white border-2 border-border text-muted-foreground group-hover:border-primary/30'
                }`}>
                  {currentStep > step.id ? <Check className="w-5 h-5" /> : step.id}
                </div>
                <span className={`text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                  currentStep === step.id ? 'text-primary font-semibold' : currentStep > step.id ? 'text-emerald-600' : 'text-muted-foreground'
                }`}>{step.name}</span>
              </button>
              {idx < steps.length - 1 && (
                <div className="flex-1 mx-3 sm:mx-6 mt-[-24px] sm:mt-[-28px]">
                  <div className="h-0.5 w-full rounded-full bg-border relative overflow-hidden">
                    <div className={`absolute inset-y-0 right-0 rounded-full transition-all duration-500 ${currentStep > step.id ? 'bg-emerald-500 w-full' : 'bg-transparent w-0'}`} />
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); }}>
        {currentStep === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>פרטי לקוח</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>שם לקוח *</Label>
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>טלפון *</Label>
                <Input
                  value={formData.customer_phone}
                  onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>אימייל</Label>
                <Input
                  type="email"
                  value={formData.customer_email}
                  onChange={(e) => setFormData({...formData, customer_email: e.target.value})}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>כתובת למשלוח</Label>
                <AddressAutocomplete
                  value={formData.delivery_address}
                  onChange={(value, details) => {
                    setFormData((prev) => ({
                      ...prev,
                      delivery_address: value,
                      ...(details?.city ? { delivery_city: details.city } : {}),
                    }));
                  }}
                  placeholder="התחל להקליד..."
                />
              </div>
              <div className="space-y-2">
                <Label>עיר</Label>
                <Input
                  value={formData.delivery_city}
                  onChange={(e) => setFormData({...formData, delivery_city: e.target.value})}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>סוג נכס</Label>
                <Select value={formData.property_type} onValueChange={(v) => setFormData({...formData, property_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apartment">דירה</SelectItem>
                    <SelectItem value="house">בית פרטי</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>קומה</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.floor}
                  onChange={(e) => setFormData({...formData, floor: parseInt(e.target.value) || 0})}
                />
              </div>
              <div className="space-y-2">
                <Label>מספר דירה</Label>
                <Input
                  value={formData.apartment_number}
                  onChange={(e) => setFormData({...formData, apartment_number: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>מעלית</Label>
                <Select value={formData.elevator_type} onValueChange={(v) => setFormData({...formData, elevator_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">אין</SelectItem>
                    <SelectItem value="regular">מעלית רגילה</SelectItem>
                    <SelectItem value="freight">מעלית משא</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {currentStep === 2 && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>פריטים</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 me-2" />
              הוסף פריט
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {formData.items.map((item, index) => (
                <div key={index} className="rounded-xl overflow-hidden bg-white shadow-card border-2 border-border">
                  <TooltipProvider delayDuration={300}>
                  {/* Top: Product selector full width */}
                  <div className="px-3 pt-3 pb-2">
                    {item.name && !item.product_id ? (
                      <div className="px-3 py-2 border rounded-lg bg-muted/60 text-foreground font-semibold h-10 flex items-center text-sm">
                        {item.name}
                      </div>
                    ) : (
                      <ProductSelector
                        products={products}
                        variations={variations}
                        value={item.product_id}
                        selectedVariationId={item.variation_id}
                        onSelect={(val) => selectProduct(index, val)}
                        onVariationSelect={(variation) => handleVariationSelect(index, variation)}
                        placeholder="בחר מוצר ומידות"
                      />
                    )}
                  </div>

                  {/* Bottom: compact details bar */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30 border-t border-border/30">
                    {/* SKU */}
                    <div className="text-[11px] text-muted-foreground font-mono min-w-0 truncate" dir="ltr" title={item.sku}>
                      {item.sku || '-'}
                    </div>
                    <div className="h-4 w-px bg-border/50" />
                    {/* Quantity */}
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">×</span>
                      <div className="flex items-center border rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => updateItem(index, 'quantity', Math.max(1, (item.quantity || 1) - 1))}
                          className="h-7 w-7 flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors"
                        >
                          −
                        </button>
                        <span className="h-7 w-8 flex items-center justify-center text-xs font-medium border-x">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateItem(index, 'quantity', (item.quantity || 1) + 1)}
                          className="h-7 w-7 flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="h-4 w-px bg-border/50" />
                    {/* Price before VAT */}
                    <div className="flex items-center gap-0.5">
                      <span className="text-[10px] text-muted-foreground/60">לפני מע״מ</span>
                      <span className="text-xs text-muted-foreground font-medium">₪{item.unit_price?.toLocaleString()}</span>
                    </div>
                    <div className="h-4 w-px bg-border/50" />
                    {/* Discount */}
                    <DiscountPopover
                      item={item}
                      onApplyDiscount={(percent) => updateItem(index, 'discount_percent', percent)}
                    />
                    {item.discount_percent > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => updateItem(index, 'discount_percent', 0)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>הסר הנחה</TooltipContent>
                      </Tooltip>
                    )}
                    {/* Spacer */}
                    <div className="flex-1" />
                    {/* Total with VAT */}
                    {item.discount_percent > 0 ? (
                      <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-2.5 py-1 border border-emerald-200/50">
                        <span className="text-[10px] text-red-400 line-through">₪{Math.round((item.unit_price * item.quantity || 0) * 1.18).toLocaleString()}</span>
                        <span className="font-bold text-sm text-emerald-700">₪{Math.round((item.total || 0) * 1.18).toLocaleString()}</span>
                        <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-100 rounded px-1">-{item.discount_percent}%</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 bg-primary/5 rounded-lg px-2 py-1">
                        <span className="text-[10px] text-primary/70 font-medium">כולל מע״מ</span>
                        <span className="font-bold text-sm text-primary">₪{Math.round((item.total || 0) * 1.18).toLocaleString()}</span>
                      </div>
                    )}
                    {/* Delete */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="text-muted-foreground/30 hover:text-red-500 transition-colors p-0.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>מחק שורה</TooltipContent>
                    </Tooltip>
                  </div>
                  </TooltipProvider>

                  {/* Addons */}
                  {item.variation_id && (() => {
                    const variation = variations.find(v => v.id === item.variation_id);
                    const product = products.find(p => p.id === item.product_id);
                    const applicableAddons = addons.filter(addon => {
                      const matchesCategory = !addon.applicable_categories?.length || addon.applicable_categories.includes(product?.category);
                      if (!matchesCategory) return false;
                      // bed_type is an array — exclude add-ons whose applies_to bed-type isn't supported by this product.
                      if (addon.applies_to === 'double' && !productMatchesBedType(product, 'double')) return false;
                      if (addon.applies_to === 'single' && !productMatchesBedType(product, 'single')) return false;
                      return true;
                    });
                    if (applicableAddons.length === 0) return null;
                    return (
                      <div className="px-3 pb-3 border-t border-border/40 pt-3 space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">תוספות למוצר</Label>
                        <div className="flex flex-wrap gap-2">
                          {applicableAddons.map(addon => {
                            const sizePrice = addon.size_prices?.find(
                              sp => sp.width_cm === variation?.width_cm && sp.length_cm === variation?.length_cm
                            );
                            const specificPrice = addonPrices.find(
                              ap => ap.addon_id === addon.id && ap.product_id === item.product_id && ap.product_variation_id === item.variation_id
                            );
                            const productPrice = addonPrices.find(
                              ap => ap.addon_id === addon.id && ap.product_id === item.product_id && !ap.product_variation_id
                            );
                            const finalAddonPrice = specificPrice?.price || productPrice?.price || sizePrice?.price || addon.base_price;
                            return (
                              <Button
                                key={addon.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const newItem = {
                                    product_id: '',
                                    variation_id: '',
                                    sku: '',
                                    name: addon.name,
                                    quantity: 1,
                                    unit_price: finalAddonPrice,
                                    discount_percent: 0,
                                    total: finalAddonPrice,
                                    selected_addons: []
                                  };
                                  setFormData(prev => {
                                    const newItems = [...prev.items];
                                    newItems.splice(index + 1, 0, newItem);
                                    const totals = calculateTotals(newItems, prev.extras);
                                    return { ...prev, items: newItems, ...totals };
                                  });
                                }}
                                className="text-xs h-8 bg-primary/5 border-primary/20 hover:bg-primary/10 hover:border-primary/30 text-primary"
                              >
                                <Plus className="w-3 h-3 me-1" />
                                הוסף {addon.name} (₪{finalAddonPrice?.toLocaleString()})
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-6 border border-border rounded-xl overflow-hidden">
              <div className="p-4 space-y-3 bg-muted/40">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">סכום לפני מע״מ</span>
                  <span className="font-medium">₪{Math.round(formData.subtotal).toLocaleString()}</span>
                </div>
                {formData.discount_total > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>הנחה כולל מע״מ</span>
                    <span className="font-medium">-₪{Math.round(formData.discount_total * 1.18).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">מע״מ (18%)</span>
                  <span className="font-medium">₪{Math.round(formData.vat_amount).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex justify-between items-center px-4 py-3.5 bg-primary/5 border-t border-primary/10">
                <span className="text-base font-bold text-foreground">סה״כ לתשלום</span>
                <span className="text-xl font-bold text-primary">₪{Math.round(formData.total).toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {formData.items.some(item => item.sku) && (
          <div>
            <UpsellPanel 
              quote={formData} 
              onAddItem={addUpsellItem}
            />
          </div>
        )}
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>תוספות להובלה</CardTitle>
                <p className="text-sm text-muted-foreground">בחר תוספות עבור ההובלה וההרכבה</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {filteredExtraCharges.map(ec => {
                    const isSelected = formData.extras.some(ex => ex.extra_charge_id === ec.id);
                    return (
                      <button
                        key={ec.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            const idx = formData.extras.findIndex(ex => ex.extra_charge_id === ec.id);
                            if (idx >= 0) removeExtra(idx);
                          } else {
                            addExtra(ec.id);
                          }
                        }}
                        className={`relative p-4 border rounded-xl text-center transition-all duration-200 ${isSelected ? 'border-primary/40 bg-primary/[0.04] shadow-[0_0_0_1px_rgba(79,70,229,0.15)]' : 'border-border bg-white hover:border-primary/20 hover:bg-muted/30'}`}
                      >
                        {isSelected && (
                          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        <div className="font-medium text-sm text-foreground">{ec.name}</div>
                        <div className={`text-lg font-bold mt-1.5 ${isSelected ? 'text-primary' : 'text-foreground'}`}>₪{ec.cost.toLocaleString()}</div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

        <Card>
          <CardHeader>
            <CardTitle>תנאים ואחריות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">תוקף ההצעה</Label>
                <Input
                  type="date"
                  value={formData.valid_until}
                  onChange={(e) => setFormData({...formData, valid_until: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">תנאי תשלום ואספקה</Label>
              <Textarea
                value={formData.terms}
                onChange={(e) => setFormData({...formData, terms: e.target.value})}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">תנאי אחריות</Label>
              <Textarea
                value={formData.warranty_terms}
                onChange={(e) => setFormData({...formData, warranty_terms: e.target.value})}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">הערות</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                rows={3}
                className="resize-none"
              />
              </div>
            </CardContent>
          </Card>
          </div>
        )}

        <div className="sticky bottom-0 z-10 mt-8 -mx-4 px-4 sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between py-4 px-5 bg-white/90 glass border-t border-border/60 rounded-t-xl shadow-[0_-4px_16px_rgb(0_0_0/0.06)]">
            <div className="flex gap-2">
              {currentStep > 1 && (
                <Button type="button" variant="outline" size="default" className="h-10 px-5" onClick={() => setCurrentStep(currentStep - 1)}>
                  <ArrowRight className="h-4 w-4 me-1.5" />
                  חזור
                </Button>
              )}
              <Link to={createPageUrl('QuoteDetails') + `?id=${quoteId}`}>
                <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-muted-foreground">ביטול</Button>
              </Link>
            </div>

            <div>
              {currentStep < 3 ? (
                <Button
                  type="button"
                  size="lg"
                  className="h-11 px-8 text-base font-semibold shadow-md hover:shadow-lg transition-shadow"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCurrentStep(prev => Math.min(prev + 1, 3)); }}
                >
                  המשך
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 px-8 text-base font-semibold shadow-md hover:shadow-lg transition-shadow"
                  disabled={updateQuoteMutation.isPending}
                >
                  {updateQuoteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 me-2" />
                  )}
                  שמור שינויים
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
