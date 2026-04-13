import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, differenceInMinutes } from '@/lib/safe-date-fns';

function getSLABadge(lead) {
  const minutesElapsed = differenceInMinutes(new Date(), new Date(lead.created_date));
  
  if (minutesElapsed < 5) {
    return <Badge className="bg-green-100 text-green-800">{minutesElapsed} דק׳</Badge>;
  } else if (minutesElapsed < 15) {
    return <Badge className="bg-yellow-100 text-yellow-800">{minutesElapsed} דק׳</Badge>;
  } else {
    return <Badge className="bg-red-100 text-red-800">{minutesElapsed} דק׳</Badge>;
  }
}

export default function UnassignedLeadsWidget({ leads }) {
  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          לידים לא משויכים ({leads.length})
        </CardTitle>
        <Link to={createPageUrl('Leads') + '?filter=unassigned'}>
          <Button variant="ghost" size="sm">
            הצג הכל <ArrowLeft className="h-4 w-4 mr-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">אין לידים לא משויכים 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">זמן כניסה</TableHead>
                  <TableHead className="text-right">שם / טלפון</TableHead>
                  <TableHead className="text-right">מקור</TableHead>
                  <TableHead className="text-right">UTM Campaign</TableHead>
                  <TableHead className="text-right">SLA</TableHead>
                  <TableHead className="text-right">פעולה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map(lead => (
                  <TableRow key={lead.id} className="bg-white">
                    <TableCell className="text-sm">
                      {format(new Date(lead.created_date), 'dd/MM HH:mm')}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{lead.full_name}</p>
                      <p className="text-xs text-muted-foreground">{lead.phone}</p>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{lead.source || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{lead.utm_campaign || '-'}</span>
                    </TableCell>
                    <TableCell>
                      {getSLABadge(lead)}
                    </TableCell>
                    <TableCell>
                      <Link to={createPageUrl('LeadDetails') + `?id=${lead.id}`}>
                        <Button size="sm" variant="outline">שייך</Button>
                      </Link>
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