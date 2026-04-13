import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp } from "lucide-react";
import { differenceInMinutes } from '@/lib/safe-date-fns';
import UserAvatar from '@/components/shared/UserAvatar';

export default function RepPerformanceWidget({ leads, callLogs, users = [] }) {
  const salesReps = users.filter(u => u.role === 'user' || u.role === 'admin');

  const repStats = salesReps.map(rep => {
    const repLeads = leads.filter(l => l.rep1 === rep.email || l.rep2 === rep.email);
    const openLeads = repLeads.filter(l => !['won', 'lost', 'archived'].includes(l.status));
    const newLeads = repLeads.filter(l => l.status === 'new');
    
    const slaRedCount = repLeads.filter(l => {
      if (l.first_action_at) return false;
      const minutesElapsed = differenceInMinutes(new Date(), new Date(l.created_date));
      return minutesElapsed > 15;
    }).length;

    const repCallLogs = callLogs.filter(log => {
      const lead = leads.find(l => l.id === log.lead_id);
      return lead && (lead.rep1 === rep.email || lead.rep2 === rep.email);
    });

    let avgFirstResponse = 0;
    if (repCallLogs.length > 0) {
      const responseTimes = repCallLogs.map(log => {
        const lead = leads.find(l => l.id === log.lead_id);
        if (!lead) return 0;
        return differenceInMinutes(new Date(log.call_started_at), new Date(lead.created_date));
      });
      avgFirstResponse = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    }

    return {
      name: rep.full_name,
      email: rep.email,
      user: rep,
      openLeads: openLeads.length,
      newLeads: newLeads.length,
      avgFirstResponse,
      slaRedCount,
    };
  });

  repStats.sort((a, b) => b.openLeads - a.openLeads);

  return (
    <Card className="border-border shadow-sm rounded-xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <div className="p-1.5 rounded-md bg-primary/10">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          ביצועי נציגים
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50">
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">נציג</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">פתוחים</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">חדשים</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">זמן תגובה</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">SLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repStats.map(rep => (
                <TableRow key={rep.email} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                  <TableCell className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={rep.user} size="sm" />
                      <span className="font-medium text-sm text-foreground">{rep.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-foreground/80">
                      {rep.openLeads}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-700">
                      {rep.newLeads}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground py-2.5 px-4">
                    {rep.avgFirstResponse > 0 ? `${rep.avgFirstResponse} דק׳` : '-'}
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                      rep.slaRedCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {rep.slaRedCount}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}