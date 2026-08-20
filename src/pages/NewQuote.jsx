import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { findByPhoneSubstring } from '@/lib/phoneLookup';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User, UserCheck } from 'lucide-react';
import { toShareablePdfUrl } from '@/lib/pdfShareUrl';
import QuoteTotalsSummary from '@/components/quote/QuoteTotalsSummary';

// ₪ with two decimals (agorot) — keeps the totals consistent with the per-line
// amounts, which now show agorot so the parts sum exactly to the total.
const money2 = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Local form, so "0537772829", "053-777-2829", "+972537772829" and
// "972537772829" all resolve to the same lookup key.
const normalizePhoneForLookup = toLocalIsraeliPhone;
import QuotePdfGenerator from '@/components/quotes/QuotePdfGenerator';
import { PAYMENT_TERMS_OPTIONS } from '@/constants/paymentTerms';
import { QUOTE_DEFAULTS_FALLBACK } from '@/constants/quoteDefaultsFallback';
import useDocumentTermsDefaults from '@/hooks/use-document-terms';
import { customDocumentTerms } from '@/constants/documentTerms';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { ArrowRight, Save, Loader2, Check, X, Download, MessageCircle, Mail, FileText, ExternalLink, CreditCard, Shield, Lock, Truck, PackageCheck } from "lucide-react";
import { isDeliveryRelatedExtra, summarizeItems, recommendDeliveryExtras } from '@/lib/deliveryExtras';
import DeliveryExtrasCard from '@/components/quote/DeliveryExtrasCard';
import { format } from '@/lib/safe-date-fns';
import UpsellPanel from '@/components/upsell/UpsellPanel';
import ProductItemsEditor from '@/components/quote/ProductItemsEditor';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, isAdmin } from '@/lib/rbac';
import { formatPhoneForWhatsApp, isValidIsraeliPhone, toLocalIsraeliPhone } from '@/utils/phoneUtils';
import IsraeliPhoneInput from '@/components/shared/IsraeliPhoneInput';
import { createWithSequentialNumber } from '@/utils/sequentialNumber';
import { applyCrossRepReassignment } from '@/lib/crossRepReassignment';
import { calculateDocumentTotals } from '@/lib/quoteTotals';

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
    // Not typed here: it rides in from the lead and rides on to the order.
    customer_phone_2: '',
    customer_email: '',
    delivery_address: '',
    delivery_city: '',
    property_type: 'apartment',
    floor: 0,
    apartment_number: '',
    elevator_type: 'none',
    // Delivery is priced here, so the pickup decision belongs here too — it
    // rides along to the order when the quote is accepted.
    is_self_pickup: false,
    items: [],
    extras: [],
    subtotal: 0,
    discount_total: 0,
    vat_amount: 0,
    total: 0,
    valid_until: format(addBusinessDays(new Date(), 7), 'yyyy-MM-dd'),
    // The legal texts (terms / warranty_terms / notes) are seeded from the
    // company defaults via an effect below, and payment_terms_selection from
    // the QuoteDefaults singleton — all start blank so we don't flash a stale
    // hardcoded string before they arrive. `notes` is where a quote keeps the
    // general terms block; see constants/documentTerms.js.
    terms: '',
    warranty_terms: '',
    status: 'draft',
    notes: '',
    special_requests: '',
    payment_terms_selection: [],
  });

  // Phone-based lookup so a quote started from "create new quote" (no
  // existing lead context) can still snap to an existing customer / lead.
  // Skipped entirely once the form already has a hard lead_id (came from
  // a lead in the URL/dialog).
  //
  // Two perf knobs:
  //   * 150ms debounce (was 350ms) — feels real-time without DDoSing the DB.
  //   * Lookup kicks in at 4 digits (was 7) so the user gets feedback as
  //     soon as the discriminating tail of the number is typed.
  // The DB side is covered by the pg_trgm GIN indexes in
  // 20260820000001_search_trigram_indexes.sql (phone) and
  // 20260820000003_second_phone_search_indexes.sql (phone_2), so ILIKE
  // '%tail%' is no longer a full table scan. The file this used to name,
  // 20260428000001, never had a workflow and never ran.
  // Delivery/assembly rows the rep took off. Without this the auto-detection
  // puts the row straight back on the next keystroke, and removing it becomes
  // impossible.
  const [dismissedExtraIds, setDismissedExtraIds] = useState([]);
  const [debouncedPhone, setDebouncedPhone] = useState('');
  const [linkedRecord, setLinkedRecord] = useState(null); // { kind, id, full_name }
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(normalizePhoneForLookup(formData.customer_phone)), 150);
    return () => clearTimeout(t);
  }, [formData.customer_phone]);
  const phoneLookupEnabled = !leadId && debouncedPhone.length >= 4 && !linkedRecord;

  const canAccessSales = canAccessSalesWorkspace(effectiveUser);

  const { data: phoneMatchesData, isFetching: isPhoneLookupFetching } = useQuery({
    queryKey: ['quotePhoneLookup', debouncedPhone],
    enabled: phoneLookupEnabled && canAccessSales,
    staleTime: 60_000,
    // Keep the previous result on screen while the next one is loading so
    // the dropdown doesn't blink between keystrokes.
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // Both phone fields, longest available tail (up to 9 digits) — see
      // findByPhoneSubstring for why the second number is a query of its own
      // and not another branch of an OR.
      const [customers, leads] = await Promise.all([
        findByPhoneSubstring(base44.supabase, 'customers', debouncedPhone, {
          select: 'id, full_name, phone, phone_2, email, address, city',
        }),
        findByPhoneSubstring(base44.supabase, 'leads', debouncedPhone, {
          select: 'id, full_name, phone, phone_2, email, address, city, status',
        }),
      ]);
      return { customers, leads };
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
    !leadId && !linkedRecord && canAccessSales &&
    normalizedTypedPhone.length >= 4 &&
    (isPhoneLookupFetching || normalizedTypedPhone !== debouncedPhone);

  const applyPhoneMatch = (match) => {
    setFormData((prev) => ({
      ...prev,
      customer_name: match.full_name || prev.customer_name,
      customer_phone: match.phone || prev.customer_phone,
      customer_phone_2: match.phone_2 || prev.customer_phone_2,
      customer_email: match.email || prev.customer_email,
      delivery_address: match.address || prev.delivery_address,
      delivery_city: match.city || prev.delivery_city,
      // Only stamp lead_id if we matched a lead — quotes are lead-centric
      // and the existing submit flow looks up / creates a lead by phone
      // when this is empty, so a customer match is fine without it.
      lead_id: match.kind === 'lead' ? match.id : prev.lead_id,
    }));
    setLinkedRecord({ kind: match.kind, id: match.id, full_name: match.full_name });
  };

  const clearPhoneLink = () => {
    setLinkedRecord(null);
    if (!leadId) setFormData((prev) => ({ ...prev, lead_id: '' }));
  };

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

  // The company's legal texts (הגדרות ← טקסטים ותנאים, else the text in code).
  // Never empty and never errors, so step-3 always has wording to seed.
  const { defaults: termsDefaults, isLoading: termsDefaultsLoading } = useDocumentTermsDefaults();

  // Admin-editable default payment methods. Seeded into formData via the
  // effect below — only when the user hasn't touched them yet, so we never
  // stomp in-progress edits. If the query fails (table not migrated yet on
  // this env, RLS blocked, network), QUOTE_DEFAULTS_FALLBACK kicks in.
  const { data: quoteDefaults, isLoading: defaultsLoading, isError: defaultsErrored } = useQuery({
    queryKey: ['quote-defaults'],
    queryFn: async () => {
      const rows = await base44.entities.QuoteDefaults.list();
      return rows[0] || null;
    },
    enabled: canAccessSales,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [defaultsSeeded, setDefaultsSeeded] = useState(false);
  useEffect(() => {
    if (defaultsSeeded) return;
    if (defaultsLoading || termsDefaultsLoading) return;
    const src = (quoteDefaults && !defaultsErrored) ? quoteDefaults : QUOTE_DEFAULTS_FALLBACK;
    setFormData((prev) => ({
      ...prev,
      // Seeded so the rep sees (and can edit) the real wording. What's saved is
      // only the part they changed — see customDocumentTerms at save time.
      terms: prev.terms || termsDefaults.terms,
      warranty_terms: prev.warranty_terms || termsDefaults.warranty_terms,
      notes: prev.notes || termsDefaults.legal_notes,
      payment_terms_selection:
        prev.payment_terms_selection && prev.payment_terms_selection.length
          ? prev.payment_terms_selection
          : Array.isArray(src.payment_terms_selection)
            ? src.payment_terms_selection
            : [],
    }));
    setDefaultsSeeded(true);
  }, [quoteDefaults, defaultsLoading, defaultsErrored, defaultsSeeded, termsDefaults, termsDefaultsLoading]);

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
        customer_phone_2: lead.phone_2 || '',
        customer_email: lead.email || '',
        delivery_address: lead.address || '',
        delivery_city: lead.city || '',
      }));
    }
  }, [lead]);

  const createQuoteMutation = useMutation({
    mutationFn: async (data) => {
      // If no lead_id, search for existing lead by phone or create new.
      // Guard the phone-lookup branch — `Lead.filter({ phone: '' })` was
      // throwing on the server when the customer phone field was empty,
      // and the swallowed error was the root cause of "save quote does
      // nothing" before we added onError below.
      let leadId = data.lead_id;
      if (!leadId) {
        const phoneForLookup = (data.customer_phone || '').trim();
        const existingLeads = phoneForLookup
          ? await base44.entities.Lead.filter({ phone: phoneForLookup })
          : [];

        if (existingLeads.length > 0) {
          // Use existing lead
          leadId = existingLeads[0].id;
        } else {
          // Create new lead
          const newLead = await base44.entities.Lead.create({
            full_name: data.customer_name,
            phone: data.customer_phone,
            phone_2: data.customer_phone_2,
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

      // Only wording the rep actually rewrote is stored on the quote; a quote
      // carrying the standard texts keeps resolving through
      // הגדרות ← טקסטים ותנאים, so a later correction there reaches it (and
      // the order it becomes) instead of only reaching quotes written after.
      const customTerms = customDocumentTerms(
        { terms: data.terms, warranty_terms: data.warranty_terms, legal_notes: data.notes },
        termsDefaults,
      );

      // Atomically allocate a unique quote_number — fetch + insert with
      // retry-on-unique-violation so two reps saving at the same moment can't
      // collide on the same Q#### (which used to throw 23505 to the user).
      const newQuote = await createWithSequentialNumber({
        entity: base44.entities.Quote,
        numberField: 'quote_number',
        prefix: 'Q',
        startingValue: 1001,
        buildPayload: (newNumber) => ({
          ...data,
          lead_id: leadId,
          quote_number: newNumber,
          terms: customTerms.terms,
          warranty_terms: customTerms.warranty_terms,
          // A quote's general terms block lives in `notes`.
          notes: customTerms.legal_notes,
          created_by_rep: isAdmin(effectiveUser) ? (lead?.rep1 || effectiveUser?.email) : (effectiveUser?.email || lead?.rep1),
          items: data.items.map((item) => ({
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
            selected_addons: (item.selected_addons || []).map((addon) => ({
              addon_id: addon.addon_id || '',
              name: addon.name || '',
              price: addon.price || 0,
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
            bed_config_fields: item.bed_config_fields || null,
          })),
        }),
      });

      if (leadId) {
        await base44.entities.Lead.update(leadId, { status: 'followup_after_quote' });
        // Cross-rep policy: a rep who doesn't own this lead just produced a
        // quote → become secondary if the lead has an order, else take over as
        // primary. Logged to the lead history. Admins exempt.
        await applyCrossRepReassignment({
          leadId,
          actingUser: effectiveUser,
          isAdminActor: isAdmin(effectiveUser),
          sourceLabel: 'הצעת מחיר',
        });
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
    // Without this, a failed Lead lookup / Quote.create / RLS denial just
    // bounces the button back to its idle state and the page does nothing —
    // the user reported clicking "שמור הצעה" and seeing no feedback at all.
    // Surface the real PostgREST error parts so we don't have to dig in
    // DevTools to find which field broke. Mirrors the pattern in ExtraCharges.jsx.
    onError: (err) => {
      const parts = [err?.message, err?.details, err?.hint, err?.code]
        .map((p) => (p == null || p === '' ? null : String(p)))
        .filter(Boolean);
      const description = parts.length ? parts.join(' — ') : (typeof err === 'string' ? err : 'אירעה שגיאה לא ידועה');
      console.error('Quote.create failed', { message: err?.message, details: err?.details, hint: err?.hint, code: err?.code, raw: err });
      // The duplicate-key path is its own bucket — a stale tab or a heavily
      // contested moment can land here even after the retry helper. Tell
      // the user exactly what to do instead of dropping the raw PG error.
      const isDuplicateKey = err?.code === '23505' || /duplicate key|unique constraint/i.test(description);
      if (isDuplicateKey) {
        toast.error('מספר ההצעה כבר תפוס (ייתכן שנוצרה הצעה נוספת באותו רגע). אנא רענן את הדף ונסה שוב.', {
          duration: Infinity,
        });
        return;
      }
      toast.error(`שמירת ההצעה נכשלה: ${description}`, { duration: Infinity });
    },
  });

  // Shared with NewOrder / EditQuote so the three forms — and the totals panel
  // they all render — can't drift apart. See lib/quoteTotals.
  const calculateTotals = calculateDocumentTotals;

  // ProductItemsEditor hands back a fresh items array; recompute grand totals.
  const handleItemsChange = (newItems) => {
    setFormData(prev => ({ ...prev, items: newItems, ...calculateTotals(newItems, prev.extras) }));
  };

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

  // Choosing self pickup drops any delivery/assembly row already selected —
  // quoting a delivery charge on an order the customer collects himself is the
  // error this flag exists to prevent.
  const setSelfPickup = (value) => {
    if (!value) {
      setFormData(prev => ({ ...prev, is_self_pickup: false }));
      return;
    }
    const dropped = formData.extras.filter(ex => isDeliveryRelatedExtra(ex.name));
    if (dropped.length) {
      toast.info(
        dropped.length === 1
          ? `הוסרה שורת "${dropped[0].name}" — באיסוף עצמי אין דמי הובלה`
          : `הוסרו ${dropped.length} שורות הובלה/הרכבה — באיסוף עצמי אין דמי הובלה`,
      );
    }
    setFormData(prev => {
      const kept = prev.extras.filter(ex => !isDeliveryRelatedExtra(ex.name));
      return { ...prev, is_self_pickup: true, extras: kept, ...calculateTotals(prev.items, kept) };
    });
  };

  // ── Delivery & assembly auto-detection ──────────────────────────────────
  // What's on the quote (beds / mattresses / single vs. double) and which
  // extra_charges row that implies. Both rules used to live here as a private
  // copy that had already drifted from the order form's; they now come from
  // lib/deliveryExtras, which is the same module the order form reads — so a
  // quote and the order it becomes can no longer price the delivery
  // differently. Memoised: they run on every items keystroke otherwise.
  const itemProfile = useMemo(() => summarizeItems(formData.items, products), [formData.items, products]);
  // Delivery rows aren't offered at all once the customer collects the order.
  // Same list the order form's dropdown shows — the count-gating that used to
  // narrow this lives in the recommendation, which is where a bed count should
  // decide something.
  const selectableExtraCharges = useMemo(
    () => (formData.is_self_pickup ? extraCharges.filter((ec) => !isDeliveryRelatedExtra(ec.name)) : extraCharges),
    [extraCharges, formData.is_self_pickup],
  );
  const recommendation = useMemo(
    () => recommendDeliveryExtras(extraCharges, itemProfile, { selfPickup: formData.is_self_pickup }),
    [extraCharges, itemProfile, formData.is_self_pickup],
  );
  const recommendedIds = useMemo(() => recommendation.extras.map((ec) => ec.id), [recommendation]);
  const recommendedKey = recommendedIds.join('|');
  const needsDelivery = itemProfile.bedCount > 0 || itemProfile.mattressCount > 0;

  // Add the matching delivery/assembly rows the moment the products are known,
  // and drop an auto-added row again when the items change out from under it.
  // Anything the rep picked by hand is never touched, and a row they removed
  // stays removed — dismissedExtraIds is what keeps the detection from putting
  // it straight back on the next keystroke.
  useEffect(() => {
    setFormData((prev) => {
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
  }, [recommendedKey, dismissedExtraIds]);

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

  // Quote creation is intentionally open to any sales rep, including for a
  // lead they don't own (serving a walk-in). Ownership of the lead is
  // untouched; credit for the quote goes to the rep who built it
  // (created_by_rep above). Only non-sales users are turned away (canAccessSales).

  const addUpsellItem = (item) => {
    const newItems = [...formData.items, item];
    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  // Open the configurator wizard for an already-set bed line (the "edit" button):
  // ensure a token, use the bed's current config lines for prefill.
  const handleSubmit = (e) => {
    e.preventDefault();
    // Catch the obvious "user reached step 3 with empty form" case before
    // it round-trips through Supabase and surfaces as a cryptic NOT NULL
    // violation. Anything more nuanced will land in onError as a toast.
    const missing = [];
    if (!formData.customer_name?.trim()) missing.push('שם ושם משפחה');
    if (!formData.customer_phone?.trim()) missing.push('טלפון');
    if (!formData.items.some((item) => item.product_id)) missing.push('לפחות מוצר אחד');
    if (missing.length > 0) {
      toast.error(`חסרים שדות חובה: ${missing.join(', ')}`);
      // Jump back to the step that holds the missing input so the user can fix it.
      setCurrentStep(missing.includes('לפחות מוצר אחד') ? 2 : 1);
      return;
    }
    if (!isValidIsraeliPhone(formData.customer_phone)) {
      toast.error('מספר טלפון לא תקין. פורמט ישראלי: 05X-XXXXXXX או 0X-XXXXXXX');
      setCurrentStep(1);
      return;
    }
    // Save directly — no summary/confirm screen.
    createQuoteMutation.mutate(formData);
  };

  // Loading screen while saving quote — fixed min height so switching from the
  // form to this view doesn't make the dialog jump/expand.
  if (asDialog && createQuoteMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
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
    const whatsappText = encodeURIComponent(`שלום ${formData.customer_name}, מצורפת הצעת מחיר מס' ${savedQuote.quote_number} מקינג דוד.\n\nלצפייה בהצעה: ${toShareablePdfUrl(savedQuote.pdf_url) || ''}\n\nההצעה תקפה עד ${formData.valid_until ? format(new Date(formData.valid_until), 'dd/MM/yyyy') : ''}.\n\nבברכה, צוות קינג דוד`);

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
              <span className="font-semibold">{money2(formData.total)}</span>
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
                <Input placeholder="שם ושם משפחה" />
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
          <p className="text-lg font-bold text-foreground mt-1">סה״כ: {money2(formData.total)}</p>
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
                    subject: `הצעת מחיר מס׳ ${savedQuote.quote_number} - קינג דוד`,
                    body: `שלום ${formData.customer_name}, מצורפת הצעת מחיר מס׳ ${savedQuote.quote_number}.`,
                    quote_number: savedQuote.quote_number,
                    customer_name: formData.customer_name,
                    total: savedQuote.total?.toLocaleString(),
                    pdf_url: toShareablePdfUrl(savedQuote.pdf_url),
                    valid_until: formData.valid_until ? format(new Date(formData.valid_until), 'dd/MM/yyyy') : '',
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
    <div className={asDialog ? 'space-y-4' : 'max-w-6xl mx-auto space-y-6'}>
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
          {steps.map((step, idx) => {
            // Can't jump forward past an incomplete step (same rules as "המשך");
            // going back to an earlier step is always allowed.
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
                  onChange={(value) => {
                    setFormData({ ...formData, customer_phone: value });
                    if (linkedRecord) setLinkedRecord(null);
                  }}
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
                  נמצאו רשומות עם טלפון דומה — בחר כדי לקשר את ההצעה:
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
              </CardContent>
            </Card>

            {/* Products only. The delivery extra is now auto-detected the
                moment an item is added — a step before the screen that owns
                it — so passing the real extras here would fold a charge into
                this total that the rep has not seen yet and cannot reconcile
                against the price they just set on the line.

                Passing no `total` is what keeps the two honest: summaryRows
                works the figure out from the items and extras it was handed,
                so the amount here is exactly the products. The delivery joins
                the total on step 3, beside the row that states it and the
                control that removes it. Same rule as the order form. */}
            <QuoteTotalsSummary items={formData.items} extras={[]} />

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
                <CardTitle>אופן המסירה</CardTitle>
                <p className="text-sm text-muted-foreground">משלוח או איסוף עצמי — הבחירה קובעת אילו תוספות רלוונטיות</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Delivery or self pickup — the answer decides whether any of
                    the rows below apply at all, so it's asked first. */}
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

                {formData.is_self_pickup && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-medium">איסוף עצמי - בתיאום</p>
                    <p className="text-xs mt-1 leading-relaxed">
                      הלקוח אוסף מהמפעל ברח׳ העמל 6 קרית מלאכי, בימים א׳-ה׳ בין 9:00 ל-16:00, בתיאום מראש.
                      תוספות הובלה והרכבה אינן רלוונטיות ואינן מוצעות.
                    </p>
                  </div>
                )}

              </CardContent>
        </Card>

        <DeliveryExtrasCard
          extras={formData.extras}
          selectableExtraCharges={selectableExtraCharges}
          recommendation={recommendation}
          isSelfPickup={formData.is_self_pickup}
          needsDelivery={needsDelivery}
          selfPickupNote="איסוף עצמי — תוספות הובלה והרכבה אינן רלוונטיות ואינן מוצעות להצעה זו."
          onAdd={addExtra}
          onRemove={removeExtra}
          onToggleRecommended={toggleRecommendedExtra}
        />

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
              <Label className="text-sm font-medium">אחריות</Label>
              <Textarea
                value={formData.warranty_terms}
                onChange={(e) => setFormData({...formData, warranty_terms: e.target.value})}
                rows={2}
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
              {/* A quote's general terms block lives in `notes` — same text an
                  order keeps in `legal_notes`. See constants/documentTerms.js. */}
              <Label className="text-sm font-medium">תנאים כלליים</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                rows={8}
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
              {asDialog ? (
                <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-muted-foreground" onClick={onDialogClose}>ביטול</Button>
              ) : (
                <Link to={createPageUrl('Quotes')}>
                  <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-muted-foreground">ביטול</Button>
                </Link>
              )}
            </div>

            <div className="flex items-center gap-3">
              {currentStep < 3 ? (
                <>
                  <Button
                    type="button"
                    size="lg"
                    className="h-11 px-8 text-base font-semibold shadow-md hover:shadow-lg transition-shadow"
                    disabled={
                      (currentStep === 1 && (!formData.customer_name?.trim() || !isValidIsraeliPhone(formData.customer_phone)))
                      || (currentStep === 2 && !formData.items.some(item => item.product_id))
                    }
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCurrentStep(prev => Math.min(prev + 1, 3)); }}
                  >
                    המשך
                  </Button>
                  {currentStep === 1 && (!formData.customer_name?.trim() || !isValidIsraeliPhone(formData.customer_phone)) ? (
                    <span className="text-[11px] text-muted-foreground">יש למלא שם ושם משפחה וטלפון תקין כדי להמשיך</span>
                  ) : currentStep === 2 && !formData.items.some(item => item.product_id) ? (
                    <span className="text-[11px] text-muted-foreground">יש להוסיף לפחות מוצר אחד כדי להמשיך</span>
                  ) : null}
                </>
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