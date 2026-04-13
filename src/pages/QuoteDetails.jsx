import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
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
  AlertTriangle
} from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { buildLeadsById, canViewQuote } from '@/lib/rbac';

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

export default function QuoteDetails() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [statusConfirm, setStatusConfirm] = useState(null); // { targetStatus }
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const urlParams = new URLSearchParams(window.location.search);
  const quoteId = urlParams.get('id');

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

  const updateQuoteMutation = useMutation({
    mutationFn: (data) => base44.entities.Quote.update(quoteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['quote', quoteId]);
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!quote.pdf_url) {
        const pdfUrl = await QuotePdfGenerator(quote);
        await base44.entities.Quote.update(quoteId, { pdf_url: pdfUrl, status: 'sent' });
      }

      await base44.integrations.Core.SendEmail({
        to: quote.customer_email,
        subject: `הצעת מחיר מס׳ ${quote.quote_number} - קינג דוד`,
        body: `שלום ${quote.customer_name}, מצורפת הצעת מחיר מס׳ ${quote.quote_number}.`,
        quote_number: quote.quote_number,
        customer_name: quote.customer_name,
        total: quote.total?.toLocaleString(),
        pdf_url: quote.pdf_url,
        valid_until: quote.valid_until ? format(new Date(quote.valid_until), 'dd/MM/yyyy') : '',
      });

      await base44.entities.Quote.update(quoteId, { status: 'sent' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['quote', quoteId]);
    },
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
      navigate(createPageUrl('QuoteDetails') + `?id=${newQuote.id}`);
    },
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
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור לרשימת ההצעות</Button>
        </Link>
      </div>
    );
  }

  if (!canViewQuote(effectiveUser, quote, buildLeadsById(lead ? [lead] : []))) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בהצעת מחיר זו</p>
        <Link to={createPageUrl('Quotes')}>
          <Button className="mt-4">חזור לרשימת ההצעות</Button>
        </Link>
      </div>
    );
  }

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  const canEdit = quote.status === 'draft' && !isExpired;
  const allowedTransitions = isExpired && quote.status !== 'expired'
    ? ['expired']
    : (statusTransitions[quote.status] || []);

  const handleStatusChange = (targetStatus) => {
    setStatusConfirm({ targetStatus });
  };

  const confirmStatusChange = async () => {
    if (statusConfirm) {
      updateQuoteMutation.mutate({ status: statusConfirm.targetStatus });
      // When approving a quote, auto-update the linked lead to deal_closed
      if (statusConfirm.targetStatus === 'approved' && quote.lead_id) {
        try {
          await base44.entities.Lead.update(quote.lead_id, { status: 'deal_closed' });
        } catch (e) {
          console.error('Failed to update lead status:', e);
        }
      }
      setStatusConfirm(null);
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
    navigate(createPageUrl('NewOrder') + `?quote_id=${quoteId}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Quotes')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">הצעת מחיר #{quote.quote_number}</h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={quote.status} />
              <span className="text-sm text-muted-foreground">
                {format(new Date(quote.created_date), 'dd/MM/yyyy HH:mm')}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link to={createPageUrl('EditQuote') + `?id=${quoteId}`}>
              <Button variant="outline" className="text-primary">
                <Pencil className="h-4 w-4 me-2" />
                ערוך הצעה
              </Button>
            </Link>
          )}
          {(isExpired || quote.status === 'expired' || quote.status === 'rejected') && (
            <Button
              variant="outline"
              onClick={() => duplicateQuoteMutation.mutate()}
              disabled={duplicateQuoteMutation.isPending}
            >
              {duplicateQuoteMutation.isPending ? (
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <Copy className="h-4 w-4 me-2" />
              )}
              שכפל הצעה עם תוקף חדש
            </Button>
          )}
          <Button variant="outline" onClick={handleCall}>
            <Phone className="h-4 w-4 me-2" />
            התקשר
          </Button>
          <Button variant="outline" onClick={handleWhatsApp} className="[&_svg]:text-green-600">
            <MessageCircle className="h-4 w-4 me-2" />
            WhatsApp
          </Button>
          {quote.pdf_url && (
            <Button variant="outline" onClick={() => window.open(quote.pdf_url, '_blank')}>
              <Download className="h-4 w-4 me-2" />
              הורד PDF
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={() => generatePdfMutation.mutate()} 
            disabled={generatePdfMutation.isPending}
          >
            {generatePdfMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 me-2" />
            )}
            {quote.pdf_url ? 'צור PDF מחדש' : 'צור PDF'}
          </Button>
          {quote.customer_email && (
            <Button 
              variant="outline" 
              onClick={() => sendEmailMutation.mutate()}
              disabled={sendEmailMutation.isPending}
              className="text-primary"
            >
              {sendEmailMutation.isPending ? (
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 me-2" />
              )}
              שלח במייל
            </Button>
          )}
          {(quote.status === 'sent' || quote.status === 'approved') && (
            <Button className="bg-primary hover:bg-primary/90" onClick={handleConvertToOrder}>
              <ShoppingCart className="h-4 w-4 me-2" />
              המר להזמנה
            </Button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle>פרטי לקוח</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">שם לקוח</p>
                  <p className="font-medium text-foreground">{quote.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">טלפון</p>
                  <p className="font-medium text-foreground" dir="ltr">{quote.customer_phone}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">אימייל</p>
                  <p className="font-medium text-foreground">{quote.customer_email || '-'}</p>
                </div>
                <div className="sm:col-span-2 md:col-span-3 pt-4 border-t border-border/50">
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2">
                      <p className="text-sm text-muted-foreground mb-1">כתובת למשלוח</p>
                      <p className="font-medium text-foreground">
                        {quote.delivery_address || 'לא הוזן'} 
                        {quote.delivery_city ? `, ${quote.delivery_city}` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">סוג נכס</p>
                      <p className="font-medium text-foreground">
                        {quote.property_type === 'house' ? 'בית פרטי' : 'דירה'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">קומה</p>
                      <p className="font-medium text-foreground">{quote.floor ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">מספר דירה</p>
                      <p className="font-medium text-foreground">{quote.apartment_number || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">מעלית</p>
                      <p className="font-medium text-foreground">
                        {quote.elevator_type === 'regular' ? 'רגילה' : quote.elevator_type === 'freight' ? 'משא' : 'אין'}
                      </p>
                    </div>
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
                    <TableHead className="text-right">הנחה</TableHead>
                    <TableHead className="text-right">סה"כ</TableHead>
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
                        <TableCell>{item.discount_percent > 0 ? `${item.discount_percent}%` : '-'}</TableCell>
                        <TableCell className="font-semibold">₪{item.total?.toLocaleString()}</TableCell>
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

              <div className="mt-4 pt-4 border-t space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">סכום ביניים</span>
                  <span>₪{quote.subtotal?.toLocaleString()}</span>
                </div>
                {quote.discount_total > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>הנחות</span>
                    <span>-₪{quote.discount_total?.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">מע"מ (18%)</span>
                  <span>₪{quote.vat_amount?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xl font-bold pt-2 border-t">
                  <span>סה"כ לתשלום</span>
                  <span className="text-primary">₪{quote.total?.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Terms */}
          {(quote.terms || quote.warranty_terms) && (
            <Card>
              <CardHeader>
                <CardTitle>תנאים ואחריות</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {quote.terms && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">תנאי תשלום ואספקה</p>
                    <p>{quote.terms}</p>
                  </div>
                )}
                {quote.warranty_terms && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">אחריות</p>
                    <p>{quote.warranty_terms}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status & Validity */}
          <Card>
            <CardHeader>
              <CardTitle>סטטוס ותוקף</CardTitle>
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
                <CardTitle>ליד מקושר</CardTitle>
              </CardHeader>
              <CardContent>
                <Link 
                  to={createPageUrl('LeadDetails') + `?id=${quote.lead_id}`}
                  className="text-primary hover:underline"
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
                <CardTitle>הערות</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{quote.notes}</p>
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
  );
}
