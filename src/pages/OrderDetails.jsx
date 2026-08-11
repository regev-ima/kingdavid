import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Info,
  Ban,
  PackageCheck,
  Compass,
} from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canEditOrder, isAdmin as isAdminUser, isFactoryUser } from '@/lib/rbac';
import useOrderAutoSend from '@/hooks/use-order-autosend';
import { autoSendOrderWithToast } from '@/lib/orderWhatsAppAutoSend';
import OpenServiceTicketDialog from '@/components/service/OpenServiceTicketDialog';
import DeleteOrderDialog from '@/components/order/DeleteOrderDialog';
import CancelOrderDialog from '@/components/order/CancelOrderDialog';
import { isCancelledOrder } from '@/lib/cancelOrder';
import HypPaymentDialog from '@/components/payment/HypPaymentDialog';
import OrderPaymentDialog, { PAYMENT_METHODS, calcPaymentStatus, sumPayments } from '@/components/payment/OrderPaymentDialog';
import OrderPdfGenerator, { buildOrderPdfBlob } from '@/components/orders/OrderPdfGenerator';
import { downloadBlob } from '@/lib/downloadBlob';
import WhatsAppSendPdfButton from '@/components/whatsapp/WhatsAppSendPdfButton';
import QuoteTotalsSummary from '@/components/quote/QuoteTotalsSummary';
import DocumentTermsCard from '@/components/shared/DocumentTermsCard';
import useDocumentTermsDefaults from '@/hooks/use-document-terms';
import { orderTermsFields, resolveDocumentTerms } from '@/constants/documentTerms';
import { SOURCE_LABELS } from '@/constants/leadOptions';

// Line prices are stored pre-VAT; show the customer incl-VAT, two decimals.
const VAT = 1.18;
const money2 = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// PAYMENT_METHODS / calcPaymentStatus live with the payment dialog now, so the
// create and the edit screens can't drift apart on what "שולם" means.

export default function OrderDetails({ orderId: orderIdProp, isModal = false, onClose }) {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const { enabled: autoSendWhatsApp } = useOrderAutoSend();
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showHypPayment, setShowHypPayment] = useState(false);
  const [showServiceTicket, setShowServiceTicket] = useState(false);
  const [showDeleteOrder, setShowDeleteOrder] = useState(false);
  const [showCancelOrder, setShowCancelOrder] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  // The lead the order came from: it holds the campaign/UTM detail behind
  // "מקור הגעה", and it's what the rep wants to jump back to.
  const { data: lead = null } = useQuery({
    queryKey: ['order-source-lead', order?.lead_id],
    queryFn: () => base44.entities.Lead.filter({ id: order.lead_id }).then(res => res[0] || null),
    enabled: !!order?.lead_id,
  });

  // Orders created before the legal-text columns existed have no wording of
  // their own; the quote they were converted from is the next best copy.
  const { data: sourceQuote = null } = useQuery({
    queryKey: ['order-source-quote', order?.quote_id],
    queryFn: () => base44.entities.Quote.filter({ id: order.quote_id }).then(res => res[0] || null),
    enabled: !!order?.quote_id,
  });

  const { defaults: companyTermsDefaults } = useDocumentTermsDefaults();

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

  // "הורד PDF" saves the file straight to the browser's downloads. It used to
  // upload the PDF and window.open() the URL, which the popup blocker ate —
  // generating takes seconds, so the tab was no longer tied to the click.
  const generatePdfMutation = useMutation({
    mutationFn: () => buildOrderPdfBlob(order),
    onSuccess: ({ blob }) => {
      downloadBlob(blob, `הזמנה-${order.order_number}.pdf`);
      toast.success('ה-PDF ירד');
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

  // Reps reach OTHER reps' orders through the phone lookup — they may view but
  // not edit. canEditOrder mirrors the old canViewOrder ownership check, so
  // everyone who could edit before still can; only a non-owning sales rep is
  // downgraded to read-only (a banner + disabled controls below).
  const canEdit = canEditOrder(effectiveUser, order);

  // "מקור הגעה": the bucket is on the order, the marketing detail behind it is
  // on the lead. A campaign name beats a bare "digital" for the rep reading it.
  const sourceLabel = SOURCE_LABELS[order.source] || order.source || null;
  const campaignDetail = [
    lead?.utm_source,
    lead?.utm_campaign || lead?.facebook_campaign_name,
    lead?.utm_content,
  ].filter(Boolean).join(' · ');

  // Read-only on an order, resolved הזמנה → הצעה → הגדרות → קוד: the order's
  // own stamped copy wins, then the quote it came from, then the company
  // defaults, then the text in code.
  const termsFallback = resolveDocumentTerms(sourceQuote, companyTermsDefaults);

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
    <div className={isModal ? 'flex flex-col h-full overflow-hidden' : 'space-y-6'}>
      {!canEdit && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-6 py-2">
          <Info className="h-4 w-4 flex-shrink-0" />
          צפייה בלבד — ההזמנה משויכת לנציג אחר.
        </div>
      )}
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
              {isCancelledOrder(order) && <StatusBadge status="cancelled" />}
              <StatusBadge status={order.payment_status} />
              <StatusBadge status={order.production_status} />
              <StatusBadge status={order.delivery_status} />
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                נציג: <span className="font-medium text-foreground">{getRepDisplayName(order.rep1, users) || 'לא ידוע'}</span>
              </span>
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
        <Button variant="outline" size="sm" onClick={handleWhatsApp} className="h-8 text-xs [&_svg]:text-green-600">
          <MessageCircle className="h-3.5 w-3.5 me-1.5" />
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
        <WhatsAppSendPdfButton
          phone={order.customer_phone}
          contactName={order.customer_name}
          fileName={`הזמנה-${order.order_number}.pdf`}
          currentUser={effectiveUser}
          templateCategory="orders"
          ownerUserId={users.find((u) => u.email?.toLowerCase() === (order.rep1 || '').toLowerCase())?.id}
          ensurePdfUrl={() => OrderPdfGenerator(order)}
        />
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
        {/* Cancel is the non-destructive option, so unlike delete it is open to
            whoever can edit the order — the rep who took the sale is usually
            the one who hears it fell through. */}
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCancelOrder(true)}
            className={isCancelledOrder(order)
              ? 'h-8 text-xs text-primary border-primary/30 hover:bg-primary/5'
              : 'h-8 text-xs text-amber-700 border-amber-200 hover:bg-amber-50'}
          >
            {isCancelledOrder(order)
              ? <><RotateCcw className="h-3.5 w-3.5 me-1.5" />הפעל מחדש</>
              : <><Ban className="h-3.5 w-3.5 me-1.5" />בטל הזמנה</>}
          </Button>
        )}
        {/* Admin-only, and last in the bar so it isn't next to anything a rep
            clicks routinely. */}
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteOrder(true)}
            className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5 me-1.5" />
            מחק הזמנה
          </Button>
        )}
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
                  { label: 'שם ושם משפחה', value: order.customer_name, icon: User },
                  { label: 'טלפון', value: order.customer_phone, icon: Phone },
                  // Editable here as well as in the order form: a second number
                  // usually surfaces after the sale ("תתקשרו לאשתי לגבי
                  // האספקה"), and this card is where the driver reads it off.
                  { label: 'טלפון נוסף', value: order.customer_phone_2, icon: Phone, field: 'customer_phone_2', placeholder: 'הוסף מספר' },
                  // Two ways in: Hyp returns it with a card charge (hyp-verify /
                  // hyp-notify write it), and a cash sale never touches Hyp — so
                  // it stays editable here too.
                  { label: 'ת.ז.', value: order.customer_id_number, icon: CreditCard, field: 'customer_id_number', placeholder: 'הוסף ת.ז.', digitsOnly: true },
                  { label: 'אימייל', value: order.customer_email, icon: Mail },
                  // Where the sale actually came from. It's stamped on the
                  // order at creation (from the lead), and the campaign/UTM
                  // detail + the link back to the lead come from the lead
                  // record itself — the order only stores the bucket.
                  {
                    label: 'מקור הגעה',
                    icon: Compass,
                    value: sourceLabel,
                    node: sourceLabel ? (
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span>{sourceLabel}</span>
                        {campaignDetail && (
                          <span className="text-xs text-muted-foreground">{campaignDetail}</span>
                        )}
                        {order.lead_id && (
                          <Link
                            to={createPageUrl('LeadDetails') + `?id=${order.lead_id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            לליד המקורי
                          </Link>
                        )}
                      </div>
                    ) : null,
                  },
                  // A self-pickup order has no delivery address — printing the
                  // pickup terms here keeps whoever hands over the goods from
                  // looking for one.
                  ...(order.is_self_pickup
                    ? [{ label: 'אופן אספקה', value: 'איסוף עצמי - בתיאום', icon: PackageCheck },
                       { label: 'מקום האיסוף', value: 'רחוב העמל 6, קרית מלאכי · א׳-ה׳ 9:00-16:00', icon: MapPin }]
                    : [{ label: 'עיר', value: order.delivery_city, icon: MapPin },
                       { label: 'כתובת למשלוח', value: order.delivery_address, icon: Home }]),
                  ...(customer ? [
                    { label: 'סה"כ הזמנות', value: customer.total_orders != null ? String(customer.total_orders) : null, icon: Package },
                    { label: 'LTV', value: customer.lifetime_value != null ? `₪${customer.lifetime_value.toLocaleString()}` : null, icon: Wallet },
                  ] : []),
                ]
                  // An editable row stays visible while empty — that's the only
                  // way to fill it in; read-only rows still disappear.
                  .filter((row) => row.value || row.node || (row.field && canEdit))
                  .map((row) => {
                    const Icon = row.icon;
                    return (
                      <div key={row.label} className="flex items-baseline gap-3 py-3">
                        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground/80 w-28 flex-shrink-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                          <span>{row.label}</span>
                        </dt>
                        {/* A `node` row renders rich content (links, a second
                            line) — truncating it would clip the link away. */}
                        <dd className={`text-sm text-foreground min-w-0 flex-1 ${row.node ? '' : 'truncate'}`}>
                          {row.field && canEdit ? (
                            <Input
                              // Re-key on the saved value so an external update
                              // (or a failed save) doesn't leave a stale draft.
                              key={row.value || ''}
                              defaultValue={row.value || ''}
                              dir="ltr"
                              placeholder={row.placeholder}
                              className="h-7 px-2 text-sm text-start"
                              // On blur, not on every keystroke: a phone number
                              // or an ID is only meaningful once it's finished.
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const next = row.digitsOnly ? raw.replace(/\D/g, '') : raw;
                                if (next !== (row.value || '')) {
                                  updateOrderMutation.mutate({ [row.field]: next });
                                }
                              }}
                            />
                          ) : (
                            row.node || row.value
                          )}
                        </dd>
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
                    <TableHead className="text-right">מחיר<div className="text-[10px] font-normal opacity-70">כולל מע״מ</div></TableHead>
                    <TableHead className="text-right">סה"כ<div className="text-[10px] font-normal opacity-70">כולל מע״מ</div></TableHead>
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
                                <p key={i}>• {a.name} (+{money2((a.price || 0) * VAT)})</p>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground" dir="ltr">{item.sku || '-'}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>
                          <div>
                            <div>{money2((item.unit_price || 0) * VAT)}</div>
                            {addonsTotal > 0 && (
                              <div className="text-xs text-muted-foreground">+{money2(addonsTotal * VAT)} תוספות</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">{money2((item.total || 0) * VAT)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              
              {/* Same shared summary component as the create/edit forms + the
                  quote view, so the breakdown is identical everywhere. */}
              <QuoteTotalsSummary items={order.items} extras={order.extras} total={order.total} />
            </CardContent>
          </Card>

          {/* The wording the customer is signing. Read-only here: it was fixed
              when the order was created, and Settings edits must not rewrite
              an order that was already sold. */}
          <DocumentTermsCard doc={orderTermsFields(order)} defaults={termsFallback} />

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
                  disabled={!canEdit}
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
                  disabled={!canEdit}
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
                          {(payment.hyp_transaction_id || payment.hyp_acode || payment.hyp_brand || payment.hyp_l4digit || payment.hyp_payments_count) && (
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
                              {payment.hyp_payments_count > 0 && (
                                <span>תשלומים: {payment.hyp_payments_count}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!canEdit}
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

              {/* Add Payment — the same dialog the new-order screen opens. */}
              <div className="space-y-2">
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowHypPayment(true)}
                  disabled={!canEdit || (order?.total || 0) - sumPayments(order.payments) <= 0}
                >
                  <CreditCard className="h-3.5 w-3.5 me-1.5" />
                  תשלום באשראי (Hyp)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowAddPayment(true)}
                  disabled={!canEdit}
                >
                  <Plus className="h-3.5 w-3.5 me-1.5" />
                  הוסף תשלום ידני
                </Button>
              </div>

              {/* Manual status override for refunds */}
              <div className="border-t pt-3 space-y-1">
                <Label className="text-xs text-muted-foreground">שינוי סטטוס ידני</Label>
                <Select
                  value={order.payment_status}
                  onValueChange={(val) => updateOrderMutation.mutate({ payment_status: val })}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">לא שולם</SelectItem>
                    <SelectItem value="deposit_paid">תשלום חלקי</SelectItem>
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
                {order.is_self_pickup ? (
                  <><PackageCheck className="h-4 w-4 text-muted-foreground" />סטטוס איסוף</>
                ) : (
                  <><Truck className="h-4 w-4 text-muted-foreground" />סטטוס משלוח</>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={order.delivery_status}
                onValueChange={(val) => updateOrderMutation.mutate({ delivery_status: val })}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="need_scheduling">לתאום</SelectItem>
                  <SelectItem value="awaiting_pickup">ממתין לאיסוף</SelectItem>
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

      {/* Service Ticket Dialog — opens a rich ticket in the new Service Center
          (problem photos + warranty classification). Opening a ticket never
          edits the order. */}
      <OpenServiceTicketDialog
        open={showServiceTicket}
        onOpenChange={setShowServiceTicket}
        order={order}
        currentUser={effectiveUser}
      />

      {/* Delete (admin only). In popup mode the list behind us is still there,
          so we just close; on the standalone page there's nothing left to show
          and we go back to the list. */}
      <DeleteOrderDialog
        open={showDeleteOrder}
        onOpenChange={setShowDeleteOrder}
        order={order}
        onDeleted={() => {
          if (isModal) onClose?.();
          else navigate(createPageUrl('Orders'));
        }}
      />

      <CancelOrderDialog
        open={showCancelOrder}
        onOpenChange={setShowCancelOrder}
        order={order}
        currentUserEmail={effectiveUser?.email}
      />

      {/* Manual payment — shared with the new-order screen. */}
      <OrderPaymentDialog
        open={showAddPayment}
        onOpenChange={setShowAddPayment}
        total={order.total || 0}
        alreadyPaid={sumPayments(order.payments)}
        defaultMethod="cash"
        recordedBy={effectiveUser?.email}
        isSaving={updateOrderMutation.isPending}
        // The order exists here, so a card CAN actually be charged — offer the
        // real thing rather than letting the rep record a charge that never
        // happened.
        onStartCardClearing={() => setShowHypPayment(true)}
        onConfirm={(entry) => {
          const updatedPayments = [...(order.payments || []), entry];
          // amount_paid is derived (not a stored column) — persist only the
          // payments array + the recomputed status.
          updateOrderMutation.mutate({
            payments: updatedPayments,
            payment_status: calcPaymentStatus(updatedPayments, order.total),
          });
          setShowAddPayment(false);
        }}
      />

      {/* Hyp Payment Dialog */}
      <HypPaymentDialog
        open={showHypPayment}
        onOpenChange={setShowHypPayment}
        order={order}
        onPaid={() => {
          toast.success('התשלום התקבל');
          // An order paid by card is an order the customer should receive,
          // whether the charge happened seconds after it was written or days
          // later from this screen. refreshFirst re-reads the row, because the
          // copy held here still says unpaid.
          if (autoSendWhatsApp) {
            autoSendOrderWithToast(order, {
              currentUser: effectiveUser,
              isAdmin,
              refreshFirst: true,
            });
          }
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