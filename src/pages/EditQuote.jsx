import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QuotePdfGenerator from '@/components/quotes/QuotePdfGenerator';
import { PAYMENT_TERMS_OPTIONS } from '@/constants/paymentTerms';
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


import { ArrowRight, Save, Loader2, Check } from "lucide-react";
import { hasBedType } from '@/utils/bedType';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import UpsellPanel from '@/components/upsell/UpsellPanel';
import ProductItemsEditor from '@/components/quote/ProductItemsEditor';
import QuoteTotalsSummary from '@/components/quote/QuoteTotalsSummary';
import { genBedConfigToken, legacyFabricToFields } from '@/lib/bedConfig';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canAccessSalesWorkspace, canViewQuote } from '@/lib/rbac';
import IsraeliPhoneInput from '@/components/shared/IsraeliPhoneInput';
import { isValidIsraeliPhone } from '@/utils/phoneUtils';
import { toast } from 'sonner';

// ₪ with two decimals (agorot) so totals match the per-line amounts.
const money2 = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EditQuote({ id: idProp, isModal = false, onExit, onSaved }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [currentStep, setCurrentStep] = useState(1);
  const steps = [
    { id: 1, name: 'פרטי לקוח' },
    { id: 2, name: 'מוצרים' },
    { id: 3, name: 'תוספות להובלה ותנאים' }
  ];
  const urlParams = new URLSearchParams(window.location.search);
  // In modal mode the id arrives as a prop and the URL is left untouched.
  const quoteId = idProp ?? urlParams.get('id');

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
    notes: '',
    special_requests: '',
    payment_terms_selection: [],
  });
  // Index of the bed line whose configurator wizard is open (null = closed), and
  // a snapshot of its prior config lines for prefill after a resize strips them.
  const [bedWizardIndex, setBedWizardIndex] = useState(null);
  const [bedWizardSnapshot, setBedWizardSnapshot] = useState(null);

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
        let it = item;
        if (!it.product_id && it.variation_id) {
          const variation = variations.find(v => v.id === it.variation_id);
          if (variation) it = { ...it, product_id: variation.product_id };
        }
        // Migrate legacy fabric_* (quotes saved before text-questions) into the
        // unified bed_config_fields so it's editable in the wizard and renders
        // through one path — clear the old columns to avoid a duplicate line.
        if (!it.bed_config_fields?.length) {
          const fabric = legacyFabricToFields(it);
          if (fabric) {
            it = { ...it, bed_config_fields: [fabric], fabric_catalog_name: '', fabric_color_number: '', fabric_color: '', fabric_supplier: '', fabric_supplier_other: '' };
          }
        }
        return it;
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
        notes: quote.notes || '',
        special_requests: quote.special_requests || '',
        payment_terms_selection: Array.isArray(quote.payment_terms_selection) ? quote.payment_terms_selection : [],
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
          })),
          fabric_catalog_name: item.fabric_catalog_name || '',
          fabric_color_number: item.fabric_color_number || '',
          fabric_color: item.fabric_color || '',
          fabric_supplier: item.fabric_supplier || '',
          fabric_supplier_other: item.fabric_supplier_other || '',
          bed_config_token: item.bed_config_token || null,
          bed_config_owner: item.bed_config_owner || null,
          bed_config_group_key: item.bed_config_group_key || null,
          bed_config_value_key: item.bed_config_value_key || null,
          // Text-question answers (e.g. fabric catalog) collected in the wizard.
          bed_config_fields: item.bed_config_fields || null
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
      toast.success('ההצעה עודכנה');
      // Refresh the detail view (same query key) so the popup shows the update.
      queryClient.invalidateQueries({ queryKey: ['quote', quoteId] });
      if (isModal) { onSaved?.(quoteId); return; }
      navigate(createPageUrl('QuoteDetails') + `?id=${quoteId}`);
    },
    onError: (err) => {
      toast.error(`שמירת ההצעה נכשלה: ${err?.message || 'שגיאה לא צפויה'}`);
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

    // Round to agorot (2 decimals) so the total matches the sum of line totals.
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const subtotal = round2(itemsSubtotal + extrasTotal);
    const vat_amount = round2(itemsSubtotal * 0.18);
    const total = round2(subtotal + vat_amount);

    return { subtotal, discount_total: round2(discount_total), vat_amount, total };
  };

  // ProductItemsEditor hands back a fresh items array; recompute grand totals.
  const handleItemsChange = (newItems) => {
    setFormData(prev => ({ ...prev, items: newItems, ...calculateTotals(newItems, prev.extras) }));
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
      items: [...prev.items, { sku: '', name: '', product_id: '', variation_id: '', quantity: 1, unit_price: 0, discount_percent: 0, total: 0, selected_addons: [], fabric_catalog_name: '', fabric_color_number: '', fabric_color: '', fabric_supplier: '', fabric_supplier_other: '' }]
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
        {isModal ? (
          <Button className="mt-4" onClick={() => onExit?.()}>חזור</Button>
        ) : (
          <Link to={createPageUrl('Quotes')}>
            <Button className="mt-4">חזור להצעות המחיר</Button>
          </Link>
        )}
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הצעת המחיר לא נמצאה</p>
        {isModal ? (
          <Button className="mt-4" onClick={() => onExit?.()}>חזור</Button>
        ) : (
          <Link to={createPageUrl('Quotes')}>
            <Button className="mt-4">חזור להצעות המחיר</Button>
          </Link>
        )}
      </div>
    );
  }

  if (!canViewQuote(effectiveUser, quote, leadsById)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לערוך הצעת מחיר זו</p>
        {isModal ? (
          <Button className="mt-4" onClick={() => onExit?.()}>חזור</Button>
        ) : (
          <Link to={createPageUrl('Quotes')}>
            <Button className="mt-4">חזור להצעות המחיר</Button>
          </Link>
        )}
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

  // Open the configurator wizard for an already-set bed line (the "edit" button):
  // ensure a token, use the bed's current config lines for prefill.
  const openBedWizard = (index) => {
    setFormData(prev => {
      const items = prev.items.map((it, i) => {
        if (i !== index || it.bed_config_token) return it;
        return { ...it, bed_config_token: genBedConfigToken() };
      });
      return { ...prev, items };
    });
    setBedWizardSnapshot(null);
    setBedWizardIndex(index);
  };

  const handleVariationSelect = (index, variation) => {
    const bedItem = formData.items[index];
    const targetProduct = products.find(p => p.id === bedItem?.product_id);
    const isBed = targetProduct?.category === 'bed';
    const token = isBed ? (bedItem?.bed_config_token || genBedConfigToken()) : undefined;
    // Snapshot prior choices (for prefill) before we strip the now-stale lines.
    const snapshot = token ? formData.items.filter(l => l.bed_config_owner === token) : [];
    setFormData(prev => {
      let newItems = prev.items.map((item, idx) => {
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
          ...(token ? { bed_config_token: token } : {}),
          total: itemTotal - discount
        };
      });
      // Drop this bed's now-stale config lines (old-size prices); the auto-opened
      // wizard re-adds them at the new size on confirm. If the rep dismisses the
      // wizard, the bed is simply left unconfigured — never with stale prices.
      if (token) newItems = newItems.filter(l => l.bed_config_owner !== token);
      const totals = calculateTotals(newItems, prev.extras);
      return { ...prev, items: newItems, ...totals };
    });
    // For beds, jump straight into the configurator right after the size step.
    if (isBed) {
      setBedWizardSnapshot(snapshot);
      setBedWizardIndex(index);
    }
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

  // Editing saves directly — no summary/confirm step. "שמור שינויים" וזהו.
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValidIsraeliPhone(formData.customer_phone)) {
      toast.error('מספר טלפון לא תקין. פורמט ישראלי: 05X-XXXXXXX או 0X-XXXXXXX');
      return;
    }
    updateQuoteMutation.mutate(formData);
  };

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  if (isExpired || quote.status === 'expired') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-lg font-medium text-foreground">לא ניתן לערוך הצעה שפג תוקפה</p>
        <p className="text-muted-foreground">ניתן לשכפל את ההצעה עם תוקף חדש מתוך מסך פרטי ההצעה</p>
        {isModal ? (
          <Button className="mt-4" onClick={() => onExit?.()}>חזור להצעה</Button>
        ) : (
          <Link to={createPageUrl('QuoteDetails') + `?id=${quoteId}`}>
            <Button className="mt-4">חזור להצעה</Button>
          </Link>
        )}
      </div>
    );
  }

  const mattressCount = formData.items.reduce((count, item) => {
    const product = products.find(p => p.id === item.product_id);
    return count + (product?.category === 'mattress' ? (item.quantity || 0) : 0);
  }, 0);

  // Sum quantity of bed-type line items so we can hide delivery options that
  // don't match the exact bed count on the quote. See NewQuote.jsx for the
  // shape of the rules — kept in sync intentionally.
  const bedCount = formData.items.reduce((count, item) => {
    const product = products.find(p => p.id === item.product_id);
    return count + (hasBedType(product) ? (item.quantity || 0) : 0);
  }, 0);

  const filteredExtraCharges = extraCharges.filter(ec => {
    if (ec.name === 'שירותי מנוף') return false;
    if (ec.name.includes('מחויב במנוף') || ec.name.includes('כל מיטה החל מקומה')) return false;

    const multiBedMatch = ec.name.match(/ל[- ]?(\d+) מיטות/);
    if (multiBedMatch) return bedCount === parseInt(multiBedMatch[1], 10);
    if (ec.name.includes('מיטות')) return bedCount >= 2;
    if (ec.name.includes('מיטה')) return bedCount === 1;

    const multiMattressMatch = ec.name.match(/הובלה ל[- ]?(\d+) מזרנים/);
    if (multiMattressMatch) return mattressCount === parseInt(multiMattressMatch[1], 10);
    if (ec.name === 'הובלה למזרן' || ec.name === 'הובלה מזרן') {
      return mattressCount >= 1 && bedCount === 0;
    }
    return true;
  });

  return (
    <div className={isModal ? 'space-y-6 p-6' : 'max-w-6xl mx-auto space-y-6'}>
      <div className="flex items-center gap-3">
        {isModal ? (
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => onExit?.()}>
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Link to={createPageUrl('QuoteDetails') + `?id=${quoteId}`}>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
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
                <IsraeliPhoneInput
                  value={formData.customer_phone}
                  onChange={(value) => setFormData({...formData, customer_phone: value})}
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
                  onFocus={(e) => { if (Number(e.target.value) === 0) e.target.select(); }}
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
              <CardContent className="pt-5">
                <ProductItemsEditor
                  items={formData.items}
                  onChange={handleItemsChange}
                  products={products}
                  variations={variations}
                  addons={addons}
                  addonPrices={addonPrices}
                />

            {/* Totals */}
            <QuoteTotalsSummary items={formData.items} extras={formData.extras} discountTotal={formData.discount_total} />
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
              <Label className="text-sm font-medium">אמצעי תשלום</Label>
              <p className="text-[11px] text-muted-foreground">בחר אחד או יותר. יופיע על ההצעה ועל ההזמנה.</p>
              <div className="flex flex-wrap gap-2">
                {PAYMENT_TERMS_OPTIONS.map((opt) => {
                  const selected = (formData.payment_terms_selection || []).includes(opt);
                  return (
                    <Button
                      key={opt}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        const current = formData.payment_terms_selection || [];
                        setFormData({
                          ...formData,
                          payment_terms_selection: selected
                            ? current.filter((x) => x !== opt)
                            : [...current, opt],
                        });
                      }}
                    >
                      {selected && <Check className="h-3 w-3 me-1" />}
                      {opt}
                    </Button>
                  );
                })}
              </div>
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
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">בקשות מיוחדות</Label>
              <Textarea
                value={formData.special_requests || ''}
                onChange={(e) => setFormData({...formData, special_requests: e.target.value})}
                placeholder="בקשות מיוחדות שיופיעו על ההצעה ועל ההזמנה (אופציונלי)"
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
              {isModal ? (
                <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-muted-foreground" onClick={() => onExit?.()}>ביטול</Button>
              ) : (
                <Link to={createPageUrl('QuoteDetails') + `?id=${quoteId}`}>
                  <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-muted-foreground">ביטול</Button>
                </Link>
              )}
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
