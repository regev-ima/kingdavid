import React, { useState, useEffect } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Save, Loader2, Plus, Trash2 } from "lucide-react";
import { productMatchesBedType } from '@/utils/bedType';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import ProductSelector from '@/components/quote/ProductSelector';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canAccessSalesWorkspace, canViewLead, canViewQuote } from '@/lib/rbac';

export default function NewOrder() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const urlParams = new URLSearchParams(window.location.search);
  const quoteId = urlParams.get('quote_id');
  const leadId = urlParams.get('leadId');
  const customerId = urlParams.get('customerId');

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
    items: [{ sku: '', name: '', product_id: '', variation_id: '', quantity: 1, unit_price: 0, total: 0, selected_addons: [] }],
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
      // Generate order number
      const orders = await base44.entities.Order.list('-created_date', 1);
      const lastNumber = orders[0]?.order_number?.replace('ORD', '') || '10000';
      const newNumber = `ORD${parseInt(lastNumber) + 1}`;
      
      const order = await base44.entities.Order.create({
        ...data,
        order_number: newNumber,
        rep1: quote?.created_by_rep || lead?.rep1 || quoteLead?.rep1 || effectiveUser?.email,
      });

      // Create shipment
      await base44.entities.DeliveryShipment.create({
        shipment_number: `SHP${parseInt(lastNumber) + 1}`,
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
        order_number: newNumber,
        rep1: quote?.created_by_rep || lead?.rep1 || quoteLead?.rep1 || effectiveUser?.email,
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
      }
      
      return order;
    },
    onSuccess: (order) => {
      navigate(createPageUrl('OrderDetails') + `?id=${order.id}`);
    },
  });

  const calculateTotals = (items, extras = []) => {
    const itemsTotal = items.reduce((sum, item) => {
      const addonsTotal = (item.selected_addons || []).reduce((addonSum, addon) => addonSum + (addon.price || 0), 0);
      return sum + (item.quantity * (item.unit_price + addonsTotal));
    }, 0);
    const extrasTotal = extras.reduce((sum, extra) => sum + (extra.cost || 0), 0);
    const subtotal = itemsTotal + extrasTotal;
    const vat_amount = Math.round(subtotal * 0.18);
    const total = Math.round(subtotal + vat_amount);
    return { subtotal, vat_amount, total };
  };

  const updateItem = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = value;
    
    if (field === 'quantity' || field === 'unit_price') {
      const addonsTotal = (newItems[index].selected_addons || []).reduce((sum, addon) => sum + (addon.price || 0), 0);
      newItems[index].total = newItems[index].quantity * (newItems[index].unit_price + addonsTotal);
    }
    
    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const accessLead = lead || quoteLead;
  const leadsById = buildLeadsById(accessLead ? [accessLead] : []);

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

  if (leadId && lead && !canViewLead(effectiveUser, lead)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור הזמנה לליד זה</p>
        <Link to={createPageUrl('Orders')}>
          <Button className="mt-4">חזור להזמנות</Button>
        </Link>
      </div>
    );
  }

  if (quoteId && quote && !canViewQuote(effectiveUser, quote, leadsById)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור הזמנה מהצעת מחיר זו</p>
        <Link to={createPageUrl('Orders')}>
          <Button className="mt-4">חזור להזמנות</Button>
        </Link>
      </div>
    );
  }

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
      items: [...prev.items, { sku: '', name: '', product_id: '', variation_id: '', quantity: 1, unit_price: 0, total: 0, selected_addons: [] }]
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
    newItems[index].total = newItems[index].quantity * newItems[index].unit_price;
    
    const totals = calculateTotals(newItems, formData.extras);
    setFormData(prev => ({ ...prev, items: newItems, ...totals }));
  };

  const handleAddonsSelect = (index, addons) => {
    const newItems = [...formData.items];
    newItems[index].selected_addons = addons;
    
    const basePrice = newItems[index].unit_price;
    const addonsTotal = addons.reduce((sum, addon) => sum + (addon.price || 0), 0);
    newItems[index].total = newItems[index].quantity * (basePrice + addonsTotal);
    
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
    createOrderMutation.mutate(formData);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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

      <form onSubmit={handleSubmit}>
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

        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>פריטים</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 me-2" />
              הוסף פריט
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">מוצר</TableHead>
                  <TableHead className="text-right w-32">מק״ט</TableHead>
                  <TableHead className="text-right w-24">כמות</TableHead>
                  <TableHead className="text-right w-32">מחיר</TableHead>
                  <TableHead className="text-right w-32">סה"כ</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formData.items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="space-y-2">
                        <ProductSelector
                          products={products}
                          variations={variations}
                          value={item.product_id}
                          selectedVariationId={item.variation_id}
                          onSelect={(val) => selectProduct(index, val)}
                          onVariationSelect={(variation) => handleVariationSelect(index, variation)}
                          placeholder="בחר מוצר ומידות"
                        />
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
                                <div className="mt-3 space-y-2">
                                  <Label className="text-xs text-muted-foreground">תוספות למוצר</Label>
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
                                          className="text-xs"
                                        >
                                          {addon.name} (₪{finalAddonPrice?.toLocaleString()})
                                        </Button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground" dir="ltr">{item.sku || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">₪{item.unit_price?.toLocaleString()}</div>
                        {item.selected_addons && item.selected_addons.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            +₪{item.selected_addons.reduce((sum, a) => sum + (a.price || 0), 0).toLocaleString()} תוספות
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">
                      ₪{item.total?.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {formData.items.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(index)}
                          className="text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-6 flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">סכום ביניים:</span>
                  <span>₪{formData.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">מע"מ (18%):</span>
                  <span>₪{formData.vat_amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>סה"כ לתשלום:</span>
                  <span>₪{formData.total.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

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
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link to={createPageUrl('Orders')}>
            <Button type="button" variant="outline">ביטול</Button>
          </Link>
          <Button 
            type="submit" 
            className="bg-primary hover:bg-primary/90"
            disabled={createOrderMutation.isPending}
          >
            {createOrderMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 me-2" />
            )}
            צור הזמנה
          </Button>
        </div>
      </form>
    </div>
  );
}