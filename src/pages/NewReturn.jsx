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
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Save, Loader2, Search } from "lucide-react";
import { toast } from 'sonner';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessReturnsWorkspace, canViewOrder } from '@/lib/rbac';

export default function NewReturn() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('order_id');

  const [formData, setFormData] = useState({
    order_id: orderId || '',
    customer_id: '',
    customer_name: '',
    customer_phone: '',
    reason: 'changed_mind',
    reason_details: '',
    pickup_required: true,
    pickup_address: '',
    eligibility_status: 'pending_review',
    status: 'requested',
    internal_notes: '',
  });
  const [customerOrders, setCustomerOrders] = useState([]);
  const [lookingUp, setLookingUp] = useState(false);

  const canAccessReturns = canAccessReturnsWorkspace(effectiveUser);

  // Drive the order card from whichever order is selected (URL param or picked
  // after a phone lookup), so a standalone return links to a real order too.
  const selectedOrderId = formData.order_id;
  const { data: order } = useQuery({
    queryKey: ['order', selectedOrderId],
    queryFn: () => base44.entities.Order.filter({ id: selectedOrderId }).then(res => res[0]),
    enabled: !!selectedOrderId && canAccessReturns,
  });

  // Find the customer (and their orders) by phone, and link them. Mirrors the
  // service flow: a return should be tied to the customer + the right order.
  const lookupByPhone = async () => {
    const tail = (formData.customer_phone || '').replace(/\D/g, '').slice(-9);
    if (tail.length < 7) { toast.error('הזינו מספר טלפון תקין לחיפוש'); return; }
    setLookingUp(true);
    try {
      const customers = await base44.entities.Customer.filter({ phone: { $regex: tail } }, '-created_date', 1);
      const customer = customers?.[0];
      let orders = [];
      if (customer) {
        orders = await base44.entities.Order.filter({ customer_id: customer.id }, '-created_date', 20);
      }
      if (!orders.length) {
        orders = await base44.entities.Order.filter({ customer_phone: { $regex: tail } }, '-created_date', 20);
      }
      const validOrders = (orders || []).filter((o) => {
        const n = String(o?.order_number || '').trim();
        return n && !/nan/i.test(n);
      });
      setCustomerOrders(validOrders);
      setFormData((prev) => ({
        ...prev,
        customer_id: customer?.id || validOrders[0]?.customer_id || '',
        customer_name: prev.customer_name || customer?.full_name || validOrders[0]?.customer_name || '',
        order_id: validOrders[0]?.id || prev.order_id || '',
      }));
      if (customer || validOrders.length) {
        toast.success(`נמצא לקוח${validOrders.length ? ` · ${validOrders.length} הזמנות` : ''}`);
      } else {
        toast('לא נמצא לקוח/הזמנה לטלפון הזה — אפשר להזין ידנית', { description: 'הבקשה תישמר ללא קישור' });
      }
    } catch (err) {
      console.error('[NewReturn] phone lookup failed', err);
      toast.error('החיפוש נכשל');
    } finally {
      setLookingUp(false);
    }
  };

  useEffect(() => {
    if (order) {
      setFormData(prev => ({
        ...prev,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        pickup_address: `${order.delivery_address}, ${order.delivery_city}`,
      }));
    }
  }, [order]);

  const createReturnMutation = useMutation({
    mutationFn: async (data) => {
      const returns = await base44.entities.ReturnRequest.list('-created_date', 1);
      const lastNumber = returns[0]?.return_number?.replace('RET', '') || '1000';
      const newNumber = `RET${parseInt(lastNumber) + 1}`;
      
      return base44.entities.ReturnRequest.create({
        ...data,
        order_id: data.order_id || null,
        customer_id: data.customer_id || null,
        return_number: newNumber,
      });
    },
    onSuccess: (returnReq) => {
      navigate(createPageUrl('ReturnDetails') + `?id=${returnReq.id}`);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createReturnMutation.mutate(formData);
  };

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessReturns) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור בקשת החזרה</p>
        <Link to={createPageUrl('Returns')}>
          <Button className="mt-4">חזור למסך החזרות</Button>
        </Link>
      </div>
    );
  }

  if (orderId && order && !canViewOrder(effectiveUser, order)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור החזרה להזמנה זו</p>
        <Link to={createPageUrl('Returns')}>
          <Button className="mt-4">חזור למסך החזרות</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to={createPageUrl('Returns')}>
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">בקשת החזרה חדשה</h1>
          <p className="text-muted-foreground">יצירת בקשת החזרה/זיכוי</p>
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
                <Label>שם לקוח *</Label>
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>טלפון *</Label>
                <div className="flex gap-2">
                  <Input
                    value={formData.customer_phone}
                    onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupByPhone(); } }}
                    placeholder="050-0000000"
                    dir="ltr"
                    required
                  />
                  <Button type="button" variant="outline" onClick={lookupByPhone} disabled={lookingUp} title="חפש לקוח והזמנות לפי טלפון">
                    {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {formData.customer_id && <p className="text-xs text-emerald-600">✓ מקושר ללקוח</p>}
              </div>
            </div>

            {/* Pick which order this return is for (after a phone lookup) */}
            {customerOrders.length > 0 && (
              <div className="space-y-2">
                <Label>הזמנה לקישור</Label>
                <Select value={formData.order_id || ''} onValueChange={(v) => setFormData({ ...formData, order_id: v })}>
                  <SelectTrigger><SelectValue placeholder="בחר הזמנה..." /></SelectTrigger>
                  <SelectContent>
                    {customerOrders.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        #{o.order_number}{o.total != null ? ` · ₪${Number(o.total).toLocaleString()}` : ''}{o.created_date ? ` · ${new Date(o.created_date).toLocaleDateString('he-IL')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {order && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">הזמנה מקושרת</p>
                <p className="font-semibold">#{order.order_number}</p>
                <p className="text-sm">₪{order.total?.toLocaleString()}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>סיבת ההחזרה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>סיבה *</Label>
              <Select 
                value={formData.reason} 
                onValueChange={(v) => setFormData({...formData, reason: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial_period">ניסיון 30 יום</SelectItem>
                  <SelectItem value="defect">פגם במוצר</SelectItem>
                  <SelectItem value="wrong_product">מוצר שגוי</SelectItem>
                  <SelectItem value="changed_mind">התחרטות</SelectItem>
                  <SelectItem value="size_issue">בעיית מידה</SelectItem>
                  <SelectItem value="other">אחר</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>פירוט הסיבה</Label>
              <Textarea
                value={formData.reason_details}
                onChange={(e) => setFormData({...formData, reason_details: e.target.value})}
                rows={3}
                placeholder="תאר את הסיבה להחזרה..."
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>פרטי איסוף</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={formData.pickup_required}
                onCheckedChange={(v) => setFormData({...formData, pickup_required: v})}
              />
              <Label>נדרש איסוף</Label>
            </div>
            {formData.pickup_required && (
              <div className="space-y-2">
                <Label>כתובת לאיסוף</Label>
                <AddressAutocomplete
                  value={formData.pickup_address}
                  onChange={(value) => setFormData({...formData, pickup_address: value})}
                  placeholder="התחל להקליד..."
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>הערות פנימיות</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={formData.internal_notes}
              onChange={(e) => setFormData({...formData, internal_notes: e.target.value})}
              rows={2}
              placeholder="הערות לשימוש פנימי..."
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link to={createPageUrl('Returns')}>
            <Button type="button" variant="outline">ביטול</Button>
          </Link>
          <Button 
            type="submit" 
            className="bg-primary hover:bg-primary/90"
            disabled={createReturnMutation.isPending}
          >
            {createReturnMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 me-2" />
            )}
            צור בקשת החזרה
          </Button>
        </div>
      </form>
    </div>
  );
}
