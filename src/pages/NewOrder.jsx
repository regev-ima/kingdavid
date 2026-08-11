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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Save, Loader2, Trash2, User, UserCheck, X, Check, Wallet, Plus, CreditCard, Truck, PackageCheck } from "lucide-react";
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import ProductItemsEditor from '@/components/quote/ProductItemsEditor';
import QuoteTotalsSummary from '@/components/quote/QuoteTotalsSummary';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, isAdmin } from '@/lib/rbac';
import { createWithSequentialNumber } from '@/utils/sequentialNumber';
import { applyCrossRepReassignment } from '@/lib/crossRepReassignment';
import { PAYMENT_TERMS_OPTIONS } from '@/constants/paymentTerms';
import { LEAD_SOURCE_OPTIONS } from '@/constants/leadOptions';
import { customDocumentTerms } from '@/constants/documentTerms';
import useDocumentTermsDefaults from '@/hooks/use-document-terms';
import OrderPaymentDialog, { PAYMENT_METHODS, calcPaymentStatus, sumPayments } from '@/components/payment/OrderPaymentDialog';
import HypPaymentDialog from '@/components/payment/HypPaymentDialog';
import { isDeliveryRelatedExtra, recommendDeliveryExtras, summarizeItems } from '@/lib/deliveryExtras';
import DeliveryExtrasCard from '@/components/quote/DeliveryExtrasCard';
import useOrderAutoSend from '@/hooks/use-order-autosend';
import { sendOrderToCustomerWhatsApp, orderIsPaidEnoughToSend } from '@/lib/orderWhatsAppAutoSend';
import { cleanOrderItems, hasSellableItem, validateOrderItems } from '@/lib/orderItems';
import { calculateDocumentTotals, lineGrossPreVat, lineDiscountPreVat } from '@/lib/quoteTotals';
import IsraeliPhoneInput from '@/components/shared/IsraeliPhoneInput';
import { isValidIsraeliPhone, toLocalIsraeliPhone } from '@/utils/phoneUtils';
import { toast } from 'sonner';

// ₪ with two decimals (agorot) so totals match the per-line amounts.
const money2 = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Local form, so "0537772829", "053-777-2829", "+972537772829" and
// "972537772829" all resolve to the same lookup key. Same helper NewQuote
// uses — one rule, one place.
const normalizePhoneForLookup = toLocalIsraeliPhone;

// What picking a payment-terms chip should DO, beyond labelling the order.
//   'hyp'    — real card clearing. The order has to exist first (hyp-sign needs
//              an order_id), so it runs straight after save.
//   'record' — money changing hands here and now; open the manual record dialog.
//   null     — paid later, on delivery. Nothing to collect at this point.
const TERM_ACTION = {
  'אשראי': { kind: 'hyp' },
  'מזומן': { kind: 'record', method: 'cash' },
  'תשלום בבית למוביל': null,
};

export default function NewOrder({ asDialog = false, dialogLeadId = null, dialogQuoteId = null, onDialogClose = null }) {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const { enabled: autoSendWhatsApp } = useOrderAutoSend();
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

  // "מקור הגעה" defaults to חנות only until we know better: a lead (directly,
  // or the one behind the quote) carries the real source, and every order
  // created from one used to be filed as a walk-in. A rep who picks a source
  // by hand outranks the lead — hence the touched flag.
  const [sourceTouched, setSourceTouched] = useState(false);

  const [formData, setFormData] = useState({
    source: 'store',
    customer_name: '',
    customer_phone: '',
    // Second number for the delivery — the spouse, the office, whoever the
    // driver reaches when the first one doesn't answer. Printed on the order.
    customer_phone_2: '',
    customer_email: '',
    // Optional. Hyp returns the payer's ת.ז. with a card charge, but a cash sale
    // never touches Hyp — so the rep can type it here and keep the order
    // complete either way. hyp-verify / hyp-notify only fill it when empty, so
    // what's typed here is never overwritten.
    customer_id_number: '',
    delivery_address: '',
    delivery_city: '',
    property_type: 'apartment',
    floor: 0,
    apartment_number: '',
    elevator_type: 'none',
    // The customer collects from the factory: no address to deliver to, no
    // delivery/assembly extras, and the order says "איסוף עצמי - בתיאום".
    is_self_pickup: false,
    items: [],
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
    // Payments collected while the order is being written. Saved with the order
    // itself, so a paid-on-the-spot sale never has to be re-opened to record it.
    payments: [],
  });

  // Manual record dialog — `method` is what the rep's payment-terms click implies.
  const [paymentDialog, setPaymentDialog] = useState({ open: false, method: 'cash' });
  // The order we just created, held so Hyp clearing can run against it before
  // we leave the screen. hyp-sign needs a persisted order_id, which is exactly
  // why card clearing can't happen before save.
  const [createdOrder, setCreatedOrder] = useState(null);

  // Delivery extras the rep removed by hand. Auto-add must never resurrect one:
  // "I don't want this" has to outlive the next items change.
  const [dismissedExtraIds, setDismissedExtraIds] = useState([]);

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
          .select('id, full_name, phone, phone_2, email, address, city')
          .ilike('phone', pattern)
          .limit(5),
        base44.supabase
          .from('leads')
          .select('id, full_name, phone, phone_2, email, address, city, status')
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
      customer_phone_2: match.phone_2 || prev.customer_phone_2,
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
        customer_phone_2: quote.customer_phone_2 || prev.customer_phone_2,
        customer_email: quote.customer_email || '',
        delivery_address: quote.delivery_address || prev.delivery_address,
        delivery_city: quote.delivery_city || prev.delivery_city,
        property_type: quote.property_type || prev.property_type,
        floor: quote.floor ?? prev.floor,
        apartment_number: quote.apartment_number || prev.apartment_number,
        elevator_type: quote.elevator_type || prev.elevator_type,
        // Delivery was already priced (or waived) on the quote — carry the
        // decision over so the order doesn't silently re-add a delivery charge.
        is_self_pickup: quote.is_self_pickup ?? prev.is_self_pickup,
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
        customer_phone_2: lead.phone_2 || '',
        customer_email: lead.email || '',
        delivery_address: lead.address || '',
        delivery_city: lead.city || '',
        source: sourceTouched ? prev.source : (lead.source || prev.source),
      }));
    }
    // Deliberately keyed on `lead` alone: sourceTouched only ever guards a
    // value the rep already set by hand, and re-running on it would re-apply
    // the lead's source over that choice.
  }, [lead]);

  // Converting a quote: the source lives on the lead behind it, not on the
  // quote. `quoteLead` is only fetched when the URL had no leadId of its own,
  // so the two effects can't fight over the field.
  useEffect(() => {
    if (!quoteLead || sourceTouched) return;
    setFormData(prev => (
      quoteLead.source ? { ...prev, source: quoteLead.source } : prev
    ));
  }, [quoteLead, sourceTouched]);

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
        customer_phone_2: customer.phone_2 || '',
        customer_email: customer.email || '',
        delivery_address: customer.address || '',
        delivery_city: customer.city || '',
      }));
    }
  }, [customer]);

  // The legal wording an order is measured against. Never blank and never
  // errors, so a missing app_settings row can't hold up an order.
  const { defaults: termsDefaults, isLoading: termsDefaultsLoading } = useDocumentTermsDefaults();

  const createOrderMutation = useMutation({
    mutationFn: async (data) => {
      // The order copies only wording the quote actually customised. Standard
      // wording is left NULL so the order goes on reading הגדרות ← טקסטים
      // ותנאים — an admin fixing a typo there fixes it on the orders too,
      // which is the whole point of the screen. Until the defaults have loaded
      // there is nothing to measure against, so nothing is copied; the order
      // resolves live either way. If the columns aren't migrated yet the entity
      // layer drops them and the insert still goes through.
      const termsCopy = termsDefaultsLoading ? {} : customDocumentTerms(quote, termsDefaults);

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
          terms: termsCopy.terms ?? null,
          warranty_terms: termsCopy.warranty_terms ?? null,
          legal_notes: termsCopy.legal_notes ?? null,
          // A self-pickup order is never "waiting to be scheduled" — it waits
          // for the customer at the factory, and the logistics queue must not
          // treat it as an unscheduled delivery.
          delivery_status: data.is_self_pickup ? 'awaiting_pickup' : data.delivery_status,
          // Credit the rep who closes the sale: a quote carries its creator;
          // otherwise the acting rep (non-admin) gets it, so serving someone
          // else's walk-in credits the server — admins keep the owner.
          rep1: quote?.created_by_rep || (isAdmin(effectiveUser) ? (lead?.rep1 || quoteLead?.rep1) : null) || effectiveUser?.email,
        }),
      });

      // Derive the shipment number from the order's actual assigned number,
      // not from the pre-collision candidate, so retries stay aligned.
      const shipmentSuffix = String(order.order_number || '').replace('ORD', '');

      // Create shipment. Self pickup still gets one — the factory needs to know
      // there are goods waiting to be collected — but in its own status, with
      // no address to route or geocode.
      await base44.entities.DeliveryShipment.create({
        shipment_number: `SHP${shipmentSuffix}`,
        order_id: order.id,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        address: data.is_self_pickup ? '' : data.delivery_address,
        city: data.is_self_pickup ? '' : data.delivery_city,
        status: data.is_self_pickup ? 'awaiting_pickup' : 'need_scheduling',
      });

      // Create commission. An order that arrives already paid must not leave a
      // pending commission behind: OrderDetails only auto-approves on a LATER
      // payment update, so a sale paid at creation would sit pending forever.
      const alreadyPaid = data.payment_status === 'paid' || data.payment_status === 'deposit_paid';
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
        ...(alreadyPaid
          ? {
              status: 'approved',
              approved_by: effectiveUser?.email,
              approved_date: new Date().toISOString().split('T')[0],
            }
          : { status: 'pending' }),
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
          // Fill a second number the customer card doesn't have yet, never
          // replace one it does: this order's form may have been prefilled
          // from a lead, and that's no reason to overwrite the card.
          ...(data.customer_phone_2 && !existingCustomers[0].phone_2
            ? { phone_2: data.customer_phone_2 }
            : {}),
        });
      } else {
        // Create new customer
        const customer = await base44.entities.Customer.create({
          full_name: data.customer_name,
          phone: data.customer_phone,
          phone_2: data.customer_phone_2,
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
      // Send the order to the customer on WhatsApp — when the company has that
      // turned on AND money has actually been collected. An unpaid order stays
      // put and says nothing: the rep knows they took no payment, and a toast
      // per order explaining why nothing was sent is noise. Card orders land
      // here unpaid (Hyp clears after the order exists), so they wait for the
      // manual button too.
      //
      // Deliberately NOT awaited: the order is saved, the rep should move on,
      // and the send reports itself when it lands. Every branch below returns,
      // so this has to fire before them.
      if (autoSendWhatsApp && orderIsPaidEnoughToSend(order)) {
        const toastId = toast.loading('שולח את ההזמנה ללקוח בוואטסאפ...');
        sendOrderToCustomerWhatsApp(order, {
          currentUser: effectiveUser,
          isAdmin: isAdmin(effectiveUser),
        }).then((result) => {
          if (result.sent) {
            toast.success('ההזמנה נשלחה ללקוח בוואטסאפ ✓', { id: toastId });
          } else if (result.reason === 'no_phone') {
            toast.warning('אין מספר טלפון ללקוח — ההזמנה לא נשלחה בוואטסאפ', { id: toastId });
          } else {
            // Named, not swallowed: the rep has to know the customer is still
            // waiting, and where the manual button is.
            toast.error('שליחת ההזמנה בוואטסאפ נכשלה — אפשר לשלוח ידנית ממסך ההזמנה', {
              id: toastId,
              duration: 10000,
            });
          }
        });
      }

      // "בחרתי אשראי" has to end in an actual charge. The order exists now, so
      // hyp-sign has its order_id — open the Hyp iframe right here instead of
      // dumping the rep on the order page to find the payment button.
      if (wantsCardClearing) { setCreatedOrder(order); return; }
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

  // Shared with NewQuote / EditQuote so an order "speaks the same language" as
  // the quote it may have come from — and so the totals panel and the stored
  // total are the same calculation. See lib/quoteTotals.
  const calculateTotals = calculateDocumentTotals;

  // ProductItemsEditor hands back a fresh items array; recompute grand totals.
  const handleItemsChange = (newItems) => {
    setFormData(prev => ({ ...prev, items: newItems, ...calculateTotals(newItems, prev.extras) }));
  };

  const updateItem = (index, field, value) => {
    setFormData(prev => {
      const newItems = prev.items.map((item, idx) => {
        if (idx !== index) return item;
        const updatedItem = { ...item, [field]: value };
        updatedItem.total = lineGrossPreVat(updatedItem) - lineDiscountPreVat(updatedItem);
        return updatedItem;
      });
      const totals = calculateTotals(newItems, prev.extras);
      return { ...prev, items: newItems, ...totals };
    });
  };

  // ── Delivery & assembly auto-detection ──────────────────────────────────
  // What's on the order (beds / mattresses / single vs. double), and which
  // extra_charges row that implies. Both memoised: they run on every items
  // keystroke otherwise.
  const itemProfile = useMemo(() => summarizeItems(formData.items, products), [formData.items, products]);
  const recommendation = useMemo(
    () => recommendDeliveryExtras(extraCharges, itemProfile, { selfPickup: formData.is_self_pickup }),
    [extraCharges, itemProfile, formData.is_self_pickup],
  );
  // Delivery rows aren't offered at all once the customer collects the order.
  const selectableExtraCharges = useMemo(
    () => (formData.is_self_pickup ? extraCharges.filter((ec) => !isDeliveryRelatedExtra(ec.name)) : extraCharges),
    [extraCharges, formData.is_self_pickup],
  );
  const recommendedIds = useMemo(() => recommendation.extras.map((ec) => ec.id), [recommendation]);
  const recommendedKey = recommendedIds.join('|');
  // An order converted from a quote already has a price the customer has seen —
  // silently adding a delivery charge to it would change that number behind
  // their back. Recommend, never auto-add.
  const fromQuote = Boolean(quoteId);
  const needsDelivery = itemProfile.bedCount > 0 || itemProfile.mattressCount > 0;

  // Switching to self pickup drops every delivery/assembly row — the ones we
  // recommended and the ones the rep picked by hand alike. Leaving one behind
  // would bill a delivery on an order nobody delivers, which is exactly the
  // mistake this flag exists to prevent, so it's removed rather than flagged.
  const setSelfPickup = (value) => {
    if (!value) {
      setFormData((prev) => ({ ...prev, is_self_pickup: false }));
      return;
    }
    const dropped = formData.extras.filter((ex) => isDeliveryRelatedExtra(ex.name));
    if (dropped.length) {
      toast.info(
        dropped.length === 1
          ? `הוסרה שורת "${dropped[0].name}" — באיסוף עצמי אין דמי הובלה`
          : `הוסרו ${dropped.length} שורות הובלה/הרכבה — באיסוף עצמי אין דמי הובלה`,
      );
    }
    setFormData((prev) => {
      const kept = prev.extras.filter((ex) => !isDeliveryRelatedExtra(ex.name));
      return {
        ...prev,
        is_self_pickup: true,
        extras: kept,
        ...calculateTotals(prev.items, kept),
      };
    });
  };

  // Step 1 is done when we can identify the customer and — unless he's
  // collecting it himself — know where to deliver. The stepper, the "המשך"
  // button and the submit handler all read this one rule so they can't drift.
  const step1Valid = !!formData.customer_name?.trim()
    && isValidIsraeliPhone(formData.customer_phone)
    && (formData.is_self_pickup || (!!formData.delivery_city?.trim() && !!formData.delivery_address?.trim()));

  useEffect(() => {
    if (fromQuote) return;
    setFormData((prev) => {
      // Keep everything the rep added by hand; keep an auto row only while it's
      // still the recommendation (change the items → the old one goes).
      const keep = prev.extras.filter((ex) => !ex.auto_added || recommendedIds.includes(ex.extra_charge_id));
      const toAdd = recommendation.extras
        .filter((ec) => !dismissedExtraIds.includes(ec.id) && !keep.some((ex) => ex.extra_charge_id === ec.id))
        .map((ec) => ({ extra_charge_id: ec.id, name: ec.name, cost: ec.cost, auto_added: true }));
      const nextExtras = [...keep, ...toAdd];
      const unchanged = nextExtras.length === prev.extras.length
        && nextExtras.every((ex, i) => ex.extra_charge_id === prev.extras[i].extra_charge_id);
      if (unchanged) return prev;
      return { ...prev, extras: nextExtras, ...calculateTotals(prev.items, nextExtras) };
    });
    // recommendedKey stands in for recommendation.extras — same ids, same work,
    // and it keeps the effect from re-firing on every unrelated render.
  }, [recommendedKey, fromQuote, dismissedExtraIds]);

  // ── Payments taken during creation ──────────────────────────────────────
  const paidSoFar = sumPayments(formData.payments);
  const paymentStatus = calcPaymentStatus(formData.payments, formData.total);

  const recordPayment = (entry) => {
    setFormData((prev) => ({ ...prev, payments: [...(prev.payments || []), entry] }));
    setPaymentDialog({ open: false, method: 'cash' });
    toast.success('התשלום נרשם ויישמר יחד עם ההזמנה');
  };

  const removePayment = (index) => {
    setFormData((prev) => ({ ...prev, payments: prev.payments.filter((_, i) => i !== index) }));
  };

  // Card clearing is wanted when the rep marked אשראי and there's still a
  // balance left after whatever was recorded by hand.
  const wantsCardClearing = (formData.payment_terms_selection || []).includes('אשראי')
    && formData.total - paidSoFar > 0.01;

  // Picking a payment method is the rep saying how this order gets paid — so it
  // acts, instead of just tagging the order and leaving them to hunt for the
  // payment screen afterwards.
  const togglePaymentTerm = (opt) => {
    const current = formData.payment_terms_selection || [];
    const wasSelected = current.includes(opt);
    setFormData((prev) => ({
      ...prev,
      payment_terms_selection: wasSelected ? current.filter((x) => x !== opt) : [...current, opt],
    }));
    if (wasSelected) return;
    const action = TERM_ACTION[opt];
    if (action?.kind === 'record') {
      setPaymentDialog({ open: true, method: action.method });
    }
    // 'hyp' needs a saved order, so it fires from the mutation's onSuccess.
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

    // Adding it back by hand clears the "I removed this" memory.
    setDismissedExtraIds((prev) => prev.filter((id) => id !== extraCharge.id));
    setFormData(prev => {
      if (prev.extras.some((ex) => ex.extra_charge_id === extraCharge.id)) return prev;
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
    const removed = formData.extras[index];
    // Remember the removal so the auto-detection doesn't put it straight back
    // on the next items change.
    if (removed?.extra_charge_id) {
      setDismissedExtraIds((prev) => (prev.includes(removed.extra_charge_id) ? prev : [...prev, removed.extra_charge_id]));
    }
    const newExtras = formData.extras.filter((_, i) => i !== index);
    const totals = calculateTotals(formData.items, newExtras);
    setFormData(prev => ({ ...prev, extras: newExtras, ...totals }));
  };

  const toggleRecommendedExtra = (extraCharge) => {
    const idx = formData.extras.findIndex((ex) => ex.extra_charge_id === extraCharge.id);
    if (idx >= 0) removeExtra(idx);
    else addExtra(extraCharge.id);
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
    newItems[index].total = lineGrossPreVat(newItems[index]) - lineDiscountPreVat(newItems[index]);

    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const handleAddonsSelect = (index, addons) => {
    const newItems = [...formData.items];
    newItems[index].selected_addons = addons;
    newItems[index].total = lineGrossPreVat(newItems[index]) - lineDiscountPreVat(newItems[index]);

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
    // Self pickup has nowhere to deliver to, so only the name is required.
    const addressMissing = !formData.is_self_pickup
      && (!formData.delivery_city?.trim() || !formData.delivery_address?.trim());
    if (!formData.customer_name?.trim() || addressMissing) {
      setCurrentStep(1);
      toast.error(formData.is_self_pickup ? 'יש למלא שם ושם משפחה' : 'יש למלא שם ושם משפחה, עיר וכתובת למשלוח');
      return;
    }
    if (!isValidIsraeliPhone(formData.customer_phone)) {
      setCurrentStep(1);
      toast.error('מספר טלפון לא תקין. פורמט ישראלי: 05X-XXXXXXX או 0X-XXXXXXX');
      return;
    }
    // Blank rows are dropped silently; a custom line the rep priced but never
    // named is a real mistake and has to be fixed before saving.
    const items = cleanOrderItems(formData.items);
    const itemsError = validateOrderItems(items);
    if (itemsError) {
      setCurrentStep(2);
      toast.error(itemsError);
      return;
    }
    // Trial flag is derived from the products on the order, not a manual toggle.
    const trial_30d_enabled = items.some((it) => {
      const p = products.find((pp) => pp.id === it.product_id);
      return Boolean(p?.has_trial_period ?? p?.data?.has_trial_period);
    });
    const totals = calculateTotals(items, formData.extras);
    const payments = formData.payments || [];
    createOrderMutation.mutate({
      ...formData,
      items,
      ...totals,
      trial_30d_enabled,
      payments,
      payment_status: calcPaymentStatus(payments, totals.total),
    });
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
            const step2Valid = hasSellableItem(formData.items);
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
                <Label>מקור הגעה</Label>
                {/* Same option list the lead screens use, so "מוקד" means the
                    same thing on a lead and on the order it became. */}
                <Select
                  value={formData.source}
                  onValueChange={(v) => { setSourceTouched(true); setFormData({...formData, source: v}); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAD_SOURCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>שם ושם משפחה *</Label>
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
                <Label>טלפון נוסף</Label>
                <IsraeliPhoneInput
                  value={formData.customer_phone_2}
                  onChange={(value) => setFormData({...formData, customer_phone_2: value})}
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
              <div className="space-y-2">
                <Label>ת.ז.</Label>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="לא חובה"
                  value={formData.customer_id_number}
                  // Digits only — Hyp returns it that way, and an order that
                  // gets its ת.ז. from a card charge should look identical to
                  // one where the rep typed it.
                  onChange={(e) => setFormData({...formData, customer_id_number: e.target.value.replace(/\D/g, '')})}
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
            {/* Delivery or self pickup. The choice governs everything below it —
                a collected order has no address, no floor and no delivery
                charge — so it's asked before the fields it switches off. */}
            <div className="space-y-2">
              <Label>אופן אספקה</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formData.is_self_pickup ? 'outline' : 'default'}
                  className="flex-1 gap-2"
                  onClick={() => setSelfPickup(false)}
                >
                  <Truck className="h-4 w-4" />
                  משלוח
                </Button>
                <Button
                  type="button"
                  variant={formData.is_self_pickup ? 'default' : 'outline'}
                  className="flex-1 gap-2"
                  onClick={() => setSelfPickup(true)}
                >
                  <PackageCheck className="h-4 w-4" />
                  איסוף עצמי
                </Button>
              </div>
            </div>

            {formData.is_self_pickup ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">איסוף עצמי - בתיאום</p>
                <p className="text-xs mt-1 leading-relaxed">
                  הלקוח אוסף מהמפעל ברח׳ העמל 6 קרית מלאכי, בימים א׳-ה׳ בין 9:00 ל-16:00, בתיאום מראש.
                  לא נגבים דמי הובלה והרכבה, וההזמנה לא נכנסת לתכנון מסלולי החלוקה.
                </p>
              </div>
            ) : (
            <>
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
            </>
            )}
          </CardContent>
        </Card>
        )}

        {currentStep === 2 && (
        <Card className="mt-6">
          <CardContent className="pt-5">
            <ProductItemsEditor
              items={formData.items}
              onChange={handleItemsChange}
              products={products}
              variations={variations}
              addons={addons}
              addonPrices={addonPrices}
            />

            {/* Products only. The delivery extra is auto-detected the moment an
                item is added — two steps before the screen that owns it — so
                this panel used to fold a charge into the total that the rep had
                not seen, could not see, and had no way to reconcile: the total
                sat ₪250 above the price they had just set on the item.

                Passing no `total` is what keeps the two honest: summaryRows
                then works the figure out from the items and extras it was
                handed, so the amount here is exactly the products. The delivery
                joins the total on step 3, next to the row that states it and
                the control that removes it. */}
            <QuoteTotalsSummary items={formData.items} extras={[]} />
          </CardContent>
        </Card>
        )}

        {currentStep === 3 && (
        <>
        <DeliveryExtrasCard
          className="mt-6"
          extras={formData.extras}
          selectableExtraCharges={selectableExtraCharges}
          recommendation={recommendation}
          isSelfPickup={formData.is_self_pickup}
          needsDelivery={needsDelivery}
          recommendOnly={fromQuote}
          recommendOnlyLabel="מומלץ להזמנה (לא נוסף אוטומטית — ההצעה כבר תומחרה ללקוח)"
          selfPickupNote="איסוף עצמי — תוספות הובלה והרכבה אינן רלוונטיות ואינן מוצעות להזמנה זו."
          onAdd={addExtra}
          onRemove={removeExtra}
          onToggleRecommended={toggleRecommendedExtra}
        />

        {/* Payments taken now, saved together with the order. */}
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              תשלום
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPaymentDialog({ open: true, method: 'cash' })}
            >
              <Plus className="h-3.5 w-3.5 me-1.5" />
              רשום תשלום שהתקבל
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-muted/40 p-2.5">
                <p className="text-[11px] text-muted-foreground">סה״כ הזמנה</p>
                <p className="font-semibold tabular-nums">{money2(formData.total)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-2.5">
                <p className="text-[11px] text-emerald-700/80">שולם</p>
                <p className="font-semibold tabular-nums text-emerald-700">{money2(paidSoFar)}</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5">
                <p className="text-[11px] text-muted-foreground">יתרה</p>
                <p className="font-semibold tabular-nums">{money2(Math.max(0, formData.total - paidSoFar))}</p>
              </div>
            </div>

            {wantsCardClearing ? (
              <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-2.5 flex items-start gap-2 text-xs text-primary">
                <CreditCard className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                עם השמירה תיפתח סליקת Hyp על היתרה ({money2(Math.max(0, formData.total - paidSoFar))}).
              </div>
            ) : null}

            {(formData.payments || []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                לא נרשם תשלום. "רשום תשלום שהתקבל" מיועד לכסף שכבר עבר (מזומן, העברה, צ׳ק);
                חיוב אשראי נעשה בסליקת Hyp.
              </p>
            ) : (
              <div className="space-y-2">
                {formData.payments.map((payment, index) => (
                  <div key={index} className="flex items-start justify-between p-2.5 bg-muted/50 rounded-lg text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-emerald-600 tabular-nums">{money2(payment.amount)}</span>
                        <span className="text-xs text-muted-foreground">{PAYMENT_METHODS[payment.method] || payment.method}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {payment.date || ''}
                        {payment.notes ? ` · ${payment.notes}` : ''}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400 hover:text-red-600 shrink-0"
                      onClick={() => removePayment(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  סטטוס תשלום שיישמר: <span className="font-medium text-foreground">
                    {{ paid: 'שולם', deposit_paid: 'תשלום חלקי', unpaid: 'לא שולם' }[paymentStatus]}
                  </span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>אפשרויות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 30-day trial is a property of the product (shown on its row in the
                items step), not a manual order-level toggle. */}
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
              <p className="text-[11px] text-muted-foreground">
                בחר אחד או יותר. יופיע על ההזמנה. "אשראי" יפתח סליקת Hyp מיד אחרי השמירה,
                "מזומן" יפתח רישום תשלום עכשיו, ו"תשלום בבית למוביל" נגבה במסירה.
              </p>
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
                      onClick={() => togglePaymentTerm(opt)}
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
                    (currentStep === 1 && !step1Valid)
                    || (currentStep === 2 && !hasSellableItem(formData.items))
                  }
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCurrentStep(prev => Math.min(prev + 1, 3)); }}
                >
                  המשך
                </Button>
                {currentStep === 1 && !step1Valid ? (
                  <span className="text-[11px] text-muted-foreground">
                    {formData.is_self_pickup
                      ? 'יש למלא שם ושם משפחה וטלפון תקין כדי להמשיך'
                      : 'יש למלא שם ושם משפחה, טלפון תקין, עיר וכתובת למשלוח כדי להמשיך'}
                  </span>
                ) : currentStep === 2 && !hasSellableItem(formData.items) ? (
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

      {/* Same dialog the existing-order screen uses, so recording a payment is
          one experience whether the order exists yet or not. Records money that
          already changed hands — it never charges a card. */}
      <OrderPaymentDialog
        open={paymentDialog.open}
        onOpenChange={(open) => setPaymentDialog((prev) => ({ ...prev, open }))}
        total={formData.total}
        alreadyPaid={paidSoFar}
        defaultMethod={paymentDialog.method}
        recordedBy={effectiveUser?.email}
        onConfirm={recordPayment}
      />

      {/* Real clearing, on the order we just saved. Leaving the screen waits for
          this to finish either way — a cancelled charge still leaves a valid
          order the rep can collect on later. */}
      <HypPaymentDialog
        open={!!createdOrder}
        onOpenChange={(open) => {
          if (open || !createdOrder) return;
          const order = createdOrder;
          setCreatedOrder(null);
          if (asDialog && onDialogClose) onDialogClose(order);
          else navigate(createPageUrl('OrderDetails') + `?id=${order.id}`);
        }}
        order={createdOrder}
        onPaid={() => toast.success('התשלום התקבל')}
      />
    </div>
  );
}