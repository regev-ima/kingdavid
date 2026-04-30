import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/shared/StatusBadge';
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
  MapPin,
  Calendar,
  Package,
  ExternalLink
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessFactoryWorkspace } from '@/lib/rbac';

export default function ShipmentDetails() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const shipmentId = urlParams.get('id');

  const canAccessFactory = canAccessFactoryWorkspace(effectiveUser);

  const { data: shipment, isLoading } = useQuery({
    queryKey: ['shipment', shipmentId],
    queryFn: () => base44.entities.DeliveryShipment.filter({ id: shipmentId }).then(res => res[0]),
    enabled: !!shipmentId && canAccessFactory,
  });

  // Fetch the linked order so we can show what was ordered inline, not just a
  // "view order" link that forces the rep to context-switch.
  const orderId = shipment?.order_id;
  const { data: order } = useQuery({
    queryKey: ['shipment-linked-order', orderId],
    queryFn: () => base44.entities.Order.filter({ id: orderId }).then(res => res[0] || null),
    enabled: !!orderId && canAccessFactory,
    staleTime: 60_000,
  });

  const updateShipmentMutation = useMutation({
    mutationFn: (data) => base44.entities.DeliveryShipment.update(shipmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['shipment', shipmentId]);
    },
  });

  if (isLoadingUser || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canAccessFactory) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לצפות במשלוחים</p>
        <Link to={createPageUrl('Deliveries')}>
          <Button className="mt-4">חזור לרשימת המשלוחים</Button>
        </Link>
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">המשלוח לא נמצא</p>
        <Link to={createPageUrl('Deliveries')}>
          <Button className="mt-4">חזור לרשימת המשלוחים</Button>
        </Link>
      </div>
    );
  }

  const handleCall = () => {
    const phone = shipment.contact_phone || shipment.customer_phone;
    if (phone) {
      window.open(`tel:${phone}`, '_self');
    }
  };

  const handleWhatsApp = () => {
    const phone = (shipment.contact_phone || shipment.customer_phone || '').replace(/[^0-9]/g, '');
    if (phone) {
      window.open(`https://wa.me/972${phone.startsWith('0') ? phone.slice(1) : phone}`, '_blank');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Deliveries')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">משלוח #{shipment.shipment_number}</h1>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={shipment.status} />
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
          {/* Address */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                כתובת למשלוח
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">לקוח</p>
                  <p className="font-medium">{shipment.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">טלפון</p>
                  <p className="font-medium">{shipment.customer_phone}</p>
                </div>
              </div>
              
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">{shipment.address}</p>
                <p className="text-muted-foreground">{shipment.city}</p>
                {shipment.floor && (
                  <p className="text-sm text-muted-foreground mt-2">
                    קומה {shipment.floor} • {shipment.has_elevator ? 'יש מעלית' : 'אין מעלית'}
                  </p>
                )}
              </div>

              {shipment.access_notes && (
                <div>
                  <p className="text-sm text-muted-foreground">הערות גישה</p>
                  <p>{shipment.access_notes}</p>
                </div>
              )}

              {(shipment.contact_name || shipment.contact_phone) && (
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <p className="text-sm text-muted-foreground">איש קשר</p>
                    <p className="font-medium">{shipment.contact_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">טלפון איש קשר</p>
                    <p className="font-medium">{shipment.contact_phone || '-'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scheduling */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                תיאום משלוח
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>תאריך</Label>
                  <Input
                    type="date"
                    value={shipment.scheduled_date || ''}
                    onChange={(e) => updateShipmentMutation.mutate({ scheduled_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>חלון זמן</Label>
                  <Select
                    value={shipment.time_window || ''}
                    onValueChange={(val) => updateShipmentMutation.mutate({ time_window: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר חלון זמן" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">בוקר (08:00-12:00)</SelectItem>
                      <SelectItem value="afternoon">צהריים (12:00-16:00)</SelectItem>
                      <SelectItem value="evening">ערב (16:00-20:00)</SelectItem>
                      <SelectItem value="all_day">כל היום</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>חברת משלוחים</Label>
                  <Input
                    value={shipment.carrier || ''}
                    onChange={(e) => updateShipmentMutation.mutate({ carrier: e.target.value })}
                    placeholder="שם המוביל"
                  />
                </div>
                <div className="space-y-2">
                  <Label>מספר מעקב</Label>
                  <Input
                    value={shipment.tracking_id || ''}
                    onChange={(e) => updateShipmentMutation.mutate({ tracking_id: e.target.value })}
                    placeholder="מספר מעקב"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>הערות</Label>
                <Textarea
                  value={shipment.notes || ''}
                  onChange={(e) => updateShipmentMutation.mutate({ notes: e.target.value })}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* Order contents */}
          {orderId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  הזמנה {order?.order_number ? `#${order.order_number}` : 'מקושרת'}
                </CardTitle>
                <Link
                  to={createPageUrl('OrderDetails') + `?id=${orderId}`}
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  צפה בהזמנה המלאה
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </CardHeader>
              <CardContent>
                {!order ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    טוען פרטי הזמנה…
                  </div>
                ) : (order.items || []).length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4">אין פריטים בהזמנה זו.</p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">מוצר</TableHead>
                          <TableHead className="text-right">מק״ט</TableHead>
                          <TableHead className="text-right">כמות</TableHead>
                          <TableHead className="text-right">מחיר</TableHead>
                          <TableHead className="text-right">סה״כ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {order.items.map((item, idx) => {
                          const addons = item?.selected_addons || [];
                          const addonsTotal = addons.reduce((sum, a) => sum + (a?.price || 0), 0);
                          return (
                            <TableRow key={idx}>
                              <TableCell>
                                <p className="font-medium">{item.name}</p>
                                {item.length_cm && item.width_cm && (
                                  <p className="text-xs text-primary mt-0.5">
                                    {item.length_cm}×{item.width_cm}{item.height_cm ? `×${item.height_cm}` : ''} ס״מ
                                  </p>
                                )}
                                {addons.length > 0 && (
                                  <div className="text-xs text-primary mt-1 space-y-0.5">
                                    <p className="font-medium">תוספות:</p>
                                    {addons.map((a, i) => (
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

                    <div className="mt-4 pt-4 border-t space-y-2 text-sm">
                      {order.subtotal != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">סכום ביניים</span>
                          <span>₪{order.subtotal?.toLocaleString()}</span>
                        </div>
                      )}
                      {order.discount_total > 0 && (
                        <div className="flex justify-between text-red-600">
                          <span>הנחות</span>
                          <span>-₪{order.discount_total?.toLocaleString()}</span>
                        </div>
                      )}
                      {order.vat_amount != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">מע״מ</span>
                          <span>₪{order.vat_amount?.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-bold pt-2 border-t">
                        <span>סה״כ הזמנה</span>
                        <span>₪{order.total?.toLocaleString()}</span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Failure Info */}
          {shipment.status === 'failed' && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-700">סיבת כישלון</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={shipment.failure_reason || ''}
                  onChange={(e) => updateShipmentMutation.mutate({ failure_reason: e.target.value })}
                  rows={2}
                  placeholder="מה הסיבה לכישלון המשלוח?"
                />
              </CardContent>
            </Card>
          )}
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
                value={shipment.status}
                onValueChange={(val) => updateShipmentMutation.mutate({ status: val })}
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
            </CardContent>
          </Card>

          {/* Proof of Delivery */}
          {shipment.status === 'delivered' && (
            <Card>
              <CardHeader>
                <CardTitle>אישור מסירה</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>תאריך מסירה בפועל</Label>
                  <Input
                    type="date"
                    value={shipment.delivered_date || ''}
                    onChange={(e) => updateShipmentMutation.mutate({ delivered_date: e.target.value })}
                  />
                </div>
                {shipment.proof_of_delivery_url && (
                  <a 
                    href={shipment.proof_of_delivery_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm mt-2 block"
                  >
                    צפה באישור מסירה
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
