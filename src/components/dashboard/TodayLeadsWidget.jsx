import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatusBadge from '@/components/shared/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Phone, MessageCircle, UserPlus, ArrowLeft } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, differenceInMinutes } from 'date-fns';

function getSLABadge(lead) {
  if (lead.first_action_at) {
    return <Badge className="bg-green-100 text-green-800">טופל</Badge>;
  }
  
  const minutesElapsed = differenceInMinutes(new Date(), new Date(lead.created_date));
  
  if (minutesElapsed < 5) {
    return <Badge className="bg-green-100 text-green-800">{minutesElapsed} דק׳</Badge>;
  } else if (minutesElapsed < 15) {
    return <Badge className="bg-yellow-100 text-yellow-800">{minutesElapsed} דק׳</Badge>;
  } else {
    return <Badge className="bg-red-100 text-red-800">{minutesElapsed} דק׳</Badge>;
  }
}

export default function TodayLeadsWidget({ leads, users = [] }) {
  const handleCall = (phone) => {
    window.open(`tel:${phone}`, '_self');
  };

  const handleWhatsApp = (phone) => {
    const cleaned = phone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/972${cleaned.startsWith('0') ? cleaned.slice(1) : cleaned}`, '_blank');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg font-semibold">לידים חדשים היום ({leads.length})</CardTitle>
        <Link to={createPageUrl('Leads')}>
          <Button variant="ghost" size="sm">
            הצג הכל <ArrowLeft className="h-4 w-4 mr-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">אין לידים חדשים היום</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">זמן</TableHead>
                  <TableHead className="text-right">שם / טלפון</TableHead>
                  <TableHead className="text-right">מקור</TableHead>
                  <TableHead className="text-right">נציג</TableHead>
                  <TableHead className="text-right">SLA</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map(lead => {
                  const rep = users.find(u => u.email === lead.rep1);
                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="text-sm">
                        {format(new Date(lead.created_date), 'HH:mm')}
                      </TableCell>
                      <TableCell>
                        <Link 
                          to={createPageUrl('LeadDetails') + `?id=${lead.id}`}
                          className="hover:underline"
                        >
                          <p className="font-medium">{lead.full_name}</p>
                          <p className="text-xs text-muted-foreground">{lead.phone}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{lead.source || '-'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{rep?.full_name || 'לא משויך'}</span>
                      </TableCell>
                      <TableCell>
                        {getSLABadge(lead)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => handleCall(lead.phone)}
                          >
                            <Phone className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => handleWhatsApp(lead.phone)}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}