import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Truck, Package, Calendar, MapPin, Phone, User, FileText, Clock } from "lucide-react";
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function ScheduledShipmentsView({ shipments, orders }) {
  // סינון משלוחים מתוכננים בלבד
  const scheduledShipments = shipments.filter(s => s.status === 'scheduled' && s.scheduled_date);

  // יצירת מפה של הזמנות
  const ordersMap = {};
  orders?.forEach(order => {
    ordersMap[order.id] = order;
  });

  // קיבוץ לפי תאריך ואחר כך לפי מסלול
  const groupedByDate = scheduledShipments.reduce((acc, shipment) => {
    const date = shipment.scheduled_date;
    if (!acc[date]) {
      acc[date] = {};
    }
    
    const carrier = shipment.carrier || 'לא מוגדר';
    if (!acc[date][carrier]) {
      acc[date][carrier] = [];
    }
    
    acc[date][carrier].push(shipment);
    return acc;
  }, {});

  // מיון תאריכים
  const sortedDates = Object.keys(groupedByDate).sort();

  if (scheduledShipments.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Truck className="h-16 w-16 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-lg mb-2">אין משלוחים מתוכננים כרגע</p>
          <p className="text-sm text-muted-foreground/70">השתמש בשיבוץ האוטומטי כדי לשבץ משלוחים</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* סיכום כללי */}
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-green-600 p-4 rounded-xl shadow-lg">
                <Truck className="h-8 w-8 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-xl text-foreground">משלוחים מתוכננים</h3>
                <p className="text-muted-foreground mt-1">
                  <span className="font-semibold text-green-700">{scheduledShipments.length}</span> משלוחים ב-
                  <span className="font-semibold text-green-700">{sortedDates.length}</span> ימי משלוח
                </p>
              </div>
            </div>
            <div className="text-center bg-white px-6 py-4 rounded-lg shadow-sm">
              <p className="text-4xl font-bold text-green-600">{scheduledShipments.length}</p>
              <p className="text-sm text-muted-foreground mt-1">סה"כ</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* תצוגה לפי תאריכים */}
      {sortedDates.map((date, dateIdx) => {
        const carriers = groupedByDate[date];
        const dateObj = parseISO(date);
        const totalShipmentsForDate = Object.values(carriers).reduce((sum, arr) => sum + arr.length, 0);
        
        return (
          <Card key={date} className="overflow-hidden border-2 shadow-md">
            {/* כותרת התאריך */}
            <CardHeader className="bg-gradient-to-r from-primary to-purple-600 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-white/20 p-3 rounded-lg backdrop-blur-sm">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl font-bold">
                      {format(dateObj, 'EEEE', { locale: he })}
                    </CardTitle>
                    <p className="text-primary-foreground/70 mt-1 text-sm">
                      {format(dateObj, 'd MMMM yyyy', { locale: he })} • {Object.keys(carriers).length} מסלולים • {totalShipmentsForDate} משלוחים
                    </p>
                  </div>
                </div>
                <Badge className="bg-white/20 text-white text-lg px-4 py-2 backdrop-blur-sm">
                  יום #{dateIdx + 1}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* עבור כל מסלול בתאריך */}
              {Object.entries(carriers).map(([carrier, carrierShipments], carrierIdx) => {
                const uniqueCities = [...new Set(carrierShipments.map(s => s.city))];
                
                return (
                  <div 
                    key={carrier} 
                    className={`${carrierIdx !== 0 ? 'border-t-2 border-border' : ''}`}
                  >
                    {/* כותרת מסלול */}
                    <div className="bg-gradient-to-r from-purple-50 to-primary/5 px-6 py-4 border-b">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="bg-gradient-to-br from-purple-500 to-primary p-3 rounded-xl shadow-md">
                            <Truck className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <h4 className="font-bold text-lg text-foreground">{carrier}</h4>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Package className="h-4 w-4" />
                                {carrierShipments.length} משלוחים
                              </span>
                              <span className="flex items-center gap-1">
                                <MapPin className="h-4 w-4" />
                                {uniqueCities.length} ערים
                              </span>
                            </div>
                          </div>
                        </div>
                        <Badge className="bg-gradient-to-r from-purple-600 to-primary text-white text-base px-4 py-2">
                          משאית #{carrierIdx + 1}
                        </Badge>
                      </div>
                    </div>

                    {/* רשימת משלוחים */}
                    <div className="divide-y divide-border/50">
                      {carrierShipments.map((shipment, shipIdx) => {
                        const order = ordersMap[shipment.order_id];
                        
                        return (
                          <div 
                            key={shipment.id}
                            className="flex items-center gap-4 px-6 py-4 hover:bg-primary/5 transition-colors"
                          >
                            {/* מספר סידורי */}
                            <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-primary to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                              <span className="font-bold text-white text-lg">
                                {shipIdx + 1}
                              </span>
                            </div>
                            
                            {/* תוכן המשלוח */}
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                              {/* לקוח */}
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <User className="h-5 w-5 text-primary" />
                                  <span className="font-bold text-foreground">{shipment.customer_name}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Phone className="h-4 w-4 text-muted-foreground/70" />
                                  <span>{shipment.customer_phone}</span>
                                </div>
                              </div>
                              
                              {/* מיקום */}
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <MapPin className="h-5 w-5 text-purple-600" />
                                  <span className="font-semibold text-foreground">{shipment.city}</span>
                                </div>
                                <p className="text-sm text-muted-foreground truncate">{shipment.address}</p>
                              </div>
                              
                              {/* הזמנה וזמן */}
                              <div>
                                {order && (
                                  <div className="flex items-center gap-2 mb-1">
                                    <Package className="h-5 w-5 text-emerald-600" />
                                    <span className="font-medium text-foreground text-sm">
                                      {order.order_number || `ORD-${order.id.slice(-8)}`}
                                    </span>
                                  </div>
                                )}
                                {shipment.time_window && (
                                  <Badge variant="outline" className="text-xs">
                                    <Clock className="h-3 w-3 me-1" />
                                    {shipment.time_window === 'morning' ? 'בוקר 08:00-12:00' :
                                     shipment.time_window === 'afternoon' ? 'צהריים 12:00-16:00' :
                                     shipment.time_window === 'evening' ? 'ערב 16:00-20:00' : 'כל היום'}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* פעולות */}
                            <div className="flex-shrink-0">
                              <Link to={createPageUrl('ShipmentDetails') + `?id=${shipment.id}`}>
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  className="text-primary hover:text-primary/80 hover:bg-primary/5"
                                >
                                  <FileText className="h-4 w-4 me-1" />
                                  פרטים
                                </Button>
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}