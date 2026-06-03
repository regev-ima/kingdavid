import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ChevronLeft, Users } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import MiniKPI from '../MiniKPI';
import LeadsByStatusTable from '../LeadsByStatusTable';

const SOURCE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

export default function LeadsTab({ current = {}, dateRange, demoMode = false }) {
  const trend = current.leadsTrend || [];
  const sources = current.sourceBreakdown || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="לידים חדשים" value={current.newLeadsCount} color="blue" />
        <MiniKPI label="פתוחים סה״כ" value={current.openLeadsTotal} color="indigo" />
        <MiniKPI label="ללא מענה" value={current.noAnswerLeads} color="amber" />
        <MiniKPI label="המרה" value={`${Number(current.conversion || 0).toFixed(0)}%`} color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border shadow-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-600" />
                מגמת לידים יומית
              </CardTitle>
              <Link to={createPageUrl('Leads')}>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  לרשימת הלידים
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {trend.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                אין נתונים בטווח
              </div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => String(v).slice(5).replace('-', '.')} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(v) => String(v)}
                      formatter={(value) => [formatNumber(value), 'לידים']}
                    />
                    <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm">לידים לפי מקור</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {sources.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                אין נתונים בטווח
              </div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sources}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={(entry) => entry.name}
                    >
                      {sources.map((_entry, idx) => (
                        <Cell key={idx} fill={SOURCE_COLORS[idx % SOURCE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <LeadsByStatusTable demoMode={demoMode} />
    </div>
  );
}
