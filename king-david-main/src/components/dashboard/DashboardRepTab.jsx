import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, AlertTriangle, Trophy, Crown } from "lucide-react";
import UserAvatar from '@/components/shared/UserAvatar';

const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num || 0);

export default function DashboardRepTab({ stats }) {
  const [sortBy, setSortBy] = useState('revenue');

  const repStats = useMemo(() => {
    const data = stats?.rep_performance || [];
    return [...data].sort((a, b) => {
      switch (sortBy) {
        case 'revenue': return b.revenue - a.revenue;
        case 'leads': return b.totalLeads - a.totalLeads;
        case 'conversion': return b.conversionRate - a.conversionRate;
        case 'sla': return b.slaCompliance - a.slaCompliance;
        default: return 0;
      }
    });
  }, [stats?.rep_performance, sortBy]);

  const topRep = repStats.length > 0
    ? repStats.reduce((best, r) => r.revenue > best.revenue ? r : best, repStats[0])
    : null;

  const worstSlaRep = repStats.length > 0
    ? repStats.reduce((worst, r) => r.slaRedCount > worst.slaRedCount ? r : worst, repStats[0])
    : null;

  const getConversionColor = (rate) => {
    if (rate >= 20) return 'bg-emerald-100 text-emerald-700';
    if (rate >= 10) return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  };

  const getSlaColor = (rate) => {
    if (rate >= 90) return 'bg-emerald-100 text-emerald-700';
    if (rate >= 70) return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div className="space-y-6">
      {/* Sort Selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">מיין לפי:</span>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="revenue">הכנסות</SelectItem>
            <SelectItem value="leads">לידים</SelectItem>
            <SelectItem value="conversion">המרה</SelectItem>
            <SelectItem value="sla">SLA</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Highlight Cards */}
      {(topRep || (worstSlaRep && worstSlaRep.slaRedCount > 0)) && (
        <div className="grid md:grid-cols-2 gap-4">
          {topRep && topRep.revenue > 0 && (
            <Card className="border-emerald-200 bg-emerald-50/30 shadow-card rounded-xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2.5 rounded-full bg-emerald-100">
                  <Crown className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">נציג מוביל</p>
                  <p className="text-lg font-bold text-foreground">{topRep.name}</p>
                  <p className="text-sm text-muted-foreground">
                    הכנסות: ₪{topRep.revenue.toLocaleString()} · המרה: {topRep.conversionRate}%
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {worstSlaRep && worstSlaRep.slaRedCount > 0 && (
            <Card className="border-red-200 bg-red-50/30 shadow-card rounded-xl">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2.5 rounded-full bg-red-100">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">דורש תשומת לב</p>
                  <p className="text-lg font-bold text-foreground">{worstSlaRep.name}</p>
                  <p className="text-sm text-muted-foreground">
                    SLA אדומים: {worstSlaRep.slaRedCount} · פתוחים: {worstSlaRep.openLeads}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Performance Table */}
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
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">לידים</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">פתוחים</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגורים</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">המרה %</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הכנסות ₪</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">SLA תקין %</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">SLA אדומים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repStats.map(rep => {
                  const isTop = topRep && rep.email === topRep.email && topRep.revenue > 0;
                  const isWorst = worstSlaRep && rep.email === worstSlaRep.email && worstSlaRep.slaRedCount > 0;
                  let rowBg = '';
                  if (isTop) rowBg = 'bg-emerald-50/50';
                  else if (isWorst) rowBg = 'bg-red-50/50';

                  return (
                    <TableRow key={rep.email} className={`border-b border-border/30 last:border-b-0 hover:bg-muted/50 ${rowBg}`}>
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
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getConversionColor(rep.conversionRate)}`}>
                          {rep.conversionRate}%
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5 px-4">
                        <span className="font-medium text-sm">₪{formatNumber(rep.revenue)}</span>
                      </TableCell>
                      <TableCell className="py-2.5 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${getSlaColor(rep.slaCompliance)}`}>
                          {rep.slaCompliance}%
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
