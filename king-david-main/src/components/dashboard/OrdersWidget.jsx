import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatusBadge from '@/components/shared/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShoppingCart, ArrowLeft } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';

export default function OrdersWidget({ orders }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-emerald-600" />
          הזמנות חדשות ({orders.length})
        </CardTitle>
        <Link to={createPageUrl('Orders')}>
          <Button variant="ghost" size="sm">
            הצג הכל <ArrowLeft className="h-4 w-4 mr-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">אין הזמנות חדשות</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">מס׳ הזמנה</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">סכום</TableHead>
                  <TableHead className="text-right">תשלום</TableHead>
                  <TableHead className="text-right">ייצור</TableHead>
                  <TableHead className="text-right">משלוח</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link 
                        to={createPageUrl('OrderDetails') + `?id=${order.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        #{order.order_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{order.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                    </TableCell>
                    <TableCell className="font-semibold">
                      ₪{order.total?.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.payment_status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.production_status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.delivery_status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(order.created_date), 'dd/MM/yy')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}