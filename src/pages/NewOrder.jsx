import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import QuoteItemDetailsBar from "@/components/quote/QuoteItemDetailsBar";
import { ArrowRight, Save, Loader2, Plus, Trash2, User, UserCheck, X, Check } from "lucide-react";
import { productMatchesBedType } from '@/utils/bedType';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import ProductSelector from '@/components/quote/ProductSelector';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, isAdmin } from '@/lib/rbac';
import { createWithSequentialNumber } from '@/utils/sequentialNumber';
import { applyCrossRepReassignment } from '@/lib/crossRepReassignment';
import { FABRIC_SUPPLIERS, FABRIC_SUPPLIER_OTHER } from '@/constants/fabricSuppliers';
import { bedConfigFieldLines } from '@/lib/bedConfig';
import { PAYMENT_TERMS_OPTIONS } from '@/constants/paymentTerms';
import IsraeliPhoneInput from '@/components/shared/IsraeliPhoneInput';
import { isValidIsraeliPhone } from '@/utils/phoneUtils';
import { toast } from 'sonner';

// ₪ with two decimals (agorot) so totals match the per-line amounts.
const money2 = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Strip everything but digits, then drop a leading country prefix so
// "0537772829", "053-777-2829", "+972537772829", "972537772829" all match.
// Mirrors the helper in NewQuote.jsx — same lookup, same expected behaviour.
function normalizePhoneForLookup(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

export default function NewOrder({ asDialog = false, dialogLeadId = null, dialogQuoteId = null, onDialogClose = null }) {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const urlParams = new URLSearchParams(window.location.search);
  // In dialog mode (opened inline from a lead) the ids come as props instead
  // of the URL, and on success we close the dialog rather than navigate away.
  const quoteId = dialogQuoteId || urlParams.get('quote_id');
  const leadId = dialogLeadId || urlParams.get('leadId');
  const customerId = urlParams.get('customerId');

  // Same 3-step wizard as NewQuote so creating an order "speaks the same
  // language" as a quote: customer → products → extras & terms.
  const [currentStep, setCurrentStep] = useState(1);
  const steps = [
    { id: 1, name: 'פרטי לקוח' },
    { id: 2, name: 'מוצרים' },
    { id: 3, name: 'תוספות להובלה ותנאים' },
  ];

  const [formData, setFormData] = useState({
    source: 'store',
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    delivery_address: '',
    delivery_city: '',
    property_type: 'apartment',
    floor: 0,
    apartment_number: '',
    elevator_type: 'none',
    items: [{ sku: '', name: '', product_id: '', variation_id: '', quantity: 1, unit_price: 0, discount_percent: 0, total: 0, selected_addons: [], fabric_catalog_name: '', fabric_color_number: '', fabric_color: '', fabric_supplier: '', fabric_supplier_other: '' }],
    extras: [],
    subtotal: 0,
    discount_total: 0,
    vat_amount: 0,
    total: 0,
    payment_status: 'unpaid',
    production_status: 'not_started',
    delivery_status: 'need_scheduling',
    trial_30d_enabled: false,
    notes_sales: '',
    special_requests: '',
    payment_terms_selection: [],
  });

  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  const { data: quote } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => base44.entities.Quote.filter({ id: quoteId }).then(res => res[0]),
    enabled: !!quoteId && canAccessSales,
  });

  const { data: lead } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => base44.entities.Lead.filter({ id: leadId }).then(res => res[0]),
    enabled: !!leadId && canAccessSales,
  });

  const { data: quoteLead = null } = useQuery({
    queryKey: ['lead-for-new-order-quote', quote?.lead_id],
    queryFn: () => base44.entities.Lead.filter({ id: quote.lead_id }).then(res => res[0] || null),
    enabled: !!quote?.lead_id && canAccessSales && !leadId,
  });

  // Repeat-order flow: the customer card links to NewOrder?customerId=<id>
  // so we can pre-fill name/phone/email/address from the customer record
  // without the user retyping anything.
  const { data: customer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => base44.entities.Customer.filter({ id: customerId }).then(res => res[0] || null),
    enabled: !!customerId && canAccessSales,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.Product.filter({ is_active: true }),
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

  // Real-time phone lookup so a NewOrder started without a lead/customer/quote
  // context still snaps to an existing record. Mirrors the implementation in
  // NewQuote.jsx — 150 ms debounce, kicks in at 4+ digits, keeps the previous
  // dropdown visible while the next query is in flight, and skipped entirely
  // once the form is already linked (we came from a lead/customer/quote URL,
  // or the user already picked a match).
  const [debouncedPhone, setDebouncedPhone] = useState('');
  const [linkedRecord, setLinkedRecord] = useState(null); // { kind, id, full_name }
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(normalizePhoneForLookup(formData.customer_phone)), 150);
    return () => clearTimeout(t);
  }, [formData.customer_phone]);

  const phoneLookupEnabled =
    !leadId && !customerId && !quoteId && debouncedPhone.length >= 4 && !linkedRecord;

  const { data: phoneMatchesData, isFetching: isPhoneFetching } = useQuery({
    queryKey: ['orderPhoneLookup', debouncedPhone],
    enabled: phoneLookupEnabled && canAccessSales,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const tail = debouncedPhone.slice(-Math.min(9, debouncedPhone.length));
      const pattern = `%${tail}%`;
      const [{ data: customers, error: cErr }, { data: leads, error: lErr }] = await Promise.all([
        base44.supabase
          .from('customers')
          .select('id, full_name, phone, email, address, city')
          .ilike('phone', pattern)
          .limit(5),
        base44.supabase
          .from('leads')
          .select('id, full_name, phone, email, address, city, status')
          .ilike('phone', pattern)
          .limit(5),
      ]);
      if (cErr) throw cErr;
      if (lErr) throw lErr;
      return { customers: customers || [], leads: leads || [] };
    },
  });

  const phoneMatches = useMemo(() => {
    if (!phoneMatchesData) return [];
    return [
      ...phoneMatchesData.customers.map((row) => ({ kind: 'customer', ...row })),
      ...phoneMatchesData.leads.map((row) => ({ kind: 'lead', ...row })),
    ];
  }, [phoneMatchesData]);

  const showPhoneMatches = phoneLookupEnabled && phoneMatches.length > 0;
  // Feedback while the lookup runs — covers BOTH the debounce window (the typed
  // phone hasn't propagated to the query yet) and the request in flight — so the
  // rep can SEE a search is happening instead of staring at a static field.
  const normalizedTypedPhone = normalizePhoneForLookup(formData.customer_phone);
  const phoneSearching =
    !leadId && !customerId && !quoteId && !linkedRecord && canAccessSales &&
    normalizedTypedPhone.length >= 4 &&
    (isPhoneFetching || normalizedTypedPhone !== debouncedPhone);

  const applyPhoneMatch = (match) => {
    setFormData((prev) => ({
      ...prev,
      customer_name: match.full_name || prev.customer_name,
      customer_phone: match.phone || prev.customer_phone,
      customer_email: match.email || prev.customer_email,
      delivery_address: match.address || prev.delivery_address,
      delivery_city: match.city || prev.delivery_city,
      // Stamp lead_id when matching a lead so the order gets linked the same
      // way it would if the user had navigated from /Leads. Customer matches
      // don't need lead_id — the order's customer_id flow handles them.
      lead_id: match.kind === 'lead' ? match.id : prev.lead_id,
    }));
    setLinkedRecord({ kind: match.kind, id: match.id, full_name: match.full_name });
  };

  const clearPhoneLink = () => {
    setLinkedRecord(null);
    if (!leadId) setFormData((prev) => ({ ...prev, lead_id: '' }));
  };

  useEffect(() => {
    if (quote) {
      setFormData(prev => ({
        ...prev,
        quote_id: quote.id,
        lead_id: quote.lead_id,
        customer_name: quote.customer_name,
        customer_phone: quote.customer_phone,
        customer_email: quote.customer_email || '',
        delivery_address: quote.delivery_address || prev.delivery_address,
        delivery_city: quote.delivery_city || prev.delivery_city,
        property_type: quote.property_type || prev.property_type,
        floor: quote.floor ?? prev.floor,
        apartment_number: quote.apartment_number || prev.apartment_number,
        elevator_type: quote.elevator_type || prev.elevator_type,
        items: quote.items || prev.items,
        extras: quote.extras || prev.extras,
        subtotal: quote.subtotal || 0,
        discount_total: quote.discount_total || 0,
        vat_amount: quote.vat_amount || 0,
        total: quote.total || 0,
        special_requests: quote.special_requests || prev.special_requests,
        payment_terms_selection: Array.isArray(quote.payment_terms_selection)
          ? quote.payment_terms_selection
          : prev.payment_terms_selection,
      }));
    }
  }, [quote]);

  useEffect(() => {
    if (lead) {
      setFormData(prev => ({
        ...prev,
        lead_id: lead.id,
        customer_name: lead.full_name,
        customer_phone: lead.phone,
        customer_email: lead.email || '',
        delivery_address: lead.address || '',
        delivery_city: lead.city || '',
      }));
    }
  }, [lead]);

  // Pre-fill from the customer record when arriving from the customer card.
  // A `customerId` URL param is mutually exclusive with `leadId`/`quote_id`
  // (the customer card doesn't set those), so there's no risk of the three
  // useEffects fighting over formData.
  useEffect(() => {
    if (customer) {
      setFormData(prev => ({
        ...prev,
        customer_id: customer.id,
        customer_name: customer.full_name || '',
        customer_phone: customer.phone || '',
        customer_email: customer.email || '',
        delivery_address: customer.address || '',
        delivery_city: customer.city || '',
      }));
    }
  }, [customer]);

  const createOrderMutation = useMutation({
    mutationFn: async (data) => {
      // Atomically allocate a unique order_number — fetch + insert with
      // retry-on-unique-violation so two reps saving at the same moment can't
      // collide on the same ORD#### (which would throw 23505).
      const order = await createWithSequentialNumber({
        entity: base44.entities.Order,
        numberField: 'order_number',
        prefix: 'ORD',
        startingValue: 10001,
        buildPayload: (newNumber) => ({
          ...data,
          order_number: newNumber,
          // Credit the rep who closes the sale: a quote carries its creator;
          // otherwise the acting rep (non-admin) gets it, so serving someone
          // else's walk-in credits the server — admins keep the owner.
          rep1: quote?.created_by_rep || (isAdmin(effectiveUser) ? (lead?.rep1 || quoteLead?.rep1) : null) || effectiveUser?.email,
        }),
      });

      // Derive the shipment number from the order's actual assigned number,
      // not from the pre-collision candidate, so retries stay aligned.
      const shipmentSuffix = String(order.order_number || '').replace('ORD', '');

      // Create shipment
      await base44.entities.DeliveryShipment.create({
        shipment_number: `SHP${shipmentSuffix}`,
        order_id: order.id,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        address: data.delivery_address,
        city: data.delivery_city,
        status: 'need_scheduling',
      });

      // Create commission
      await base44.entities.Commission.create({
        order_id: order.id,
        order_number: order.order_number,
        rep1: quote?.created_by_rep || (isAdmin(effectiveUser) ? (lead?.rep1 || quoteLead?.rep1) : null) || effectiveUser?.email,
        rep1_percent: 100,
        rep2_percent: 0,
        base_amount: data.subtotal,
        commission_rate: 5,
        total_commission: data.subtotal * 0.05,
        rep1_amount: data.subtotal * 0.05,
        rep2_amount: 0,
        status: 'pending',
      });

      // Create or find customer
      let customerId = null;
      const existingCustomers = await base44.entities.Customer.filter({ phone: data.customer_phone });
      
      if (existingCustomers && existingCustomers.length > 0) {
        // Customer exists - update their data
        customerId = existingCustomers[0].id;
        await base44.entities.Customer.update(customerId, {
          last_order_date: new Date().toISOString(),
          total_orders: (existingCustomers[0].total_orders || 0) + 1,
          lifetime_value: (existingCustomers[0].lifetime_value || 0) + data.total,
        });
      } else {
        // Create new customer
        const customer = await base44.entities.Customer.create({
          full_name: data.customer_name,
          phone: data.customer_phone,
          email: data.customer_email,
          city: data.delivery_city,
          address: data.delivery_address,
          source: data.source,
          first_order_date: new Date().toISOString(),
          last_order_date: new Date().toISOString(),
          total_orders: 1,
          lifetime_value: data.total,
          status: 'active',
        });
        customerId = customer.id;
      }

      // Update order with customer_id
      await base44.entities.Order.update(order.id, { customer_id: customerId });

      // Update quote status if exists
      if (data.quote_id) {
        await base44.entities.Quote.update(data.quote_id, { status: 'approved' });
      }

      // Update lead status and link customer if exists
      if (data.lead_id) {
        await base44.entities.Lead.update(data.lead_id, {
          status: 'deal_closed',
          customer_id: customerId
        });
        // Cross-rep policy: a rep who doesn't own this lead just created an
        // order → become secondary if the lead already had an order, else take
        // over as primary. excludeOrderId ignores the order we just created so
        // the FIRST order still counts as "no prior order". Admins exempt.
        await applyCrossRepReassignment({
          leadId: data.lead_id,
          actingUser: effectiveUser,
          isAdminActor: isAdmin(effectiveUser),
          sourceLabel: 'הזמנה',
          excludeOrderId: order.id,
        });
      }

      return order;
    },
    onSuccess: (order) => {
      if (asDialog && onDialogClose) { onDialogClose(order); return; }
      navigate(createPageUrl('OrderDetails') + `?id=${order.id}`);
    },
    // Without this, a failed insert (RLS denial, a rejected column, or a failing
    // shipment/commission/customer sub-insert) left "צור הזמנה" doing nothing —
    // the mutation rejected and no feedback surfaced. Mirror NewQuote: surface
    // the real PostgREST error parts so the rep sees exactly what broke.
    onError: (err) => {
      const parts = [err?.message, err?.details, err?.hint, err?.code]
        .map((p) => (p == null || p === '' ? null : String(p)))
        .filter(Boolean);
      const description = parts.length ? parts.join(' — ') : (typeof err === 'string' ? err : 'אירעה שגיאה לא ידועה');
      console.error('Order.create failed', { message: err?.message, details: err?.details, hint: err?.hint, code: err?.code, raw: err });
      const isDuplicateKey = err?.code === '23505' || /duplicate key|unique constraint/i.test(description);
      if (isDuplicateKey) {
        toast.error('מספר ההזמנה כבר תפוס (ייתכן שנוצרה הזמנה נוספת באותו רגע). אנא רענן את הדף ונסה שוב.', {
          duration: Infinity,
        });
        return;
      }
      toast.error(`יצירת ההזמנה נכשלה: ${description}`, { duration: Infinity });
    },
  });

  // Mirrors NewQuote.calculateTotals so an order "speaks the same language" as
  // the quote it may have come from: per-item percentage discounts feed both
  // the (discounted) subtotal and a separate discount_total line, and VAT is
  // charged on the discounted items subtotal only.
  const calculateTotals = (items, extras = []) => {
    const itemsSubtotal = items.reduce((sum, item) => {
      const addonsTotal = (item.selected_addons || []).reduce((addonSum, addon) => addonSum + (addon.price || 0), 0);
      const itemTotal = item.quantity * (item.unit_price + addonsTotal);
      const discount = itemTotal * ((item.discount_percent || 0) / 100);
      return sum + (itemTotal - discount);
    }, 0);

    const discount_total = items.reduce((sum, item) => {
      const addonsTotal = (item.selected_addons || []).reduce((addonSum, addon) => addonSum + (addon.price || 0), 0);
      const itemTotal = item.quantity * (item.unit_price + addonsTotal);
      return sum + (itemTotal * ((item.discount_percent || 0) / 100));
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

  const updateItem = (index, field, value) => {
    setFormData(prev => {
      const newItems = prev.items.map((item, idx) => {
        if (idx !== index) return item;
        const updatedItem = { ...item, [field]: value };
        const addonsTotal = (updatedItem.selected_addons || []).reduce((sum, addon) => sum + (addon.price || 0), 0);
        const itemTotal = updatedItem.quantity * (updatedItem.unit_price + addonsTotal);
        const discount = itemTotal * ((updatedItem.discount_percent || 0) / 100);
        updatedItem.total = itemTotal - discount;
        return updatedItem;
      });
      const totals = calculateTotals(newItems, prev.extras);
      return { ...prev, items: newItems, ...totals };
    });
  };

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSales) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור הזמנה</p>
        <Link to={createPageUrl('Orders')}>
          <Button className="mt-4">חזור להזמנות</Button>
        </Link>
      </div>
    );
  }

  // Order creation is open to any sales rep, including for a lead/quote they
  // don't own (closing a walk-in sale). Lead ownership is untouched; the
  // order + commission are credited to the rep who actually closes the sale
  // (see rep1 attribution above). Only non-sales users are turned away.

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
      setFormData(prev => ({ ...prev, items: newItems }));
    }
  };

  const handleVariationSelect = (index, variation) => {
    const newItems = [...formData.items];
    newItems[index] = {
      ...newItems[index],
      variation_id: variation.id,
      sku: variation.sku,
      unit_price: variation.final_price || 0,
      selected_addons: []
    };
    {
      const base = newItems[index].quantity * newItems[index].unit_price;
      newItems[index].total = base - base * ((newItems[index].discount_percent || 0) / 100);
    }

    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const handleAddonsSelect = (index, addons) => {
    const newItems = [...formData.items];
    newItems[index].selected_addons = addons;
    
    const basePrice = newItems[index].unit_price;
    const addonsTotal = addons.reduce((sum, addon) => sum + (addon.price || 0), 0);
    {
      const base = newItems[index].quantity * (basePrice + addonsTotal);
      newItems[index].total = base - base * ((newItems[index].discount_percent || 0) / 100);
    }

    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const removeItem = (index) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // The required customer fields live on step 1; since steps are unmounted
    // (not CSS-hidden), the browser can't enforce `required` from step 3 — so
    // validate here and jump back so the rep sees exactly what's missing.
    if (!formData.customer_name?.trim() || !formData.delivery_address?.trim()) {
      setCurrentStep(1);
      toast.error('יש למלא שם לקוח וכתובת למשלוח');
      return;
    }
    if (!isValidIsraeliPhone(formData.customer_phone)) {
      setCurrentStep(1);
      toast.error('מספר טלפון לא תקין. פורמט ישראלי: 05X-XXXXXXX או 0X-XXXXXXX');
      return;
    }
    createOrderMutation.mutate(formData);
  };

  return (
    <div className={asDialog ? 'space-y-4' : 'max-w-4xl mx-auto space-y-6'}>
      {!asDialog && (
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Orders')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">הזמנה חדשה</h1>
            <p className="text-muted-foreground">צור הזמנה חדשה</p>
          </div>
        </div>
      )}

      {/* Step indicator — mirrors NewQuote */}
      <div className={asDialog ? 'mb-4 mt-2' : 'mb-8 mt-6'}>
        <div className="flex items-center justify-center">
          {steps.map((step, idx) => {
            // Can't jump forward past an incomplete step (same rules as "המשך").
            const step1Valid = !!formData.customer_name?.trim() && isValidIsraeliPhone(formData.customer_phone);
            const step2Valid = formData.items.some(item => item.product_id);
            const locked = step.id > currentStep && !(
              (step.id === 2 && step1Valid) || (step.id === 3 && step1Valid && step2Valid)
            );
            return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => { if (!locked) setCurrentStep(step.id); }}
                disabled={locked}
                className={`flex flex-col items-center gap-1.5 group relative ${locked ? 'cursor-not-allowed' : ''}`}
              >
                <div className={`${asDialog ? 'w-8 h-8 text-xs' : 'w-10 h-10 sm:w-12 sm:h-12 text-sm sm:text-base'} rounded-full flex items-center justify-center font-bold transition-all duration-300 ${
                  currentStep > step.id
                    ? 'bg-emerald-500 text-white shadow-md'
                    : currentStep === step.id
                    ? 'gradient-brand text-white shadow-primary-glow ring-4 ring-indigo-100'
                    : 'bg-white border-2 border-border text-muted-foreground group-hover:border-primary/30'
                }`}>
                  {currentStep > step.id ? <Check className={asDialog ? 'w-3.5 h-3.5' : 'w-5 h-5'} /> : step.id}
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
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); }}>
        {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>פרטי לקוח</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>מקור הזמנה</Label>
                <Select value={formData.source} onValueChange={(v) => setFormData({...formData, source: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">חנות</SelectItem>
                    <SelectItem value="callcenter">מוקד טלפוני</SelectItem>
                    <SelectItem value="digital">דיגיטל</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
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
            {linkedRecord ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-emerald-800">
                  <UserCheck className="h-4 w-4" />
                  <span>
                    {linkedRecord.kind === 'customer' ? 'מקושר ללקוח קיים' : 'מקושר לליד קיים'}
                    {linkedRecord.full_name ? ` — ${linkedRecord.full_name}` : ''}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={clearPhoneLink} className="h-7 px-2 text-emerald-700">
                  <X className="h-3.5 w-3.5 me-1" />
                  בטל קישור
                </Button>
              </div>
            ) : null}
            {showPhoneMatches ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
                <p className="text-xs text-blue-800 font-medium flex items-center gap-1.5">
                  {phoneSearching && <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />}
                  נמצאו רשומות עם טלפון דומה — בחר כדי לקשר את ההזמנה:
                </p>
                <div className="space-y-1.5">
                  {phoneMatches.map((m) => (
                    <button
                      key={`${m.kind}-${m.id}`}
                      type="button"
                      onClick={() => applyPhoneMatch(m)}
                      className="w-full text-right rounded-md bg-white border border-blue-100 px-3 py-2 hover:border-blue-300 hover:shadow-sm transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="text-sm min-w-0">
                          <div className="font-medium truncate">{m.full_name || '(ללא שם)'}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {m.phone || '-'} {m.email ? `• ${m.email}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${m.kind === 'customer' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {m.kind === 'customer' ? 'לקוח' : 'ליד'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : phoneSearching ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 flex items-center gap-2 text-xs text-blue-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                מחפש רשומות עם טלפון תואם…
              </div>
            ) : null}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>כתובת למשלוח *</Label>
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
                <Label>עיר *</Label>
                <Input
                  value={formData.delivery_city}
                  onChange={(e) => setFormData({...formData, delivery_city: e.target.value})}
                  required
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
        <Card className="mt-6">
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
                <div key={index} className="rounded-xl overflow-hidden bg-white shadow-card border-2 border-border transition-colors">
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

                  {/* Labelled qty / unit price / discount / totals bar — shared with quotes */}
                  <QuoteItemDetailsBar
                    item={item}
                    onUpdateQuantity={(qty) => updateItem(index, 'quantity', qty)}
                    onApplyDiscount={(percent) => updateItem(index, 'discount_percent', percent)}
                    onRemove={() => removeItem(index)}
                  />
                  </TooltipProvider>

                  {/* Bed-only fabric catalog block. Orders converted from a quote
                      carry the wizard-collected bed_config_fields — show those
                      read-only instead of the manual grid so fabric isn't entered
                      twice. Manual entry stays for orders created from scratch. */}
                  {(() => {
                    const product = products.find(p => p.id === item.product_id);
                    if (product?.category !== 'bed') return null;
                    const fieldLines = bedConfigFieldLines(item);
                    if (fieldLines.length) {
                      return (
                        <div className="px-3 pb-3 border-t border-border/40 pt-3 space-y-1">
                          <Label className="text-xs font-medium text-muted-foreground">קטלוג בד ושדות נוספים</Label>
                          {fieldLines.map((ln, i) => (
                            <div key={i} className="text-xs text-foreground/80">{ln}</div>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div className="px-3 pb-3 border-t border-border/40 pt-3 space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">קטלוג בד</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <Input
                            placeholder="שם קטלוג"
                            value={item.fabric_catalog_name || ''}
                            onChange={(e) => updateItem(index, 'fabric_catalog_name', e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Input
                            placeholder="מס׳ צבע"
                            value={item.fabric_color_number || ''}
                            onChange={(e) => updateItem(index, 'fabric_color_number', e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Input
                            placeholder="צבע"
                            value={item.fabric_color || ''}
                            onChange={(e) => updateItem(index, 'fabric_color', e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Select
                            value={item.fabric_supplier || ''}
                            onValueChange={(val) => {
                              updateItem(index, 'fabric_supplier', val);
                              if (val !== FABRIC_SUPPLIER_OTHER) {
                                updateItem(index, 'fabric_supplier_other', '');
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="ספק" />
                            </SelectTrigger>
                            <SelectContent>
                              {FABRIC_SUPPLIERS.map((s) => (
                                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {item.fabric_supplier === FABRIC_SUPPLIER_OTHER && (
                          <Input
                            placeholder="שם הספק"
                            value={item.fabric_supplier_other || ''}
                            onChange={(e) => updateItem(index, 'fabric_supplier_other', e.target.value)}
                            className="h-8 text-xs"
                          />
                        )}
                      </div>
                    );
                  })()}

                  {/* Addons — toggle into the line item's selected_addons */}
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
                            const isSelected = (item.selected_addons || []).some(sa => sa.addon_id === addon.id);
                            return (
                              <Button
                                key={addon.id}
                                type="button"
                                variant={isSelected ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                  const currentAddons = item.selected_addons || [];
                                  const newSelectedAddons = isSelected
                                    ? currentAddons.filter(sa => sa.addon_id !== addon.id)
                                    : [...currentAddons, { addon_id: addon.id, name: addon.name, price: finalAddonPrice }];
                                  handleAddonsSelect(index, newSelectedAddons);
                                }}
                                className={`text-xs h-8 ${isSelected ? '' : 'bg-primary/5 border-primary/20 hover:bg-primary/10 hover:border-primary/30 text-primary'}`}
                              >
                                {isSelected ? <Check className="w-3 h-3 me-1" /> : <Plus className="w-3 h-3 me-1" />}
                                {addon.name} (₪{Math.round((finalAddonPrice || 0) * 1.18).toLocaleString()})
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

            <div className="mt-6 border border-border rounded-xl overflow-hidden">
              <div className="p-4 space-y-3 bg-muted/40">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">סכום לפני מע״מ</span>
                  <span className="font-medium">{money2(formData.subtotal)}</span>
                </div>
                {formData.discount_total > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>הנחה כולל מע״מ</span>
                    <span className="font-medium">-{money2(formData.discount_total * 1.18)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">מע״מ (18%)</span>
                  <span className="font-medium">{money2(formData.vat_amount)}</span>
                </div>
              </div>
              <div className="flex justify-between items-center px-4 py-3.5 bg-primary/5 border-t border-primary/10">
                <span className="text-base font-bold text-foreground">סה״כ לתשלום</span>
                <span className="text-xl font-bold text-primary">{money2(formData.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {currentStep === 3 && (
        <>
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>תוספות</CardTitle>
            <Select onValueChange={addExtra}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="הוסף תוספת" />
              </SelectTrigger>
              <SelectContent>
                {extraCharges.map(ec => (
                  <SelectItem key={ec.id} value={ec.id}>
                    {ec.name} - ₪{ec.cost.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {formData.extras.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">לא נוספו תוספות</p>
            ) : (
              <div className="space-y-3">
                {formData.extras.map((extra, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium">{extra.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-lg">₪{extra.cost.toLocaleString()}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeExtra(index)}
                        className="text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>אפשרויות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={formData.trial_30d_enabled}
                onCheckedChange={(v) => setFormData({...formData, trial_30d_enabled: v})}
              />
              <Label>ניסיון 30 יום</Label>
            </div>
            <div className="space-y-2">
              <Label>הערות</Label>
              <Textarea
                value={formData.notes_sales}
                onChange={(e) => setFormData({...formData, notes_sales: e.target.value})}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>בקשות מיוחדות</Label>
              <Textarea
                value={formData.special_requests || ''}
                onChange={(e) => setFormData({...formData, special_requests: e.target.value})}
                placeholder="בקשות מיוחדות שיופיעו על ההזמנה (אופציונלי)"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>אמצעי תשלום</Label>
              <p className="text-[11px] text-muted-foreground">בחר אחד או יותר. יופיע על ההזמנה.</p>
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
          </CardContent>
        </Card>
        </>
        )}

        <div className="flex items-center justify-between gap-3 mt-8">
          <div className="flex gap-2">
            {currentStep > 1 && (
              <Button type="button" variant="outline" onClick={() => setCurrentStep(currentStep - 1)}>
                <ArrowRight className="h-4 w-4 me-1.5" />
                חזור
              </Button>
            )}
            {asDialog ? (
              <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => onDialogClose?.(null)}>ביטול</Button>
            ) : (
              <Link to={createPageUrl('Orders')}>
                <Button type="button" variant="ghost" className="text-muted-foreground">ביטול</Button>
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {currentStep < 3 ? (
              <>
                <Button
                  type="button"
                  size="lg"
                  className="h-11 px-8 text-base font-semibold"
                  disabled={
                    (currentStep === 1 && (!formData.customer_name?.trim() || !isValidIsraeliPhone(formData.customer_phone)))
                    || (currentStep === 2 && !formData.items.some(item => item.product_id))
                  }
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCurrentStep(prev => Math.min(prev + 1, 3)); }}
                >
                  המשך
                </Button>
                {currentStep === 1 && (!formData.customer_name?.trim() || !isValidIsraeliPhone(formData.customer_phone)) ? (
                  <span className="text-[11px] text-muted-foreground">יש למלא שם וטלפון תקין כדי להמשיך</span>
                ) : currentStep === 2 && !formData.items.some(item => item.product_id) ? (
                  <span className="text-[11px] text-muted-foreground">יש להוסיף לפחות מוצר אחד כדי להמשיך</span>
                ) : null}
              </>
            ) : (
              <Button
                type="submit"
                className="bg-primary hover:bg-primary/90 h-11 px-8 text-base font-semibold"
                disabled={createOrderMutation.isPending}
              >
                {createOrderMutation.isPending ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 me-2" />
                )}
                צור הזמנה
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}