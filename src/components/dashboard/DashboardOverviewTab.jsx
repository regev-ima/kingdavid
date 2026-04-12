import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import KPICard from '@/components/shared/KPICard';
import ExpiringQuotesFromCounters from '@/components/dashboard/ExpiringQuotesFromCounters.jsx';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users, FileText, AlertTriangle, Clock, Target,
  TrendingUp, DollarSign, UserPlus, ArrowRight, Phone,
  CheckSquare, AlertCircle, ShoppingCart,
} from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { he } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function DashboardOverviewTab({ stats, newUnassignedLeads }) {
  const leadsCount = stats?.leads_count || 0;
  const wonLeads = stats?.marketing?.won_leads_count || 0;
  const conversionRate = leadsCount > 0 ? Math.round((wonLeads / leadsCount) * 100) : 0;
  const tasks = stats?.tasks || {};

  return (
    <div className="space-y-8">

      {/* ===== SECTION: לידים ===== */}
      <div>
        <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
          <Users className="h-4.5 w-4.5 text-blue-600" />
          לידים
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <KPICard
            title="לידים בתקופה"
            value={leadsCount}
            icon={Users}
            color="blue"
          />
          <KPICard
            title="לא משויכים"
            value={stats?.unassigned_leads || 0}
            icon={AlertTriangle}
            color="amber"
          />
          <KPICard
            title="SLA אדומים"
            value={stats?.sla_red || 0}
            subtitle="ללא מענה מעל 15 דק׳"
            icon={Clock}
            color="red"
          />
          <KPICard
            title="זמן תגובה ממוצע"
            value={stats?.avg_response_time > 0 ? `${stats.avg_response_time} דק׳` : '-'}
            subtitle="First Response"
            icon={Target}
            color="cyan"
          />
        </div>
      </div>

      {/* ===== SECTION: משימות ===== */}
      <div>
        <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
          <CheckSquare className="h-4.5 w-4.5 text-purple-600" />
          משימות
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4">
          <KPICard
            title="משימות להיום"
            value={tasks.today || 0}
            icon={CheckSquare}
            color="blue"
          />
          <KPICard
            title="באיחור"
            value={tasks.overdue || 0}
            subtitle="עברו את מועד הביצוע"
            icon={AlertCircle}
            color="red"
          />
          <KPICard
            title="סה״כ ממתינות"
            value={tasks.pending_total || 0}
            subtitle="כל המשימות הפתוחות"
            icon={CheckSquare}
            color="purple"
          />
        </div>
      </div>

      {/* ===== SECTION: מכירות ===== */}
      <div>
        <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
          <ShoppingCart className="h-4.5 w-4.5 text-emerald-600" />
          מכירות בתקופה
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <KPICard
            title="הכנסות"
            value={`₪${(stats?.financial?.total_revenue || 0).toLocaleString()}`}
            icon={DollarSign}
            color="emerald"
          />
          <KPICard
            title="הזמנות"
            value={stats?.financial?.orders_count || 0}
            icon={ShoppingCart}
            color="blue"
          />
          <KPICard
            title="שיעור המרה"
            value={`${conversionRate}%`}
            subtitle={`${wonLeads} עסקאות שנסגרו`}
            icon={TrendingUp}
            color="purple"
          />
          <KPICard
            title="עסקה ממוצעת"
            value={`₪${(stats?.financial?.avg_order_value || 0).toLocaleString()}`}
            icon={DollarSign}
            color="indigo"
          />
        </div>
      </div>

      {/* ===== SECTION: מגמת לידים ===== */}
      {stats?.leads_trend && stats.leads_trend.length > 1 && (
        <div>
          <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="h-4.5 w-4.5 text-blue-600" />
            מגמת לידים
          </h2>
          <Card className="border-border shadow-card rounded-xl">
            <CardContent className="pt-4">
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.leads_trend} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => [value, 'לידים']} />
                    <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== SECTION: התראות ===== */}
      {((stats?.expiring_quotes || []).length > 0 || newUnassignedLeads.length > 0) && (
        <div>
          <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-600" />
            דורש טיפול
          </h2>
          <div className="grid lg:grid-cols-2 gap-6">
            <ExpiringQuotesFromCounters quotes={stats?.expiring_quotes || []} />

            {newUnassignedLeads.length > 0 && (
              <div className="bg-card rounded-xl border border-amber-200 shadow-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-l from-amber-50 to-orange-50 border-b border-amber-100">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
                      <UserPlus className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">לידים חדשים לשיוך</p>
                      <p className="text-xs text-muted-foreground">לידים שטרם שויכו לנציג</p>
                    </div>
                    <span className="ms-2 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-amber-500 text-white text-xs font-bold">
                      {newUnassignedLeads.length}
                    </span>
                  </div>
                  <Link to={createPageUrl('Leads') + '?filter=unassigned'}>
                    <Button variant="outline" size="sm" className="text-xs">
                      לכל הלידים <ArrowRight className="h-3 w-3 ms-1" />
                    </Button>
                  </Link>
                </div>
                <div className="divide-y divide-border/50">
                  {newUnassignedLeads.slice(0, 8).map(lead => (
                    <div key={lead.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50/40 transition-colors">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">
                          {lead.full_name?.charAt(0) || '?'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link to={createPageUrl('LeadDetails') + `?id=${lead.id}`}>
                          <p className="font-medium text-sm text-foreground hover:text-primary truncate">{lead.full_name}</p>
                        </Link>
                        <p className="text-xs text-muted-foreground/70 truncate">{lead.phone} {lead.source ? `· ${lead.source}` : ''}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground/70 hidden sm:block">
                        {formatDistanceToNow(new Date(lead.created_date), { addSuffix: true, locale: he })}
                      </span>
                      <a href={`tel:${lead.phone}`} className="w-7 h-7 flex items-center justify-center rounded hover:bg-emerald-100 text-emerald-600 shrink-0">
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
