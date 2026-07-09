import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useCreationModal } from '@/components/shared/CreationModalContext';
import { useQuoteModal } from '@/components/quote/QuoteModalContext';
import { createPageUrl } from '@/utils';
import { cancelOpenTasksForClosedDeal } from '@/lib/dealClose';
import StatusBadge from '@/components/shared/StatusBadge';
import QuotePdfGenerator from '@/components/quotes/QuotePdfGenerator';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Send,
  ShoppingCart,
  FileText,
  Download,
  Mail,
  Pencil,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Info,
  User,
  Home,
  Building2,
  Layers,
  Hash,
  ArrowUpDown,
  Package,
  ExternalLink,
} from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canEditQuote } from '@/lib/rbac';
import { getRepDisplayName } from '@/lib/repDisplay';
import { toShareablePdfUrl } from '@/lib/pdfShareUrl';
import QuoteTotalsSummary from '@/components/quote/QuoteTotalsSummary';

// Line prices are stored PRE-VAT; the whole app shows the customer incl-VAT with
// two decimals, so the detail view must match (product AND add-on/config lines).
const VAT = 1.18;
const money2 = (n) => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function addBusinessDays(startDate, days) {
  const result = new Date(startDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 5 && day !== 6) { // Skip Friday & Saturday (Israeli weekend)
      added++;
    }
  }
  return result;
}

const statusConfig = {
  draft: { label: 'טיוטה', icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted/60' },
  sent: { label: 'נשלח', icon: Send, color: 'text-blue-600', bg: 'bg-blue-50' },
  approved: { label: 'מאושר', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  rejected: { label: 'נדחה', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  expired: { label: 'פג תוקף', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
};

const statusTransitions = {
  draft: ['sent', 'approved', 'rejected', 'expired'],
  sent: ['approved', 'rejected', 'expired'],
  approved: ['rejected'],
  rejected: ['draft'],
  expired: [],
};

export default function QuoteDetails({ id: idProp, isModal = false, onClose, onEdit }) {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [statusConfirm, setStatusConfirm] = useState(null); // { targetStatus }
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { openNewOrder } = useCreationModal();
  const { openQuote } = useQuoteModal();

  const urlParams = new URLSearchParams(window.location.search);
  // In modal mode the id arrives as a prop and the URL is left untouched.
  const quoteId = idProp ?? urlParams.get('id');

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => base44.entities.Quote.filter({ id: quoteId }).then(res => res[0]),
    enabled: !!quoteId,
  });

  const { data: lead = null } = useQuery({
    queryKey: ['quote-access-lead', quote?.lead_id],
    queryFn: () => base44.entities.Lead.filter({ id: quote.lead_id }).then(res => res[0] || null),
    enabled: !!quote?.lead_id,
  });

  // For resolving the creating rep's email → display name.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
  });

  const updateQuoteMutation = useMutation({
    mutationFn: (data) => base44.entities.Quote.update(quoteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['quote', quoteId]);
    },
    onError: (err) => toast.error(`עדכון ההצעה נכשל: ${err?.message || 'שגיאה לא צפויה'}`),
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      // Use the freshly-generated URL (quote.pdf_url is stale until refetch).
      let pdfUrl = quote.pdf_url;
      if (!pdfUrl) {
        pdfUrl = await QuotePdfGenerator(quote);
        await base44.entities.Quote.update(quoteId, { pdf_url: pdfUrl, status: 'sent' });
      }

      await base44.integrations.Core.SendEmail({
        to: quote.customer_email,
        subject: `הצעת מחיר מס׳ ${quote.quote_number} - קינג דוד`,
        body: `שלום ${quote.customer_name}, מצורפת הצעת מחיר מס׳ ${quote.quote_number}.`,
        quote_number: quote.quote_number,
        customer_name: quote.customer_name,
        total: quote.total?.toLocaleString(),
        pdf_url: toShareablePdfUrl(pdfUrl),
        valid_until: quote.valid_until ? format(new Date(quote.valid_until), 'dd/MM/yyyy') : '',
      });

      await base44.entities.Quote.update(quoteId, { status: 'sent' });
    },
    onSuccess: () => {
      toast.success('ההצעה נשלחה במייל ללקוח');
      queryClient.invalidateQueries(['quote', quoteId]);
    },
    onError: (err) => toast.error(`שליחת המייל נכשלה: ${err?.message || 'שגיאה לא צפויה'}`),
  });

  const generatePdfMutation = useMutation({
    mutationFn: async () => {
      const pdfUrl = await QuotePdfGenerator(quote);
      await base44.entities.Quote.update(quoteId, { pdf_url: pdfUrl });
      return pdfUrl;
    },
    onSuccess: (pdfUrl) => {
      queryClient.invalidateQueries(['quote', quoteId]);
      window.open(pdfUrl, '_blank');
    },
    onError: (err) => toast.error(`יצירת ה-PDF נכשלה: ${err?.message || 'שגיאה לא צפויה'}`),
  });

  const duplicateQuoteMutation = useMutation({
    mutationFn: async () => {
      const validUntil = addBusinessDays(new Date(), 14);
      const { id, created_date, quote_number, pdf_url, status, valid_until, ...rest } = quote;
      const newQuote = await base44.entities.Quote.create({
        ...rest,
        status: 'draft',
        valid_until: validUntil.toISOString(),
        pdf_url: null,
      });
      return newQuote;
    },
    onSuccess: (newQuote) => {
      // In the popup, swap it to show the freshly-duplicated quote instead of
      // navigating away to a full page — the rep stays in the same overlay.
      if (isModal) { openQuote(newQuote.id); return; }
      navigate(createPageUrl('QuoteDetails') + `?id=${newQuote.id}`);
    },
    onError: (err) => toast.error(`שכפול ההצעה נכשל: ${err?.message || 'שגיאה לא צפויה'}`),
  });

  if (isLoadingUser || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">ההצעה לא נמצאה</p>
        {isModal ? (
          <Button className="mt-4" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Quotes')}>
            <Button className="mt-4">חזור לרשימת ההצעות</Button>
          </Link>
        )}
      </div>
    );
  }

  // Reps reach OTHER reps' quotes through the phone lookup — they may view but
  // not edit. canEditQuote mirrors the old canViewQuote ownership check, so
  // everyone who could act before still can; a non-owning sales rep is
  // downgraded to read-only (banner + hidden actions below).
  const isOwner = canEditQuote(effectiveUser, quote, buildLeadsById(lead ? [lead] : []));

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  const canEdit = isOwner && quote.status === 'draft' && !isExpired;
  const allowedTransitions = !isOwner
    ? []
    : (isExpired && quote.status !== 'expired'
      ? ['expired']
      : (statusTransitions[quote.status] || []));

  const handleStatusChange = (targetStatus) => {
    setStatusConfirm({ targetStatus });
  };

  const confirmStatusChange = async () => {
    if (statusConfirm) {
      const isApproval = statusConfirm.targetStatus === 'approved' && quote.lead_id;
      updateQuoteMutation.mutate({ status: statusConfirm.targetStatus });
      // When approving a quote, auto-update the linked lead to deal_closed
      if (isApproval) {
        try {
          await base44.entities.Lead.update(quote.lead_id, { status: 'deal_closed' });
          await cancelOpenTasksForClosedDeal(quote.lead_id);
        } catch (e) {
          console.error('Failed to update lead status:', e);
        }
      }
      setStatusConfirm(null);
      // The whole point of approving a quote is converting it into an
      // order, so jump straight there with the quote (and via it the
      // customer) pre-filled.
      if (isApproval) {
        openNewOrder({ quoteId });
      }
    }
  };

  const handleCall = () => {
    if (quote?.customer_phone) {
      window.open(`tel:${quote.customer_phone}`, '_self');
    }
  };

  const handleWhatsApp = () => {
    const phone = (quote?.customer_phone || '').replace(/[^0-9]/g, '');
    if (phone) {
      const message = encodeURIComponent(`שלום ${quote.customer_name}, מצורפת הצעת מחיר מס' ${quote.quote_number} מקינג דוד.`);
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}?text=${message}`, '_blank');
    }
  };

  const handleConvertToOrder = () => {
    openNewOrder({ quoteId });
  };

  const createdByName = getRepDisplayName(quote.created_by_rep, users);

  return (
    <div className={isModal ? 'flex flex-col h-full overflow-hidden' : 'space-y-6'}>
      {!isOwner && (
        <div className={
          isModal
            ? 'flex-shrink-0 flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-6 py-2'
            : 'flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm px-4 py-2'
        }>
          <Info className="h-4 w-4 flex-shrink-0" />
          צפייה בלבד — הצעת המחיר משויכת לנציג אחר.
        </div>
      )}
      {/* Header — quote number + status badge, creation date and creating rep.
          Fixed (flex-shrink-0) in popup mode so it never scrolls; pe-12 reserves
          room for the dialog's close-X. Mirrors the order/lead header. */}
      <div className={isModal ? 'flex-shrink-0 px-6 pt-5 pb-3 pe-12 bg-card border-b border-border' : ''}>
        <div className="flex items-center gap-3">
          {isModal ? (
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={onClose} title="סגור">
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Link to={createPageUrl('Quotes')}>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg">
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">הצעת מחיר #{quote.quote_number}</h1>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={quote.status} />
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {format(new Date(quote.created_date), 'dd/MM/yyyy HH:mm')}
              </span>
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                נוצר ע״י: <span className="font-medium text-foreground">{createdByName || 'לא ידוע'}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar — edit / duplicate / call / WhatsApp / PDF / email / convert.
          Fixed under the header in popup mode; a bordered bar on the full page.
          Same surface (border + backdrop-blur) as the order action bar. */}
      <div className={
        isModal
          ? 'flex-shrink-0 flex flex-wrap items-center justify-end gap-2 border-b border-border bg-background/95 backdrop-blur px-6 py-2.5'
          : 'flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-card'
      }>
        {canEdit && (
          isModal ? (
            <Button variant="outline" size="sm" className="h-8 text-xs text-primary" onClick={() => onEdit?.()}>
              <Pencil className="h-3.5 w-3.5 me-1.5" />
              ערוך הצעה
            </Button>
          ) : (
            <Link to={createPageUrl('EditQuote') + `?id=${quoteId}`}>
              <Button variant="outline" size="sm" className="h-8 text-xs text-primary">
                <Pencil className="h-3.5 w-3.5 me-1.5" />
                ערוך הצעה
              </Button>
            </Link>
          )
        )}
        {isOwner && (isExpired || quote.status === 'expired' || quote.status === 'rejected') && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => duplicateQuoteMutation.mutate()}
            disabled={duplicateQuoteMutation.isPending}
          >
            {duplicateQuoteMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />
            ) : (
              <Copy className="h-3.5 w-3.5 me-1.5" />
            )}
            שכפל הצעה עם תוקף חדש
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleCall} className="h-8 text-xs">
          <Phone className="h-3.5 w-3.5 me-1.5" />
          התקשר
        </Button>
        <Button variant="outline" size="sm" onClick={handleWhatsApp} className="h-8 text-xs [&_svg]:text-green-600">
          <MessageCircle className="h-3.5 w-3.5 me-1.5" />
          WhatsApp
        </Button>
        {quote.pdf_url && (
          <Button variant="outline" size="sm" onClick={() => window.open(quote.pdf_url, '_blank')} className="h-8 text-xs">
            <Download className="h-3.5 w-3.5 me-1.5" />
            הורד PDF
          </Button>
        )}
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
            <FileText className="h-3.5 w-3.5 me-1.5" />
          )}
          {quote.pdf_url ? 'צור PDF מחדש' : 'צור PDF'}
        </Button>
        {isOwner && quote.customer_email && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendEmailMutation.mutate()}
            disabled={sendEmailMutation.isPending}
            className="h-8 text-xs text-primary"
          >
            {sendEmailMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5 me-1.5" />
            )}
            שלח במייל
          </Button>
        )}
        {isOwner && (quote.status === 'sent' || quote.status === 'approved') && (
          <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/90" onClick={handleConvertToOrder}>
            <ShoppingCart className="h-3.5 w-3.5 me-1.5" />
            המר להזמנה
          </Button>
        )}
      </div>

      {/* Body — the only scrollable region in popup mode. */}
      <div className={isModal ? 'flex-1 overflow-auto px-6 pb-6 pt-4' : ''}>
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info — same dl icon-row design as the order screen: one row
              per field with a leading icon + slim label, empty rows hidden. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                פרטי לקוח
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border/30">
                {[
                  { label: 'שם לקוח', value: quote.customer_name, icon: User },
                  { label: 'טלפון', value: quote.customer_phone, icon: Phone, dir: 'ltr' },
                  { label: 'אימייל', value: quote.customer_email, icon: Mail },
                  {
                    label: 'כתובת למשלוח',
                    value: [quote.delivery_address, quote.delivery_city].filter(Boolean).join(', ') || null,
                    icon: Home,
                  },
                  { label: 'סוג נכס', value: quote.property_type === 'house' ? 'בית פרטי' : 'דירה', icon: Building2 },
                  { label: 'קומה', value: quote.floor != null ? String(quote.floor) : null, icon: Layers },
                  { label: 'מספר דירה', value: quote.apartment_number || null, icon: Hash },
                  {
                    label: 'מעלית',
                    value: quote.elevator_type === 'regular' ? 'רגילה' : quote.elevator_type === 'freight' ? 'משא' : 'אין',
                    icon: ArrowUpDown,
                  },
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
                        <dd className="text-sm text-foreground min-w-0 flex-1 truncate" dir={row.dir}>{row.value}</dd>
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
                    <TableHead className="text-right">הנחה</TableHead>
                    <TableHead className="text-right">סה"כ<div className="text-[10px] font-normal opacity-70">כולל מע״מ</div></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.items?.map((item, idx) => {
                    const addonsTotal = (item?.selected_addons || []).reduce((sum, addon) => sum + (addon?.price || 0), 0);
                    const hasAddons = (item?.selected_addons || []).length > 0;
                    const variation = item.variation_id;
                    
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <p className="font-medium">{item.name}</p>
                          {variation && (
                            <p className="text-xs text-primary mt-0.5">
                              {item.length_cm && item.width_cm ? `${item.length_cm}×${item.width_cm}` : ''}{item.height_cm ? `×${item.height_cm}` : ''} ס"מ
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
                        <TableCell>{item.discount_percent > 0 ? `${item.discount_percent}%` : '-'}</TableCell>
                        <TableCell className="font-semibold">{money2((item.total || 0) * VAT)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              
              {/* Extras */}
              {quote.extras?.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm font-medium text-foreground/80 mb-2">תוספות הובלה ושונות</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">פריט</TableHead>
                        <TableHead className="text-right">עלות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quote.extras.map((extra, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{extra.name}</TableCell>
                          <TableCell className="font-semibold">₪{extra.cost?.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Same shared summary component the create/edit forms use, so the
                  breakdown is identical everywhere. */}
              <QuoteTotalsSummary items={quote.items} extras={quote.extras} discountTotal={quote.discount_total} />
            </CardContent>
          </Card>

          {/* Terms */}
          {quote.terms && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  תנאים
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">תנאי תשלום ואספקה</p>
                  <p className="text-sm text-foreground whitespace-pre-line">{quote.terms}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status & Validity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                סטטוס ותוקף
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current status */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">סטטוס נוכחי:</span>
                <StatusBadge status={quote.status} />
              </div>

              {/* Validity info */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">תוקף עד:</span>
                {quote.valid_until ? (
                  <span className={`text-sm font-medium ${isExpired ? 'text-red-600' : 'text-foreground'}`}>
                    {format(new Date(quote.valid_until), 'dd/MM/yyyy')}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">לא הוגדר</span>
                )}
              </div>

              {/* Expiry warning */}
              {isExpired && quote.status !== 'expired' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">ההצעה פגת תוקף</p>
                    <p className="text-xs mt-0.5">יש לעדכן סטטוס לפג תוקף או לשכפל הצעה חדשה</p>
                  </div>
                </div>
              )}

              {/* Status action buttons */}
              {allowedTransitions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground font-medium">שנה סטטוס:</p>
                  <div className="grid gap-2">
                    {allowedTransitions.map((targetStatus) => {
                      const config = statusConfig[targetStatus];
                      const Icon = config.icon;
                      return (
                        <Button
                          key={targetStatus}
                          variant="outline"
                          size="sm"
                          className={`w-full justify-start gap-2 ${config.color} hover:${config.bg}`}
                          onClick={() => handleStatusChange(targetStatus)}
                          disabled={updateQuoteMutation.isPending}
                        >
                          <Icon className="h-4 w-4" />
                          {config.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lead Link */}
          {quote.lead_id && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  ליד מקושר
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  to={createPageUrl('LeadDetails') + `?id=${quote.lead_id}`}
                  className="text-primary hover:underline text-sm"
                >
                  צפה בליד
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {quote.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">הערות</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{quote.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Status change confirmation dialog */}
      <AlertDialog open={!!statusConfirm} onOpenChange={(open) => !open && setStatusConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>אישור שינוי סטטוס</AlertDialogTitle>
            <AlertDialogDescription>
              {statusConfirm && (
                <>
                  האם אתה בטוח שברצונך לשנות את סטטוס ההצעה
                  {' '}מ<strong>{statusConfig[quote.status]?.label}</strong>
                  {' '}ל<strong>{statusConfig[statusConfirm.targetStatus]?.label}</strong>?
                  {statusConfirm.targetStatus === 'approved' && (
                    <span className="block mt-2 text-emerald-600 font-medium">
                      שים לב: אישור ההצעה מאפשר המרה להזמנה.
                    </span>
                  )}
                  {statusConfirm.targetStatus === 'expired' && (
                    <span className="block mt-2 text-amber-600 font-medium">
                      שים לב: לא ניתן לערוך הצעה שפג תוקפה. ניתן לשכפל אותה.
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStatusChange}>
              אישור שינוי
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}
