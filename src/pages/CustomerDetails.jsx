import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DataTable from '@/components/shared/DataTable';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import RepCard from '@/components/lead/RepCard';
import {
  ArrowRight,
  Phone,
  Mail,
  MessageCircle,
  Crown,
  ShoppingCart,
  FileText,
  Save,
  Loader2,
  Plus,
  User as UserIcon,
} from "lucide-react";
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canViewCustomer, canEditPrimaryRep, canEditSecondaryRep } from '@/lib/rbac';
import { createCustomerAuditLog } from '@/utils/auditLog';

export default function CustomerDetails() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const customerId = urlParams.get('id');

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => base44.entities.Customer.filter({ id: customerId }).then(res => res[0]),
    enabled: !!customerId,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['customer-orders', customerId],
    queryFn: () => base44.entities.Order.filter({ customer_id: customerId }),
    enabled: !!customerId,
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ['customer-quotes', customer?.lead_id],
    queryFn: () => base44.entities.Quote.filter({ lead_id: customer.lead_id }),
    enabled: !!customer?.lead_id,
  });

  const { data: lead = null } = useQuery({
    queryKey: ['customer-access-lead', customer?.lead_id],
    queryFn: () => base44.entities.Lead.filter({ id: customer.lead_id }).then(res => res[0] || null),
    enabled: !!customer?.lead_id,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
  });

  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (customer) {
      setFormData(customer);
    }
  }, [customer]);

  const updateCustomerMutation = useMutation({
    mutationFn: (data) => base44.entities.Customer.update(customerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customer', customerId]);
      setIsEditing(false);
    },
  });

  const logRepChanges = async (nextData) => {
    if (!customer) return;
    const repFields = {
      account_manager: 'נציג ראשי',
      rep2: 'נציג משני',
    };
    for (const [field, label] of Object.entries(repFields)) {
      const before = customer[field] || null;
      const after = nextData[field] || null;
      if (before === after) continue;
      await createCustomerAuditLog({
        customerId: customer.id,
        actionType: 'rep_changed',
        description: `${effectiveUser?.full_name || effectiveUser?.email || 'משתמש'} שינה ${label}: "${before || '(ריק)'}" → "${after || '(ריק)'}"`,
        user: effectiveUser,
        fieldName: field,
        oldValue: before,
        newValue: after,
      });
    }
  };

  const handleSave = async () => {
    await logRepChanges(formData);
    updateCustomerMutation.mutate(formData);
  };

  const handleCall = () => {
    if (customer?.phone) {
      window.open(`tel:${customer.phone}`, '_self');
    }
  };

  const handleWhatsApp = () => {
    const phone = (customer?.phone || '').replace(/[^0-9]/g, '');
    if (phone) {
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}`, '_blank');
    }
  };

  const handleEmail = () => {
    if (customer?.email) {
      window.open(`mailto:${customer.email}`, '_blank');
    }
  };

  if (isLoadingUser || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הלקוח לא נמצא</p>
        <Link to={createPageUrl('Customers')}>
          <Button className="mt-4">חזור לרשימת הלקוחות</Button>
        </Link>
      </div>
    );
  }

  if (!canViewCustomer(effectiveUser, customer, {
    leadsById: buildLeadsById(lead ? [lead] : []),
    ordersByCustomerId: customer ? { [customer.id]: orders } : {},
  })) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בלקוח זה</p>
        <Link to={createPageUrl('Customers')}>
          <Button className="mt-4">חזור לרשימת הלקוחות</Button>
        </Link>
      </div>
    );
  }

  const canEditRep1 = canEditPrimaryRep(effectiveUser);
  const canEditRep2 = canEditSecondaryRep(effectiveUser, customer);
  const salesReps = users.filter((u) => u.role === 'user' || u.role === 'admin');

  const handleQuickAssignRep1 = async (email) => {
    const before = customer.account_manager || null;
    await createCustomerAuditLog({
      customerId: customer.id,
      actionType: 'rep_assigned',
      description: `${effectiveUser?.full_name || effectiveUser?.email || 'משתמש'} שייך נציג ראשי: "${before || '(ריק)'}" → "${email || '(ריק)'}"`,
      user: effectiveUser,
      fieldName: 'account_manager',
      oldValue: before,
      newValue: email,
    });
    updateCustomerMutation.mutate({ account_manager: email });
  };

  const handleQuickAssignRep2 = async (email) => {
    const before = customer.rep2 || null;
    await createCustomerAuditLog({
      customerId: customer.id,
      actionType: 'rep_assigned',
      description: `${effectiveUser?.full_name || effectiveUser?.email || 'משתמש'} שייך נציג משני: "${before || '(ריק)'}" → "${email || '(ריק)'}"`,
      user: effectiveUser,
      fieldName: 'rep2',
      oldValue: before,
      newValue: email,
    });
    updateCustomerMutation.mutate({ rep2: email });
  };

  const orderColumns = [
    {
      key: 'order_number',
      label: 'הזמנה',
      render: (order) => (
        <Link to={createPageUrl('OrderDetails') + `?id=${order.id}`} className="text-primary hover:underline font-medium">
          #{order.order_number}
        </Link>
      )
    },
    {
      key: 'created_date',
      label: 'תאריך',
      render: (order) => formatInTimeZone(new Date(order.created_date), 'Asia/Jerusalem', 'dd/MM/yyyy')
    },
    {
      key: 'total',
      label: 'סכום',
      render: (order) => <span className="font-semibold">₪{order.total?.toLocaleString()}</span>
    },
    {
      key: 'payment_status',
      label: 'תשלום',
      render: (order) => <Badge>{order.payment_status}</Badge>
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Customers')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{customer.full_name}</h1>
              {customer.vip_status && <Crown className="h-6 w-6 text-yellow-500" />}
            </div>
            <p className="text-muted-foreground">{customer.phone}</p>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {/* Primary CTA: start a new order pre-filled with this customer's details.
              NewOrder reads `customerId` from the URL and auto-fills name/phone/
              email/delivery address so repeat orders don't require retyping. */}
          <Link to={createPageUrl('NewOrder') + `?customerId=${customer.id}`}>
            <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700">
              <Plus className="h-4 w-4 me-2" />
              הזמנה חדשה
            </Button>
          </Link>
          <Button variant="outline" onClick={handleCall}>
            <Phone className="h-4 w-4 me-2" />
            התקשר
          </Button>
          <Button variant="outline" onClick={handleWhatsApp} className="[&_svg]:text-green-600">
            <MessageCircle className="h-4 w-4 me-2" />
            WhatsApp
          </Button>
          {customer.email && (
            <Button variant="outline" onClick={handleEmail} className="text-primary">
              <Mail className="h-4 w-4 me-2" />
              אימייל
            </Button>
          )}
          {customer.lead_id && (
            <Link to={createPageUrl('LeadDetails') + `?id=${customer.lead_id}`}>
              <Button variant="outline">צפה בליד המקורי</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">סה"כ הזמנות</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{customer.total_orders || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">הכנסות</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">₪{(customer.total_revenue || 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">LTV</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">₪{(customer.lifetime_value || 0).toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          {/* Customer Details */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>פרטי לקוח</CardTitle>
              {!isEditing ? (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  ערוך
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                    ביטול
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={handleSave}
                    disabled={updateCustomerMutation.isPending}
                  >
                    {updateCustomerMutation.isPending ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 me-2" />
                    )}
                    שמור
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>שם מלא</Label>
                  {isEditing ? (
                    <Input
                      value={formData.full_name || ''}
                      onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                    />
                  ) : (
                    <p className="text-sm">{customer.full_name}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>טלפון</Label>
                  {isEditing ? (
                    <Input
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    />
                  ) : (
                    <p className="text-sm">{customer.phone}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>אימייל</Label>
                  {isEditing ? (
                    <Input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                    />
                  ) : (
                    <p className="text-sm">{customer.email || '-'}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>עיר</Label>
                  {isEditing ? (
                    <Input
                      value={formData.city || ''}
                      onChange={(e) => setFormData({...formData, city: e.target.value})}
                    />
                  ) : (
                    <p className="text-sm">{customer.city || '-'}</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>כתובת</Label>
                {isEditing ? (
                  <AddressAutocomplete
                    value={formData.address || ''}
                    onChange={(value, details) => {
                      setFormData((prev) => ({
                        ...prev,
                        address: value,
                        ...(details?.city ? { city: details.city } : {}),
                      }));
                    }}
                    placeholder="התחל להקליד..."
                  />
                ) : (
                  <p className="text-sm">{customer.address || '-'}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>הערות</Label>
                {isEditing ? (
                  <Textarea
                    value={formData.notes || ''}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    rows={3}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{customer.notes || '-'}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Orders */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                הזמנות ({orders.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={orderColumns}
                data={orders}
                emptyMessage="אין הזמנות ללקוח זה"
              />
            </CardContent>
          </Card>

          {/* Quotes */}
          {quotes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  הצעות מחיר ({quotes.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {quotes.map(quote => (
                    <Link 
                      key={quote.id}
                      to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                    >
                      <div>
                        <p className="font-medium">#{quote.quote_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatInTimeZone(new Date(quote.created_date), 'Asia/Jerusalem', 'dd/MM/yyyy')}
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="font-semibold">₪{quote.total?.toLocaleString()}</p>
                        <Badge variant="outline">{quote.status}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* VIP Status */}
          <Card>
            <CardHeader>
              <CardTitle>סטטוס VIP</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-yellow-500" />
                  <span>לקוח VIP</span>
                </div>
                <Switch
                  checked={formData.vip_status || false}
                  onCheckedChange={(checked) => {
                    setFormData({...formData, vip_status: checked});
                    updateCustomerMutation.mutate({ vip_status: checked });
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Rep Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="h-4 w-4 text-muted-foreground" />
                שיוך נציגים
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isEditing && (canEditRep1 || canEditRep2) ? (
                <div className="space-y-3">
                  {canEditRep1 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">נציג ראשי</Label>
                      <Select
                        value={formData.account_manager || ''}
                        onValueChange={(value) => setFormData({ ...formData, account_manager: value })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>ללא שיוך</SelectItem>
                          {salesReps.map((rep) =>
                            <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {canEditRep2 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">נציג משני</Label>
                      <Select
                        value={formData.rep2 || ''}
                        onValueChange={(value) => setFormData({ ...formData, rep2: value })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>ללא</SelectItem>
                          {salesReps.map((rep) =>
                            <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <RepCard
                    label="נציג ראשי"
                    rep={customer.account_manager
                      ? (salesReps.find((r) => r.email === customer.account_manager) || { email: customer.account_manager, full_name: customer.account_manager.split('@')[0] })
                      : null}
                    isEmpty={!customer.account_manager && !customer.pending_rep_email}
                    canEdit={canEditRep1}
                    salesReps={salesReps}
                    onAssign={handleQuickAssignRep1}
                    isPending={updateCustomerMutation.isPending}
                  />
                  <RepCard
                    label="נציג משני"
                    rep={customer.rep2 ? salesReps.find((r) => r.email === customer.rep2) : null}
                    isEmpty={!customer.rep2}
                    canEdit={canEditRep2}
                    salesReps={salesReps}
                    onAssign={handleQuickAssignRep2}
                    isPending={updateCustomerMutation.isPending}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>ציר זמן</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-primary"></div>
                <div>
                  <p className="font-medium">הפך ללקוח</p>
                  <p className="text-muted-foreground">
                    {customer.first_order_date ? formatInTimeZone(new Date(customer.first_order_date), 'Asia/Jerusalem', 'dd/MM/yyyy') : '-'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40"></div>
                <div>
                  <p className="font-medium">לקוח נוצר</p>
                  <p className="text-muted-foreground">{formatInTimeZone(new Date(customer.created_date), 'Asia/Jerusalem', 'dd/MM/yyyy')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}