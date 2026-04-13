import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PhoneOff } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from '@/lib/safe-date-fns';

export default function NoAnswerWidget({ callLogs, whatsappLogs, leads }) {
  const noAnswerCalls = callLogs.filter(log => 
    log.call_result === 'no_answer' || log.call_result === 'busy'
  );

  const autoWhatsApps = whatsappLogs.filter(log => log.message_type === 'auto');

  const recentNoAnswer = noAnswerCalls.slice(0, 10).map(log => {
    const lead = leads.find(l => l.id === log.lead_id);
    const waLog = whatsappLogs.find(w => w.lead_id === log.lead_id);
    return { ...log, lead, whatsappSent: !!waLog };
  }).filter(item => item.lead);

  const returnRate = autoWhatsApps.length > 0
    ? Math.round((autoWhatsApps.filter(wa => {
        const lead = leads.find(l => l.id === wa.lead_id);
        return lead && lead.status !== 'new';
      }).length / autoWhatsApps.length) * 100)
    : 0;

  return (
    <Card className="border-border shadow-sm rounded-xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <div className="p-1.5 rounded-md bg-orange-100">
            <PhoneOff className="h-4 w-4 text-orange-600" />
          </div>
          שיחות ללא מענה + WhatsApp אוטומטי
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-100">
            <p className="text-2xl font-bold text-orange-600">{noAnswerCalls.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">ללא מענה / תפוס</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg border border-green-100">
            <p className="text-2xl font-bold text-green-600">{autoWhatsApps.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">WhatsApp נשלח</p>
          </div>
          <div className="text-center p-3 bg-primary/5 rounded-lg border border-primary/10">
            <p className="text-2xl font-bold text-primary">{returnRate}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">% חזרו אחרי WA</p>
          </div>
        </div>

        {recentNoAnswer.length > 0 && (
          <div className="overflow-x-auto -mx-4 px-4">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/50">
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground py-2">שם</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground py-2">זמן שיחה</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground py-2">WhatsApp</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground py-2">פעולה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentNoAnswer.slice(0, 5).map((item, idx) => (
                  <TableRow key={idx} className="border-b border-border/30 last:border-b-0">
                    <TableCell className="py-2">
                      <p className="font-medium text-sm text-foreground">{item.lead.full_name}</p>
                      <p className="text-xs text-muted-foreground">{item.lead.phone}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-2">
                      {format(new Date(item.call_started_at), 'dd/MM HH:mm')}
                    </TableCell>
                    <TableCell className="py-2">
                      {item.whatsappSent ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-700">נשלח</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">לא נשלח</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <Link to={createPageUrl('LeadDetails') + `?id=${item.lead.id}`}>
                        <Button size="sm" variant="outline" className="h-7 text-xs">עקוב</Button>
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