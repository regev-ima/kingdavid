import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import { getRepDisplayName } from '@/lib/repDisplay';
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
  Headphones,
  CreditCard,
  Download,
  CheckCircle2,
  User,
  Mail,
  MapPin,
  Home,
  Package,
  Clock,
} from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canViewOrder, isAdmin as isAdminUser, isFactoryUser } from '@/lib/rbac';
import OpenServiceTicketDialog from '@/components/service/OpenServiceTicketDialog';
import HypPaymentDialog from '@/components/payment/HypPaymentDialog';
import OrderPdfGenerator from '@/components/orders/OrderPdfGenerator';
import WhatsAppSendDialog from '@/components/shared/WhatsAppSendDialog';

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

export default function OrderDetails({ orderId: orderIdProp, isModal = false, onClose }) {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showHypPayment, setShowHypPayment] = useState(false);
  const [waState, setWaState] = useState(null); // null | {status:'preparing'|'ready'|'error', url?, msg?}
  const [showServiceTicket, setShowServiceTicket] = useState(false);
  const [newPayment, setNewPayment] = useState({
    amount: '',
    method: 'credit_card',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const queryClient = useQueryClient();

  // In popup mode the id arrives as a prop (the list opens the order without
  // navigating, so the URL carries no ?id=). On the standalone page it still
  // comes from the query string.
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = orderIdProp ?? urlParams.get('id');

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
          approved_by: effectiveUser?.email,
          approved_date: new Date().toISOString().split('T')[0]
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['order', orderId]);
      queryClient.invalidateQueries(['commission', orderId]);
    },
    onError: (err) => {
      // Surface Postgres errors (missing column, RLS, bad type) instead of
      // swallowing them — without this the user clicks "שמור" and nothing
      // appears to happen.
      const detail = err?.message || err?.details || err?.hint || JSON.stringify(err);
      toast.error(`שגיאה בשמירת ההזמנה: ${detail}`, { duration: 10000 });
      // eslint-disable-next-line no-console
      console.error('updateOrder error — full object:', err);
    },
  });

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      const pdfUrl = await OrderPdfGenerator(order);
      return pdfUrl;
    },
    onSuccess: (pdfUrl) => {
      window.open(pdfUrl, '_blank');
      toast.success('PDF נוצר בהצלחה');
    },
    onError: (err) => {
      toast.error(`יצירת PDF נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    },
  });

  const isAdmin = isAdminUser(effectiveUser);
  // Factory-owned fields (production status + factory notes) are editable only
  // by admin or the factory; a sales rep sees them read-only.
  const canEditFactory = isAdmin || isFactoryUser(effectiveUser);

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
        {isModal ? (
          <Button className="mt-4" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Orders')}>
            <Button className="mt-4">חזור לרשימת ההזמנות</Button>
          </Link>
        )}
      </div>
    );
  }

  if (!canViewOrder(effectiveUser, order)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בהזמנה זו</p>
        {isModal ? (
          <Button className="mt-4" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Orders')}>
            <Button className="mt-4">חזור לרשימת ההזמנות</Button>
          </Link>
        )}
      </div>
    );
  }

  const handleCall = () => {
    if (order?.customer_phone) {
      window.open(`tel:${order.customer_phone}`, '_self');
    }
  };

  // Prepare a WhatsApp message linking to the order PDF, via a small status
  // modal. The PDF render is slow and briefly reflows the page, so the modal
  // gives feedback + masks it, and the user opens WhatsApp from a fresh click
  // (so it isn't popup-blocked). Reuses a cached pdf_url when present.
  const handleWhatsApp = async () => {
    const digits = (order?.customer_phone || '').replace(/[^0-9]/g, '');
    if (!digits) {
      toast.error('אין מספר טלפון ללקוח');
      return;
    }
    const intl = digits.startsWith('972') ? digits : `972${digits.startsWith('0') ? digits.slice(1) : digits}`;
    setWaState({ status: 'preparing' });
    await new Promise((r) => setTimeout(r, 50)); // let the modal paint first
    try {
      const pdfUrl = order.pdf_url || (await OrderPdfGenerator(order));
      const lines = [
        `שלום ${order.customer_name || ''}`.trim() + ',',
        `מצורפת ההזמנה שלך #${order.order_number} מבית קינג דיוויד.`,
        order.total ? `סכום ההזמנה: ₪${Number(order.total).toLocaleString('he-IL')}` : '',
        `לצפייה והורדת המסמך: ${pdfUrl}`,
        'נשמח לעמוד לרשותך 🙏',
      ].filter(Boolean);
      const text = encodeURIComponent(lines.join('\n'));
      setWaState({ status: 'ready', url: `https://web.whatsapp.com/send?phone=${intl}&text=${text}` });
    } catch (err) {
      setWaState({ status: 'error', msg: err?.message || 'שגיאה לא ידועה' });
    }
  };

  return (
    <div className={isModal ? 'flex flex-col h-full overflow-hidden' : 'space-y-6'}>
      {/* Header — order number + the 3 status badges. Fixed (flex-shrink-0) in
          popup mode so it never scrolls; pe-12 reserves room for the dialog's
          close-X. Mirrors the lead / service-ticket header. */}
      <div className={isModal ? 'flex-shrink-0 px-6 pt-5 pb-3 pe-12 bg-card border-b border-border' : ''}>
        <div className="flex items-center gap-3">
          {isModal ? (
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={onClose} title="סגור">
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Link to={createPageUrl('Orders')}>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg">
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">הזמנה #{order.order_number}</h1>
              {order.is_imported && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 ring-1 ring-stone-200">הזמנה מיובאת</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={order.payment_status} />
              <StatusBadge status={order.production_status} />
              <StatusBadge status={order.delivery_status} />
            </div>
          </div>
        </div>
      </div>

      {/* Action bar — call / WhatsApp / PDF / service / return. Fixed under the
          header in popup mode; a bordered bar on the full page. Same surface
          (border + backdrop-blur) as the lead action bar for a consistent feel. */}
      <div className={
        isModal
          ? 'flex-shrink-0 flex flex-wrap items-center justify-end gap-2 border-b border-border bg-background/95 backdrop-blur px-6 py-2.5'
          : 'flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-card'
      }>
        <Button variant="outline" size="sm" onClick={handleCall} className="h-8 text-xs">
          <Phone className="h-3.5 w-3.5 me-1.5" />
          התקשר
        </Button>
        <Button variant="outline" size="sm" onClick={handleWhatsApp} disabled={waState?.status === 'preparing'} className="h-8 text-xs [&_svg]:text-green-600">
          {waState?.status === 'preparing' ? (
            <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5 me-1.5" />
          )}
          WhatsApp
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generatePdfMutation.mutate()}
          disabled={generatePdfMutation.isPending}
          className="h-8 text-xs"
        >
          {generatePdfMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 me-1.5" />
          )}
          הורד PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowServiceTicket(true)} className="h-8 text-xs">
          <Headphones className="h-3.5 w-3.5 me-1.5" />
          קריאת שירות
        </Button>
        <Link to={createPageUrl('NewReturn') + `?order_id=${orderId}`}>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <RotateCcw className="h-3.5 w-3.5 me-1.5" />
            בקשת החזרה
          </Button>
        </Link>
      </div>

      {/* Body — the only scrollable region in popup mode. */}
      <div className={isModal ? 'flex-1 overflow-auto px-6 pb-6 pt-4' : ''}>
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & delivery — same dl icon-row design as the lead screen:
              one row per field with a leading icon + slim label, value on the
              left, empty rows hidden so a sparse order shows no blank "-"s. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                פרטי לקוח
              </CardTitle>
              {customer && (
                <Link to={createPageUrl('CustomerDetails') + `?id=${customer.id}`}>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-primary">
                    פרופיל לקוח
                  </Button>
                </Link>
              )}
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border/30">
                {[
                  { label: 'שם', value: order.customer_name, icon: User },
                  { label: 'טלפון', value: order.customer_phone, icon: Phone },
                  { label: 'אימייל', value: order.customer_email, icon: Mail },
                  { label: 'עיר', value: order.delivery_city, icon: MapPin },
                  { label: 'כתובת למשלוח', value: order.delivery_address, icon: Home },
                  ...(customer ? [
                    { label: 'סה"כ הזמנות', value: customer.total_orders != null ? String(customer.total_orders) : null, icon: Package },
                    { label: 'LTV', value: customer.lifetime_value != null ? `₪${customer.lifetime_value.toLocaleString()}` : null, icon: Wallet },
                  ] : []),
                ]
                  .filter((row) => row.value)
                  .map((row) => {
                    const Icon = row.icon;
                    return (
                      <div key={row.label} className="flex items-baseline gap-3 py-3">
                        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground/80 w-28 flex-shrink-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                          <span>{row.label}</span>
                        </dt>
                        <dd className="text-sm text-foreground min-w-0 flex-1 truncate">{row.value}</dd>
                      </div>
                    );
                  })}
              </dl>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                פריטים
              </CardTitle>
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
              <CardTitle className="text-sm font-semibold">הערות</CardTitle>
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
                  disabled={!canEditFactory}
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
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
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
                      <span className={`font-bold flex items-center gap-1 ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {remaining > 0
                          ? `₪${Math.abs(remaining).toLocaleString()}`
                          : <CheckCircle2 className="h-4 w-4" />}
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
                          {(payment.hyp_transaction_id || payment.hyp_acode || payment.hyp_brand || payment.hyp_l4digit) && (
                            <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5" dir="rtl">
                              {payment.hyp_transaction_id && (
                                <span>מס׳ עסקה: <span dir="ltr">{payment.hyp_transaction_id}</span></span>
                              )}
                              {payment.hyp_acode && (
                                <span>אישור: <span dir="ltr">{payment.hyp_acode}</span></span>
                              )}
                              {(payment.hyp_brand || payment.hyp_l4digit) && (
                                <span>
                                  כרטיס: {payment.hyp_brand || ''}{payment.hyp_l4digit ? ` **** ${payment.hyp_l4digit}` : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400 hover:text-red-600 shrink-0"
                          onClick={() => {
                            const updatedPayments = order.payments.filter((_, i) => i !== idx);
                            const newStatus = calcPaymentStatus(updatedPayments, order.total);
                            // amount_paid is NOT a stored column (see the hyp-* Edge
                            // Functions) — it's derived from payments. Persist only the
                            // payments array + the recomputed status.
                            updateOrderMutation.mutate({
                              payments: updatedPayments,
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
                          recorded_by: effectiveUser?.email,
                        };
                        const updatedPayments = [...(order.payments || []), paymentEntry];
                        const newStatus = calcPaymentStatus(updatedPayments, order.total);
                        // amount_paid is derived (not a stored column) — persist only
                        // the payments array + the recomputed status.
                        updateOrderMutation.mutate({
                          payments: updatedPayments,
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
                <div className="space-y-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowHypPayment(true)}
                    disabled={(order?.total || 0) - (order.payments || []).reduce((s, p) => s + (p.amount || 0), 0) <= 0}
                  >
                    <CreditCard className="h-3.5 w-3.5 me-1.5" />
                    תשלום באשראי (Hyp)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowAddPayment(true)}
                  >
                    <Plus className="h-3.5 w-3.5 me-1.5" />
                    הוסף תשלום ידני
                  </Button>
                </div>
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
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Factory className="h-4 w-4 text-muted-foreground" />
                סטטוס ייצור
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={
                  order.production_status === 'materials_check' || order.production_status === 'qc'
                    ? 'in_production'
                    : order.production_status
                }
                onValueChange={(val) => updateOrderMutation.mutate({ production_status: val })}
                disabled={!canEditFactory}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">בתור לייצור</SelectItem>
                  <SelectItem value="in_production">ייצור</SelectItem>
                  <SelectItem value="ready">מוכן</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
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
                  <p>
                    <span className="text-muted-foreground">מס' משלוח: </span>
                    <Link
                      to={createPageUrl('ShipmentDetails') + `?id=${shipment.id}`}
                      className="text-primary hover:underline"
                    >
                      #{shipment.shipment_number}
                    </Link>
                  </p>
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
                <CardTitle className="text-sm font-semibold">ניסיון 30 יום</CardTitle>
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
                <CardTitle className="text-sm font-semibold">עמלות</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">
                        {getRepDisplayName(commission.rep1, users)}
                      </p>
                      <p className="text-xs text-muted-foreground">{commission.rep1_percent}%</p>
                    </div>
                    <span className="font-semibold">₪{commission.rep1_amount?.toLocaleString()}</span>
                  </div>
                  {commission.rep2 && (
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {getRepDisplayName(commission.rep2, users)}
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
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                ציר זמן
              </CardTitle>
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

      <WhatsAppSendDialog state={waState} onClose={() => setWaState(null)} />

      {/* Service Ticket Dialog — opens a rich ticket in the new Service Center
          (problem photos + warranty classification). Opening a ticket never
          edits the order. */}
      <OpenServiceTicketDialog
        open={showServiceTicket}
        onOpenChange={setShowServiceTicket}
        order={order}
        currentUser={effectiveUser}
      />

      {/* Hyp Payment Dialog */}
      <HypPaymentDialog
        open={showHypPayment}
        onOpenChange={setShowHypPayment}
        order={order}
        onPaid={() => {
          toast.success('התשלום התקבל');
          // The server-to-server hyp-notify writes the payment row. Give it a
          // moment before refreshing so the order reflects the new state.
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['order', orderId] });
          }, 1500);
        }}
      />
      </div>
    </div>
  );
}