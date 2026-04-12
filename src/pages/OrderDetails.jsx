import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import {
  ArrowRight,
  Loader2,
  Phone,
  MessageCircle,
  Truck,
  Factory,
  RotateCcw,
  Plus,
  Trash2,
  Wallet,
  Headphones
} from "lucide-react";
import { format } from 'date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canViewOrder, isAdmin as isAdminUser } from '@/lib/rbac';
import NewServiceTicketDialog from '@/components/support/NewServiceTicketDialog';

const PAYMENT_METHODS = {
  cash: 'מזומן',
  credit_card: 'כרטיס אשראי',
  bank_transfer: 'העברה בנקאית',
  check: 'צ\'ק',
  bit: 'ביט',
  paybox: 'פייבוקס',
  other: 'אחר',
};

function calcPaymentStatus(payments, total) {
  const totalPaid = (payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  if (totalPaid <= 0) return 'unpaid';
  if (totalPaid >= total) return 'paid';
  return 'deposit_paid';
}

export default function OrderDetails() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showServiceTicket, setShowServiceTicket] = useState(false);
  const [newPayment, setNewPayment] = useState({
    amount: '',
    method: 'credit_card',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('id');

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => base44.entities.Order.filter({ id: orderId }).then(res => res[0]),
    enabled: !!orderId,
  });

  const { data: customer } = useQuery({
    queryKey: ['customer', order?.customer_id],
    queryFn: () => base44.entities.Customer.filter({ id: order.customer_id }).then(res => res[0]),
    enabled: !!order?.customer_id,
  });

  const { data: shipment } = useQuery({
    queryKey: ['shipment', orderId],
    queryFn: () => base44.entities.DeliveryShipment.filter({ order_id: orderId }).then(res => res[0]),
    enabled: !!orderId,
  });

  const { data: commission } = useQuery({
    queryKey: ['commission', orderId],
    queryFn: () => base44.entities.Commission.filter({ order_id: orderId }).then(res => res[0]),
    enabled: !!orderId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
  });

  const updateOrderMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.Order.update(orderId, data);
      
      // Auto-approve commission when payment is made
      if ((data.payment_status === 'paid' || data.payment_status === 'deposit_paid') && commission && commission.status === 'pending') {
        await base44.entities.Commission.update(commission.id, { 
          status: 'approved',
          approved_by: user?.email,
          approved_date: new Date().toISOString().split('T')[0]
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['order', orderId]);
      queryClient.invalidateQueries(['commission', orderId]);
    },
  });

  const isAdmin = isAdminUser(effectiveUser);

  if (isLoadingUser || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">ההזמנה לא נמצאה</p>
        <Link to={createPageUrl('Orders')}>
          <Button className="mt-4">חזור לרשימת ההזמנות</Button>
        </Link>
      </div>
    );
  }

  if (!canViewOrder(effectiveUser, order)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בהזמנה זו</p>
        <Link to={createPageUrl('Orders')}>
          <Button className="mt-4">חזור לרשימת ההזמנות</Button>
        </Link>
      </div>
    );
  }

  const handleCall = () => {
    if (order?.customer_phone) {
      window.open(`tel:${order.customer_phone}`, '_self');
    }
  };

  const handleWhatsApp = () => {
    const phone = (order?.customer_phone || '').replace(/[^0-9]/g, '');
    if (phone) {
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}`, '_blank');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Orders')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">הזמנה #{order.order_number}</h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={order.payment_status} />
              <StatusBadge status={order.production_status} />
              <StatusBadge status={order.delivery_status} />
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
          <Button variant="outline" onClick={() => setShowServiceTicket(true)}>
            <Headphones className="h-4 w-4 me-2" />
            קריאת שירות
          </Button>
          <Link to={createPageUrl('NewReturn') + `?order_id=${orderId}`}>
            <Button variant="outline">
              <RotateCcw className="h-4 w-4 me-2" />
              בקשת החזרה
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Order Info */}
          <Card>
            <CardHeader>
              <CardTitle>פרטי הזמנה</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold">פרטי לקוח</h4>
                    {customer && (
                      <Link to={createPageUrl('CustomerDetails') + `?id=${customer.id}`}>
                        <Button variant="ghost" size="sm" className="text-primary">
                          פרופיל לקוח
                        </Button>
                      </Link>
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-muted-foreground">שם:</span> {order.customer_name}</p>
                    <p><span className="text-muted-foreground">טלפון:</span> {order.customer_phone}</p>
                    <p><span className="text-muted-foreground">אימייל:</span> {order.customer_email || '-'}</p>
                    {customer && (
                      <>
                        <p><span className="text-muted-foreground">סה"כ הזמנות:</span> {customer.total_orders}</p>
                        <p><span className="text-muted-foreground">LTV:</span> ₪{customer.lifetime_value?.toLocaleString()}</p>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">כתובת למשלוח</h4>
                  <div className="space-y-2 text-sm">
                    <p>{order.delivery_address}</p>
                    <p>{order.delivery_city}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>פריטים</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">מוצר</TableHead>
                    <TableHead className="text-right">מק״ט</TableHead>
                    <TableHead className="text-right">כמות</TableHead>
                    <TableHead className="text-right">מחיר</TableHead>
                    <TableHead className="text-right">סה"כ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items?.map((item, idx) => {
                    const addonsTotal = (item?.selected_addons || []).reduce((sum, addon) => sum + (addon?.price || 0), 0);
                    const hasAddons = (item?.selected_addons || []).length > 0;
                    
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <p className="font-medium">{item.name}</p>
                          {item.length_cm && item.width_cm && (
                            <p className="text-xs text-primary mt-0.5">
                              {item.length_cm}×{item.width_cm}{item.height_cm ? `×${item.height_cm}` : ''} ס"מ
                            </p>
                          )}
                          {hasAddons && (
                            <div className="text-xs text-primary mt-1 space-y-0.5">
                              <p className="font-medium">תוספות:</p>
                              {item.selected_addons.map((a, i) => (
                                <p key={i}>• {a.name} (+₪{a.price?.toLocaleString()})</p>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground" dir="ltr">{item.sku || '-'}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>
                          <div>
                            <div>₪{item.unit_price?.toLocaleString()}</div>
                            {addonsTotal > 0 && (
                              <div className="text-xs text-muted-foreground">+₪{addonsTotal.toLocaleString()} תוספות</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">₪{item.total?.toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              
              <div className="mt-4 pt-4 border-t space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">סכום ביניים</span>
                  <span>₪{order.subtotal?.toLocaleString()}</span>
                </div>
                {order.discount_total > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>הנחות</span>
                    <span>-₪{order.discount_total?.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">מע"מ</span>
                  <span>₪{order.vat_amount?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>סה"כ</span>
                  <span>₪{order.total?.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>הערות</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>הערות מכירות</Label>
                <Textarea
                  value={order.notes_sales || ''}
                  onChange={(e) => updateOrderMutation.mutate({ notes_sales: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>הערות מפעל</Label>
                <Textarea
                  value={order.notes_factory || ''}
                  onChange={(e) => updateOrderMutation.mutate({ notes_factory: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>הערות לוגיסטיקה</Label>
                <Textarea
                  value={order.notes_logistics || ''}
                  onChange={(e) => updateOrderMutation.mutate({ notes_logistics: e.target.value })}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Payment Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                ניהול תשלומים
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Balance Summary */}
              {(() => {
                const payments = order.payments || [];
                const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                const remaining = (order.total || 0) - totalPaid;
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">סה״כ הזמנה</span>
                      <span className="font-medium">₪{(order.total || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-emerald-600">שולם</span>
                      <span className="font-medium text-emerald-600">₪{totalPaid.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-2">
                      <span className={remaining > 0 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>
                        {remaining > 0 ? 'יתרה לתשלום' : 'שולם במלואו'}
                      </span>
                      <span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        ₪{Math.abs(remaining).toLocaleString()}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${remaining <= 0 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, order.total > 0 ? (totalPaid / order.total) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Payment History */}
              {(order.payments || []).length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">היסטוריית תשלומים</Label>
                  <div className="space-y-2">
                    {order.payments.map((payment, idx) => (
                      <div key={idx} className="flex items-start justify-between p-2.5 bg-muted/50 rounded-lg text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-emerald-600">₪{(payment.amount || 0).toLocaleString()}</span>
                            <span className="text-xs text-muted-foreground">
                              {PAYMENT_METHODS[payment.method] || payment.method}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {payment.date ? format(new Date(payment.date), 'dd/MM/yyyy') : ''}
                            {payment.notes ? ` · ${payment.notes}` : ''}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400 hover:text-red-600 shrink-0"
                          onClick={() => {
                            const updatedPayments = order.payments.filter((_, i) => i !== idx);
                            const newStatus = calcPaymentStatus(updatedPayments, order.total);
                            const totalPaid = updatedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                            updateOrderMutation.mutate({
                              payments: updatedPayments,
                              amount_paid: totalPaid,
                              payment_status: newStatus,
                            });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add Payment Form */}
              {showAddPayment ? (
                <div className="space-y-3 border-t pt-3">
                  <Label className="text-xs font-medium">תשלום חדש</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">סכום</Label>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">₪</span>
                        <Input
                          type="number"
                          min="0"
                          value={newPayment.amount}
                          onChange={(e) => setNewPayment(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="0"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">אמצעי</Label>
                      <Select value={newPayment.method} onValueChange={(v) => setNewPayment(prev => ({ ...prev, method: v }))}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
                            <SelectItem key={key} value={key}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">תאריך</Label>
                    <Input
                      type="date"
                      value={newPayment.date}
                      onChange={(e) => setNewPayment(prev => ({ ...prev, date: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">הערה (אופציונלי)</Label>
                    <Input
                      value={newPayment.notes}
                      onChange={(e) => setNewPayment(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="מספר צ'ק, אסמכתא..."
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!newPayment.amount || parseFloat(newPayment.amount) <= 0 || updateOrderMutation.isPending}
                      onClick={() => {
                        const paymentEntry = {
                          amount: parseFloat(newPayment.amount),
                          method: newPayment.method,
                          date: newPayment.date,
                          notes: newPayment.notes,
                          recorded_at: new Date().toISOString(),
                          recorded_by: user?.email,
                        };
                        const updatedPayments = [...(order.payments || []), paymentEntry];
                        const totalPaid = updatedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                        const newStatus = calcPaymentStatus(updatedPayments, order.total);
                        updateOrderMutation.mutate({
                          payments: updatedPayments,
                          amount_paid: totalPaid,
                          payment_status: newStatus,
                        });
                        setNewPayment({ amount: '', method: 'credit_card', date: new Date().toISOString().split('T')[0], notes: '' });
                        setShowAddPayment(false);
                      }}
                    >
                      {updateOrderMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'שמור'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowAddPayment(false)}
                    >
                      ביטול
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowAddPayment(true)}
                >
                  <Plus className="h-3.5 w-3.5 me-1.5" />
                  הוסף תשלום
                </Button>
              )}

              {/* Manual status override for refunds */}
              <div className="border-t pt-3 space-y-1">
                <Label className="text-xs text-muted-foreground">שינוי סטטוס ידני</Label>
                <Select
                  value={order.payment_status}
                  onValueChange={(val) => updateOrderMutation.mutate({ payment_status: val })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">לא שולם</SelectItem>
                    <SelectItem value="deposit_paid">מקדמה</SelectItem>
                    <SelectItem value="paid">שולם</SelectItem>
                    <SelectItem value="refunded_partial">זיכוי חלקי</SelectItem>
                    <SelectItem value="refunded_full">זיכוי מלא</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Factory className="h-5 w-5" />
                סטטוס ייצור
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={order.production_status}
                onValueChange={(val) => updateOrderMutation.mutate({ production_status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">טרם התחיל</SelectItem>
                  <SelectItem value="materials_check">בדיקת חומרים</SelectItem>
                  <SelectItem value="in_production">בייצור</SelectItem>
                  <SelectItem value="qc">בקרת איכות</SelectItem>
                  <SelectItem value="ready">מוכן</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                סטטוס משלוח
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={order.delivery_status}
                onValueChange={(val) => updateOrderMutation.mutate({ delivery_status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="need_scheduling">לתאום</SelectItem>
                  <SelectItem value="scheduled">מתואם</SelectItem>
                  <SelectItem value="dispatched">יצא לדרך</SelectItem>
                  <SelectItem value="in_transit">בדרך</SelectItem>
                  <SelectItem value="delivered">נמסר</SelectItem>
                  <SelectItem value="failed">נכשל</SelectItem>
                  <SelectItem value="returned">הוחזר</SelectItem>
                </SelectContent>
              </Select>
              
              {shipment && (
                <div className="mt-4 p-3 bg-muted rounded-lg text-sm">
                  <p><span className="text-muted-foreground">מס' משלוח:</span> #{shipment.shipment_number}</p>
                  {shipment.scheduled_date && (
                    <p><span className="text-muted-foreground">תאריך:</span> {format(new Date(shipment.scheduled_date), 'dd/MM/yyyy')}</p>
                  )}
                  {shipment.carrier && (
                    <p><span className="text-muted-foreground">מוביל:</span> {shipment.carrier}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trial Period */}
          {order.trial_30d_enabled && (
            <Card>
              <CardHeader>
                <CardTitle>ניסיון 30 יום</CardTitle>
              </CardHeader>
              <CardContent>
                <StatusBadge status={order.trial_status} />
                {order.trial_start_date && (
                  <div className="mt-3 text-sm space-y-1">
                    <p><span className="text-muted-foreground">התחלה:</span> {format(new Date(order.trial_start_date), 'dd/MM/yyyy')}</p>
                    <p><span className="text-muted-foreground">סיום:</span> {format(new Date(order.trial_end_date), 'dd/MM/yyyy')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Commission */}
          {commission && (
            <Card>
              <CardHeader>
                <CardTitle>עמלות</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">
                        {users.find(u => u.email === commission.rep1)?.full_name || commission.rep1?.split('@')[0]}
                      </p>
                      <p className="text-xs text-muted-foreground">{commission.rep1_percent}%</p>
                    </div>
                    <span className="font-semibold">₪{commission.rep1_amount?.toLocaleString()}</span>
                  </div>
                  {commission.rep2 && (
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {users.find(u => u.email === commission.rep2)?.full_name || commission.rep2?.split('@')[0]}
                        </p>
                        <p className="text-xs text-muted-foreground">{commission.rep2_percent}%</p>
                      </div>
                      <span className="font-semibold">₪{commission.rep2_amount?.toLocaleString()}</span>
                    </div>
                  )}
                </div>
                <div className="pt-2 border-t flex justify-between font-semibold">
                  <span>סה"כ</span>
                  <span>₪{commission.total_commission?.toLocaleString()}</span>
                </div>
                <StatusBadge status={commission.status} />
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>ציר זמן</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-primary"></div>
                  <div>
                    <p className="font-medium">הזמנה נוצרה</p>
                    <p className="text-muted-foreground">{format(new Date(order.created_date), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                </div>
                {order.updated_date !== order.created_date && (
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40"></div>
                    <div>
                      <p className="font-medium">עודכן לאחרונה</p>
                      <p className="text-muted-foreground">{format(new Date(order.updated_date), 'dd/MM/yyyy HH:mm')}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Service Ticket Dialog */}
      <NewServiceTicketDialog
        open={showServiceTicket}
        onOpenChange={setShowServiceTicket}
        order={order}
        currentUser={effectiveUser}
      />
    </div>
  );
}