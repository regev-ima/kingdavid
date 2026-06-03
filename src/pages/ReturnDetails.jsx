import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  ArrowRight, 
  Loader2, 
  Phone, 
  MessageCircle,
  Truck,
  CheckCircle,
  DollarSign
} from "lucide-react";
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessReturnsWorkspace, canViewReturnRequest } from '@/lib/rbac';

const reasonLabels = {
  trial_period: 'ניסיון 30 יום',
  defect: 'פגם במוצר',
  wrong_product: 'מוצר שגוי',
  changed_mind: 'התחרטות',
  size_issue: 'בעיית מידה',
  other: 'אחר'
};

export default function ReturnDetails() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const returnId = urlParams.get('id');

  const canAccessReturns = canAccessReturnsWorkspace(effectiveUser);

  const { data: returnReq, isLoading } = useQuery({
    queryKey: ['return', returnId],
    queryFn: () => base44.entities.ReturnRequest.filter({ id: returnId }).then(res => res[0]),
    enabled: !!returnId && canAccessReturns,
  });

  const updateReturnMutation = useMutation({
    mutationFn: (data) => base44.entities.ReturnRequest.update(returnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['return', returnId]);
    },
  });

  // Free-text/number fields are edited locally and saved on blur — writing to
  // the DB on every keystroke (then refetching) reset the input mid-typing,
  // which is why the refund amount couldn't be typed.
  const [form, setForm] = useState({ refund_amount: '', internal_notes: '', inspection_notes: '' });
  useEffect(() => {
    if (returnReq) {
      setForm({
        refund_amount: returnReq.refund_amount ?? '',
        internal_notes: returnReq.internal_notes ?? '',
        inspection_notes: returnReq.inspection_notes ?? '',
      });
    }
    // Re-init only when the record itself changes, so saves+refetches don't
    // clobber what the rep is currently typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnReq?.id]);
  const saveField = (field, value) => {
    if ((returnReq?.[field] ?? '') !== value) updateReturnMutation.mutate({ [field]: value });
  };

  // The customer's orders, so a return can be linked to the right order even
  // when the customer has several (by customer_id, falling back to phone).
  const phoneTail = (returnReq?.customer_phone || '').replace(/\D/g, '').slice(-9);
  const { data: customerOrders = [] } = useQuery({
    queryKey: ['return-customer-orders', returnReq?.customer_id, phoneTail],
    enabled: !!returnReq && canAccessReturns && (!!returnReq.customer_id || phoneTail.length >= 7),
    queryFn: async () => {
      let orders = [];
      if (returnReq.customer_id) orders = await base44.entities.Order.filter({ customer_id: returnReq.customer_id }, '-created_date', 20);
      if (!orders.length && phoneTail.length >= 7) orders = await base44.entities.Order.filter({ customer_phone: { $regex: phoneTail } }, '-created_date', 20);
      return (orders || []).filter((o) => { const n = String(o?.order_number || '').trim(); return n && !/nan/i.test(n); });
    },
  });

  if (isLoadingUser || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canAccessReturns) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בהחזרות</p>
        <Link to={createPageUrl('Returns')}>
          <Button className="mt-4">חזור לרשימת ההחזרות</Button>
        </Link>
      </div>
    );
  }

  if (!returnReq) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">בקשת ההחזרה לא נמצאה</p>
        <Link to={createPageUrl('Returns')}>
          <Button className="mt-4">חזור לרשימת ההחזרות</Button>
        </Link>
      </div>
    );
  }

  if (!canViewReturnRequest(effectiveUser, returnReq)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בבקשת ההחזרה הזו</p>
        <Link to={createPageUrl('Returns')}>
          <Button className="mt-4">חזור לרשימת ההחזרות</Button>
        </Link>
      </div>
    );
  }

  const handleCall = () => {
    if (returnReq?.customer_phone) {
      window.open(`tel:${returnReq.customer_phone}`, '_self');
    }
  };

  const handleWhatsApp = () => {
    const phone = (returnReq?.customer_phone || '').replace(/[^0-9]/g, '');
    if (phone) {
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}`, '_blank');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Returns')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">החזרה #{returnReq.return_number}</h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={returnReq.status} />
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleCall}>
            <Phone className="h-4 w-4 me-2" />
            התקשר
          </Button>
          <Button variant="outline" onClick={handleWhatsApp} className="[&_svg]:text-green-600">
            <MessageCircle className="h-4 w-4 me-2" />
            WhatsApp
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Return Info */}
          <Card>
            <CardHeader>
              <CardTitle>פרטי ההחזרה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">לקוח</p>
                  <p className="font-medium">{returnReq.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">טלפון</p>
                  <p className="font-medium">{returnReq.customer_phone}</p>
                </div>
              </div>
              
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">סיבת ההחזרה</p>
                <p className="font-medium text-lg">{reasonLabels[returnReq.reason]}</p>
                {returnReq.reason_details && (
                  <p className="text-muted-foreground mt-2">{returnReq.reason_details}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pickup */}
          {returnReq.pickup_required && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  איסוף
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>סטטוס איסוף</Label>
                  <Select
                    value={returnReq.pickup_status}
                    onValueChange={(val) => updateReturnMutation.mutate({ pickup_status: val })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_scheduled">לא מתואם</SelectItem>
                      <SelectItem value="scheduled">מתואם</SelectItem>
                      <SelectItem value="picked_up">נאסף</SelectItem>
                      <SelectItem value="cancelled">בוטל</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>כתובת לאיסוף</Label>
                  <AddressAutocomplete
                    value={returnReq.pickup_address || ''}
                    onChange={(value) => updateReturnMutation.mutate({ pickup_address: value })}
                    placeholder="התחל להקליד..."
                  />
                </div>

                <div className="space-y-2">
                  <Label>תאריך איסוף</Label>
                  <Input
                    type="date"
                    value={returnReq.pickup_date || ''}
                    onChange={(e) => updateReturnMutation.mutate({ pickup_date: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inspection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                בדיקה
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>סטטוס החזרה למלאי</Label>
                <Select
                  value={returnReq.restocking_status}
                  onValueChange={(val) => updateReturnMutation.mutate({ restocking_status: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_applicable">לא רלוונטי</SelectItem>
                    <SelectItem value="pending_inspection">ממתין לבדיקה</SelectItem>
                    <SelectItem value="approved">מאושר</SelectItem>
                    <SelectItem value="rejected">נדחה</SelectItem>
                    <SelectItem value="restocked">הוחזר למלאי</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>הערות בדיקה</Label>
                <Textarea
                  value={form.inspection_notes}
                  onChange={(e) => setForm((p) => ({ ...p, inspection_notes: e.target.value }))}
                  onBlur={() => saveField('inspection_notes', form.inspection_notes)}
                  rows={3}
                  placeholder="תוצאות הבדיקה..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Internal Notes */}
          <Card>
            <CardHeader>
              <CardTitle>הערות פנימיות</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={form.internal_notes}
                onChange={(e) => setForm((p) => ({ ...p, internal_notes: e.target.value }))}
                onBlur={() => saveField('internal_notes', form.internal_notes)}
                rows={3}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>סטטוס כללי</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={returnReq.status}
                onValueChange={(val) => updateReturnMutation.mutate({ status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="requested">התקבלה בקשה</SelectItem>
                  <SelectItem value="eligible">זכאי</SelectItem>
                  <SelectItem value="pickup_scheduled">איסוף מתואם</SelectItem>
                  <SelectItem value="received">התקבל</SelectItem>
                  <SelectItem value="inspected">נבדק</SelectItem>
                  <SelectItem value="refund_approved">זיכוי מאושר</SelectItem>
                  <SelectItem value="refund_paid">זיכוי שולם</SelectItem>
                  <SelectItem value="closed">סגור</SelectItem>
                  <SelectItem value="rejected">נדחה</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Eligibility */}
          <Card>
            <CardHeader>
              <CardTitle>זכאות</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={returnReq.eligibility_status}
                onValueChange={(val) => updateReturnMutation.mutate({ eligibility_status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending_review">בבדיקה</SelectItem>
                  <SelectItem value="eligible">זכאי</SelectItem>
                  <SelectItem value="not_eligible">לא זכאי</SelectItem>
                  <SelectItem value="partial_eligible">זכאי חלקית</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Refund */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                זיכוי
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>סוג זיכוי</Label>
                <Select
                  value={returnReq.refund_type || ''}
                  onValueChange={(val) => updateReturnMutation.mutate({ refund_type: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר סוג" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">מלא</SelectItem>
                    <SelectItem value="partial">חלקי</SelectItem>
                    <SelectItem value="exchange">החלפה</SelectItem>
                    <SelectItem value="credit">זיכוי לקוח</SelectItem>
                    <SelectItem value="none">ללא</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>סכום זיכוי</Label>
                <Input
                  type="number"
                  value={form.refund_amount}
                  onChange={(e) => setForm((p) => ({ ...p, refund_amount: e.target.value }))}
                  onBlur={() => saveField('refund_amount', form.refund_amount === '' ? null : parseFloat(form.refund_amount))}
                  placeholder="₪"
                />
              </div>

              <div className="space-y-2">
                <Label>סטטוס זיכוי</Label>
                <Select
                  value={returnReq.refund_status}
                  onValueChange={(val) => updateReturnMutation.mutate({ refund_status: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">ממתין</SelectItem>
                    <SelectItem value="approved">מאושר</SelectItem>
                    <SelectItem value="paid">שולם</SelectItem>
                    <SelectItem value="rejected">נדחה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Linked order — pick / change among the customer's orders */}
          <Card>
            <CardHeader>
              <CardTitle>הזמנה מקושרת</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customerOrders.length > 0 ? (
                <Select
                  value={returnReq.order_id || ''}
                  onValueChange={(val) => updateReturnMutation.mutate({ order_id: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר הזמנה..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customerOrders.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        #{o.order_number}{o.total != null ? ` · ₪${Number(o.total).toLocaleString()}` : ''}{o.created_date ? ` · ${new Date(o.created_date).toLocaleDateString('he-IL')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">לא נמצאו הזמנות מקושרות ללקוח זה.</p>
              )}
              {returnReq.order_id && (
                <Link
                  to={createPageUrl('OrderDetails') + `?id=${returnReq.order_id}`}
                  className="text-primary hover:underline text-sm inline-block"
                >
                  צפה בהזמנה
                </Link>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
