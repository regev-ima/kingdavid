import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingUp } from "lucide-react";
import UserAvatar from '@/components/shared/UserAvatar';

const formatNumber = (num) => {
  return new Intl.NumberFormat('en-US').format(num || 0);
};

export default function RepPerformanceFromCounters({ data }) {
  const repStats = data || [];

  return (
    <Card className="border-border shadow-card rounded-xl overflow-hidden">
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
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סה"כ לידים</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">פתוחים</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגורים</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">חדשים</TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">SLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repStats.map(rep => (
                <TableRow key={rep.email} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                  <TableCell className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={{ full_name: rep.name, profile_icon: rep.profile_icon }} size="sm" />
                      <span className="font-medium text-sm text-foreground">{rep.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary">
                      {formatNumber(rep.totalLeads)}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-700">
                      {formatNumber(rep.openLeads)}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                      {formatNumber(rep.closedLeads)}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-700">
                      {formatNumber(rep.newLeads)}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                      rep.slaRedCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {formatNumber(rep.slaRedCount)}
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