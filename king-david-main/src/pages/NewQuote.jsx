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

import { ArrowRight, Save, Loader2, Plus, Trash2, Check, X, Download, MessageCircle, Mail, FileText, ExternalLink, CreditCard, Shield, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from 'date-fns';
import UpsellPanel from '@/components/upsell/UpsellPanel';
import ProductSelector from '@/components/quote/ProductSelector';
import DiscountPopover from '@/components/quote/DiscountPopover';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, canViewLead } from '@/lib/rbac';
import { formatPhoneForWhatsApp } from '@/utils/phoneUtils';

function addBusinessDays(startDate, days) {
  const result = new Date(startDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 5 && day !== 6) added++;
  }
  return result;
}

export default function NewQuote({ asDialog = false, dialogLeadId = null, onDialogClose = null }) {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [currentStep, setCurrentStep] = useState(1);
  const [savedQuote, setSavedQuote] = useState(null);
  const [showPaymentScreen, setShowPaymentScreen] = useState(false);
  const steps = [
    { id: 1, name: 'פרטי לקוח' },
    { id: 2, name: 'מוצרים' },
    { id: 3, name: 'תוספות להובלה ותנאים' }
  ];
  const urlParams = new URLSearchParams(window.location.search);
  const leadId = dialogLeadId || urlParams.get('lead_id');

  const [formData, setFormData] = useState({
    lead_id: leadId || '',
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    delivery_address: '',
    delivery_city: '',
    property_type: 'apartment',
    floor: 0,
    apartment_number: '',
    elevator_type: 'none',
    items: [{ sku: '', name: '', product_id: '', variation_id: '', quantity: 1, unit_price: 0, discount_percent: 0, total: 0, selected_addons: [] }],
    extras: [],
    subtotal: 0,
    discount_total: 0,
    vat_amount: 0,
    total: 0,
    valid_until: format(addBusinessDays(new Date(), 7), 'yyyy-MM-dd'),
    terms: 'תשלום מלא עם ההזמנה. אספקה תוך 14-21 ימי עסקים.',
    warranty_terms: 'אחריות יצרן ל-10 שנים על המזרן.',
    status: 'draft',
    notes: 'תיאום שירותי מנוף, ככל שיידרש, ייעשה על ידי החברה כשירות ללקוח בלבד. התשלום עבור שירותי המנוף ישולם ישירות לחברת המנוף ועל אחריות הלקוח. לחברה אין כל אחריות, התחייבות או מעורבות בשירותי המנוף מלבד התיאום.',
  });

  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  const { data: lead } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => base44.entities.Lead.filter({ id: leadId }).then(res => res[0]),
    enabled: !!leadId && canAccessSales,
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
    if (lead) {
      setFormData(prev => ({
        ...prev,
        customer_name: lead.full_name,
        customer_phone: lead.phone,
        customer_email: lead.email || '',
        delivery_address: lead.address || '',
        delivery_city: lead.city || '',
      }));
    }
  }, [lead]);

  const createQuoteMutation = useMutation({
    mutationFn: async (data) => {
      // If no lead_id, search for existing lead by phone or create new
      let leadId = data.lead_id;
      if (!leadId) {
        // Check if lead already exists with this phone number
        const existingLeads = await base44.entities.Lead.filter({ phone: data.customer_phone });

        if (existingLeads.length > 0) {
          // Use existing lead
          leadId = existingLeads[0].id;
        } else {
          // Create new lead
          const newLead = await base44.entities.Lead.create({
            full_name: data.customer_name,
            phone: data.customer_phone,
            email: data.customer_email,
            address: data.delivery_address,
            city: data.delivery_city,
            source: 'store',
            status: 'qualified',
            rep1: effectiveUser?.email,
            effective_sort_date: new Date().toISOString(),
          });
          leadId = newLead.id;
        }
      }

      // Generate quote number
      const quotes = await base44.entities.Quote.list('-created_date', 1);
      const lastNumber = quotes[0]?.quote_number?.replace('Q', '') || '1000';
      const newNumber = `Q${parseInt(lastNumber) + 1}`;
      
      const newQuote = await base44.entities.Quote.create({
        ...data,
        lead_id: leadId,
        quote_number: newNumber,
        created_by_rep: lead?.rep1 || effectiveUser?.email,
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
      });

      if (leadId) {
        await base44.entities.Lead.update(leadId, { status: 'followup_after_quote' });
      }

      // Generate and upload PDF
      let pdfUrl = null;
      try {
        pdfUrl = await QuotePdfGenerator(newQuote);
        await base44.entities.Quote.update(newQuote.id, { pdf_url: pdfUrl });
      } catch (error) {
        console.error('Failed to generate PDF:', error);
      }

      return { ...newQuote, pdf_url: pdfUrl, lead_id: leadId };
    },
    onSuccess: (quote) => {
      if (asDialog && onDialogClose) {
        setSavedQuote(quote);
      } else {
        navigate(createPageUrl('QuoteDetails') + `?id=${quote.id}`);
      }
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

    const extrasTotal = extras.reduce((sum, extra) => sum + (extra.cost || 0), 0);
    
    const subtotal = itemsSubtotal + extrasTotal;
    const vat_amount = Math.round(subtotal * 0.18);
    const total = Math.round(subtotal + vat_amount);
    
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

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSales) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור הצעת מחיר</p>
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור להצעות המחיר</Button>
        </Link>
      </div>
    );
  }

  if (leadId && lead && !canViewLead(effectiveUser, lead)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור הצעת מחיר לליד זה</p>
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור להצעות המחיר</Button>
        </Link>
      </div>
    );
  }

  const [emptyItemIndex, setEmptyItemIndex] = useState(null);

  const addItem = () => {
    const emptyIdx = formData.items.findIndex(item => !item.product_id && !item.name);
    if (emptyIdx !== -1) {
      setEmptyItemIndex(emptyIdx);
      setTimeout(() => setEmptyItemIndex(null), 2000);
      return;
    }
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
    createQuoteMutation.mutate(formData);
  };

  const mattressCount = formData.items.reduce((count, item) => {
    const product = products.find(p => p.id === item.product_id);
    return count + (product?.category === 'mattress' ? (item.quantity || 0) : 0);
  }, 0);

  const hasBeds = formData.items.some(item => {
    const product = products.find(p => p.id === item.product_id);
    return product?.bed_type;
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

  // Loading screen while saving quote
  if (asDialog && createQuoteMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-6">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-bold text-foreground">מכין את ההצעה...</h3>
          <p className="text-sm text-muted-foreground">שומר נתונים ומייצר PDF, אנא המתן</p>
        </div>
        <div className="w-64 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '70%' }} />
        </div>
      </div>
    );
  }

  // Summary screen after quote saved in dialog mode
  if (asDialog && savedQuote) {
    const whatsappPhone = formatPhoneForWhatsApp(formData.customer_phone);
    const whatsappText = encodeURIComponent(`שלום ${formData.customer_name}, מצורפת הצעת מחיר מס' ${savedQuote.quote_number} מקינג דוד.\n\nלצפייה בהצעה: ${savedQuote.pdf_url || ''}\n\nההצעה תקפה עד ${formData.valid_until ? format(new Date(formData.valid_until), 'dd/MM/yyyy') : ''}.\n\nבברכה, צוות קינג דוד`);

    // Payment screen for reserving quote
    if (showPaymentScreen) {
      return (
        <div className="space-y-6 py-4">
          <div className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">שריון הצעת מחיר</h2>
            <p className="text-sm text-muted-foreground">גביית מקדמה לשריון ההצעה מעבר ל-7 ימים</p>
          </div>

          <div className="border rounded-xl p-4 space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">הצעה מס'</span>
              <span className="font-semibold">{savedQuote.quote_number}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">סכום הצעה</span>
              <span className="font-semibold">₪{Math.round(formData.total).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-t pt-3">
              <span className="font-semibold">סכום מקדמה לשריון</span>
              <span className="font-bold text-lg text-primary">₪100</span>
            </div>
          </div>

          <div className="border rounded-xl p-4 space-y-4">
            <Label className="text-sm font-semibold">פרטי כרטיס אשראי</Label>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">מספר כרטיס</Label>
                <Input placeholder="0000 0000 0000 0000" className="text-left" dir="ltr" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">תוקף</Label>
                  <Input placeholder="MM/YY" className="text-left" dir="ltr" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">CVV</Label>
                  <Input placeholder="000" className="text-left" dir="ltr" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">שם בעל הכרטיס</Label>
                <Input placeholder="שם מלא" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">ת.ז. בעל הכרטיס</Label>
                <Input placeholder="מספר תעודת זהות" className="text-left" dir="ltr" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-center">
            <Lock className="h-3 w-3" />
            <span>החיוב מאובטח ומוצפן</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setShowPaymentScreen(false)} className="h-11">
              חזרה
            </Button>
            <Button className="h-11 gap-2">
              <CreditCard className="h-4 w-4" />
              חייב ₪100
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6 py-4">
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
            <Check className="h-7 w-7 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-foreground">ההצעה נוצרה בהצלחה!</h2>
          <p className="text-sm text-muted-foreground">הצעה מס' {savedQuote.quote_number}</p>
          <p className="text-lg font-bold text-foreground mt-1">סה״כ: ₪{Math.round(formData.total).toLocaleString()}</p>
        </div>

        {/* Validity notice */}
        <div className="border border-amber-200 bg-amber-50/60 rounded-xl px-4 py-3 text-center">
          <p className="text-sm font-semibold text-amber-800">
            תוקף ההצעה: {formData.valid_until ? format(new Date(formData.valid_until), 'dd/MM/yyyy') : ''} (7 ימי עסקים)
          </p>
          <p className="text-xs text-amber-600 mt-0.5">לשריון מעבר ל-7 ימים נדרשת מקדמה של ₪100</p>
        </div>

        <div className="grid gap-3">
          {savedQuote.pdf_url && (
            <div className="grid grid-cols-2 gap-3">
              <a href={savedQuote.pdf_url} target="_blank" rel="noopener noreferrer" className="w-full">
                <Button variant="outline" className="w-full gap-2 h-11">
                  <FileText className="h-4 w-4" />
                  צפה ב-PDF
                </Button>
              </a>
              <a href={savedQuote.pdf_url} download className="w-full">
                <Button variant="outline" className="w-full gap-2 h-11">
                  <Download className="h-4 w-4" />
                  הורד PDF
                </Button>
              </a>
            </div>
          )}

          {whatsappPhone && (
            <a
              href={`https://wa.me/${whatsappPhone}?text=${whatsappText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full"
            >
              <Button variant="outline" className="w-full gap-2 h-11 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                <MessageCircle className="h-4 w-4" />
                שלח בוואטסאפ ל{formData.customer_name}
              </Button>
            </a>
          )}

          {formData.customer_email && (
            <Button
              variant="outline"
              className="w-full gap-2 h-11 text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={async () => {
                try {
                  if (!savedQuote.pdf_url) return;
                  await base44.integrations.Core.SendEmail({
                    to: formData.customer_email,
                    subject: `הצעת מחיר מס' ${savedQuote.quote_number} מקינג דוד`,
                    body: `שלום ${formData.customer_name},\n\nמצורפת הצעת מחיר מס' ${savedQuote.quote_number}.\n\nלצפייה בהצעה: ${savedQuote.pdf_url}\n\nההצעה תקפה עד ${formData.valid_until ? format(new Date(formData.valid_until), 'dd/MM/yyyy') : ''}.\n\nבברכה,\nצוות קינג דוד`
                  });
                  await base44.entities.Quote.update(savedQuote.id, { status: 'sent' });
                } catch (e) { console.error(e); }
              }}
            >
              <Mail className="h-4 w-4" />
              שלח במייל ל{formData.customer_email}
            </Button>
          )}

          <a href={createPageUrl('QuoteDetails') + `?id=${savedQuote.id}`} target="_blank" rel="noopener noreferrer" className="w-full">
            <Button variant="outline" className="w-full gap-2 h-11">
              <ExternalLink className="h-4 w-4" />
              צפה בהצעה
            </Button>
          </a>

          <Button
            variant="outline"
            className="w-full gap-2 h-11 text-primary border-primary/20 hover:bg-primary/5"
            onClick={() => setShowPaymentScreen(true)}
          >
            <Shield className="h-4 w-4" />
            שריון הצעה (מקדמה ₪100)
          </Button>
        </div>

        <Button
          className="w-full h-11"
          onClick={() => onDialogClose(savedQuote)}
        >
          סיום ותזמון פולואפ
        </Button>
      </div>
    );
  }

  return (
    <div className={asDialog ? 'space-y-4' : 'max-w-4xl mx-auto space-y-6'}>
      {!asDialog && (
        <div className="flex items-center gap-3">
          <Link to={createPageUrl('Quotes')}>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">הצעת מחיר חדשה</h1>
            <p className="text-sm text-muted-foreground">צור הצעת מחיר ללקוח</p>
          </div>
        </div>
      )}

      <div className={asDialog ? 'mb-4 mt-2' : 'mb-8 mt-6'}>
        <div className="flex items-center justify-center">
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className="flex flex-col items-center gap-1.5 group relative"
              >
                <div className={`${asDialog ? 'w-8 h-8 text-xs' : 'w-10 h-10 sm:w-12 sm:h-12 text-sm sm:text-base'} rounded-full flex items-center justify-center font-bold transition-all duration-300 ${
                  currentStep > step.id
                    ? 'bg-emerald-500 text-white shadow-md'
                    : currentStep === step.id
                    ? 'gradient-brand text-white shadow-primary-glow ring-4 ring-indigo-100'
                    : 'bg-white border-2 border-border text-muted-foreground group-hover:border-primary/30'
                }`}>
                  {currentStep > step.id ? <Check className={asDialog ? "w-3.5 h-3.5" : "w-5 h-5"} /> : step.id}
                </div>
                <span className={`${asDialog ? 'text-[11px]' : 'text-xs sm:text-sm'} font-medium whitespace-nowrap transition-colors ${
                  currentStep === step.id ? 'text-primary font-semibold' : currentStep > step.id ? 'text-emerald-600' : 'text-muted-foreground'
                }`}>{step.name}</span>
              </button>
              {idx < steps.length - 1 && (
                <div className={`flex-1 ${asDialog ? 'mx-2 mt-[-18px]' : 'mx-3 sm:mx-6 mt-[-24px] sm:mt-[-28px]'}`}>
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
                <div key={index} className={`rounded-xl overflow-hidden bg-white shadow-card border-2 transition-colors ${emptyItemIndex === index ? 'border-red-400 animate-pulse' : 'border-border'}`}>
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
                    {/* Total with VAT - show original + discounted when discount exists */}
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
                      if (addon.applies_to === 'double' && product?.bed_type === 'single') return false;
                      if (addon.applies_to === 'single' && product?.bed_type === 'double') return false;
                      return true;
                    });
                    if (applicableAddons.length === 0) return null;
                    return (
                      <div className="border-t border-border/40 pt-3 space-y-2">
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

        {/* Upsell Panel */}
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
              {asDialog ? (
                <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-muted-foreground" onClick={onDialogClose}>ביטול</Button>
              ) : (
                <Link to={createPageUrl('Quotes')}>
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
                  disabled={currentStep === 2 && !formData.items.some(item => item.product_id)}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCurrentStep(prev => Math.min(prev + 1, 3)); }}
                >
                  המשך
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 px-8 text-base font-semibold shadow-md hover:shadow-lg transition-shadow"
                  disabled={createQuoteMutation.isPending}
                >
                  {createQuoteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 me-2" />
                  )}
                  שמור הצעה
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}