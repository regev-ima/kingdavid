import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/shared/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Clock,
  AlertTriangle
} from "lucide-react";
import { format, isPast } from 'date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSupportWorkspace, canViewSupportTicket } from '@/lib/rbac';

const categoryLabels = {
  delivery: 'משלוח',
  quality: 'איכות',
  return: 'החזרה',
  trial: 'ניסיון 30 יום',
  billing: 'חיוב',
  warranty: 'אחריות',
  other: 'אחר'
};

export default function TicketDetails() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const ticketId = urlParams.get('id');

  const canAccessSupport = canAccessSupportWorkspace(effectiveUser);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => base44.entities.SupportTicket.filter({ id: ticketId }).then(res => res[0]),
    enabled: !!ticketId && canAccessSupport,
  });

  const updateTicketMutation = useMutation({
    mutationFn: (data) => base44.entities.SupportTicket.update(ticketId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['ticket', ticketId]);
    },
  });

  if (isLoadingUser || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canAccessSupport) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בקריאות שירות</p>
        <Link to={createPageUrl('Support')}>
          <Button className="mt-4">חזור לרשימת הקריאות</Button>
        </Link>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הקריאה לא נמצאה</p>
        <Link to={createPageUrl('Support')}>
          <Button className="mt-4">חזור לרשימת הקריאות</Button>
        </Link>
      </div>
    );
  }

  if (!canViewSupportTicket(effectiveUser, ticket)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות בקריאה זו</p>
        <Link to={createPageUrl('Support')}>
          <Button className="mt-4">חזור לרשימת הקריאות</Button>
        </Link>
      </div>
    );
  }

  const handleCall = () => {
    if (ticket?.customer_phone) {
      window.open(`tel:${ticket.customer_phone}`, '_self');
    }
  };

  const handleWhatsApp = () => {
    const phone = (ticket?.customer_phone || '').replace(/[^0-9]/g, '');
    if (phone) {
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}`, '_blank');
    }
  };

  const isOverdue = ticket.sla_due_date && isPast(new Date(ticket.sla_due_date)) && !['resolved', 'closed'].includes(ticket.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Support')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">קריאה #{ticket.ticket_number}</h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={ticket.status} />
              <StatusBadge status={ticket.priority} />
              {isOverdue && (
                <span className="flex items-center gap-1 text-red-600 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  חריגת SLA
                </span>
              )}
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
          {/* Ticket Info */}
          <Card>
            <CardHeader>
              <CardTitle>{ticket.subject}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">לקוח</p>
                  <p className="font-medium">{ticket.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">טלפון</p>
                  <p className="font-medium">{ticket.customer_phone}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">קטגוריה</p>
                  <p className="font-medium">{categoryLabels[ticket.category]}</p>
                </div>
              </div>
              
              {ticket.description && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-2">תיאור</p>
                  <p className="text-foreground/80">{ticket.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Resolution */}
          <Card>
            <CardHeader>
              <CardTitle>טיפול ופתרון</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>סיבת שורש</Label>
                <Textarea
                  value={ticket.root_cause || ''}
                  onChange={(e) => updateTicketMutation.mutate({ root_cause: e.target.value })}
                  rows={2}
                  placeholder="מה גרם לבעיה?"
                />
              </div>
              <div className="space-y-2">
                <Label>פתרון</Label>
                <Textarea
                  value={ticket.resolution || ''}
                  onChange={(e) => updateTicketMutation.mutate({ resolution: e.target.value })}
                  rows={3}
                  placeholder="איך הבעיה נפתרה?"
                />
              </div>
              <div className="space-y-2">
                <Label>הערות פנימיות</Label>
                <Textarea
                  value={ticket.internal_notes || ''}
                  onChange={(e) => updateTicketMutation.mutate({ internal_notes: e.target.value })}
                  rows={2}
                  placeholder="הערות לשימוש פנימי..."
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>סטטוס</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={ticket.status}
                onValueChange={(val) => updateTicketMutation.mutate({ status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">פתוח</SelectItem>
                  <SelectItem value="in_progress">בטיפול</SelectItem>
                  <SelectItem value="waiting_customer">ממתין ללקוח</SelectItem>
                  <SelectItem value="waiting_factory">ממתין למפעל</SelectItem>
                  <SelectItem value="waiting_logistics">ממתין ללוגיסטיקה</SelectItem>
                  <SelectItem value="resolved">נפתר</SelectItem>
                  <SelectItem value="closed">סגור</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Priority */}
          <Card>
            <CardHeader>
              <CardTitle>עדיפות</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={ticket.priority}
                onValueChange={(val) => updateTicketMutation.mutate({ priority: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">נמוך</SelectItem>
                  <SelectItem value="medium">בינוני</SelectItem>
                  <SelectItem value="high">גבוה</SelectItem>
                  <SelectItem value="urgent">דחוף</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* SLA */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                SLA
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.sla_due_date ? (
                <div className={isOverdue ? 'text-red-600' : ''}>
                  <p className="font-medium">
                    {format(new Date(ticket.sla_due_date), 'dd/MM/yyyy HH:mm')}
                  </p>
                  {isOverdue && (
                    <p className="text-sm mt-1">חריגת SLA!</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">לא הוגדר</p>
              )}
            </CardContent>
          </Card>

          {/* Order Link */}
          {ticket.order_id && (
            <Card>
              <CardHeader>
                <CardTitle>הזמנה מקושרת</CardTitle>
              </CardHeader>
              <CardContent>
                <Link 
                  to={createPageUrl('OrderDetails') + `?id=${ticket.order_id}`}
                  className="text-primary hover:underline"
                >
                  צפה בהזמנה
                </Link>
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
                    <p className="font-medium">קריאה נפתחה</p>
                    <p className="text-muted-foreground">{format(new Date(ticket.created_date), 'dd/MM/yyyy HH:mm')}</p>
                  </div>
                </div>
                {ticket.updated_date !== ticket.created_date && (
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40"></div>
                    <div>
                      <p className="font-medium">עודכן לאחרונה</p>
                      <p className="text-muted-foreground">{format(new Date(ticket.updated_date), 'dd/MM/yyyy HH:mm')}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
