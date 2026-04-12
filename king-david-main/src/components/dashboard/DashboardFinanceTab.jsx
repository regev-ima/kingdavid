import React, { useState } from 'react';
import KPICard from '@/components/shared/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, CreditCard, TrendingUp, FileText, Wallet, Receipt, Megaphone } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const CHANNEL_LABELS = {
  store: 'חנות',
  callcenter: 'מוקד',
  digital: 'דיגיטל',
  whatsapp: 'WhatsApp',
  other: 'אחר',
};

export default function DashboardFinanceTab({ stats }) {
  const fin = stats?.financial || {};
  const [revenueView, setRevenueView] = useState('channel'); // channel | source | campaign

  // Revenue KPI data
  const channelPieData = (fin.revenue_by_channel || []).map(s => ({
    name: CHANNEL_LABELS[s.source] || s.source,
    value: s.revenue,
  })).filter(d => d.value > 0);

  const sourcePieData = (fin.revenue_by_mkt_source || []).map(s => ({
    name: s.source,
    value: s.revenue,
  })).filter(d => d.value > 0);

  const campaignBarData = (fin.revenue_by_campaign || []).filter(c => c.revenue > 0).map(c => ({
    name: c.campaign.length > 25 ? c.campaign.slice(0, 25) + '...' : c.campaign,
    fullName: c.campaign,
    revenue: c.revenue,
    count: c.count,
  }));

  const currentPieData = revenueView === 'channel' ? channelPieData : sourcePieData;
  const showBarChart = revenueView === 'campaign';

  return (
    <div className="space-y-6">
      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-4">
        <KPICard
          title="סה״כ הכנסות"
          value={`₪${(fin.total_revenue || 0).toLocaleString()}`}
          icon={DollarSign}
          color="emerald"
        />
        <KPICard
          title="שולם"
          value={`₪${(fin.paid_revenue || 0).toLocaleString()}`}
          icon={CreditCard}
          color="blue"
        />
        <KPICard
          title="מקדמות"
          value={`₪${(fin.deposit_revenue || 0).toLocaleString()}`}
          icon={Wallet}
          color="amber"
        />
        <KPICard
          title="לא שולם"
          value={`₪${(fin.unpaid_revenue || 0).toLocaleString()}`}
          icon={Wallet}
          color="red"
        />
        <KPICard
          title="עסקה ממוצעת"
          value={`₪${(fin.avg_order_value || 0).toLocaleString()}`}
          icon={TrendingUp}
          color="indigo"
        />
        <KPICard
          title="עמלות ממתינות"
          value={`₪${(fin.commissions_pending || 0).toLocaleString()}`}
          icon={Receipt}
          color="purple"
        />
      </div>

      {/* Quotes Pipeline + Revenue Chart */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Quotes Pipeline (global, not date-filtered) */}
        <Card className="border-border shadow-card rounded-xl">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-blue-100">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              הצעות מחיר - תמונת מצב נוכחית
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg">
              <div>
                <span className="font-medium text-amber-700">ממתינות לאישור</span>
                <p className="text-xs text-amber-600">טיוטות + נשלחו (לא פג תוקף)</p>
              </div>
              <div className="text-left">
                <span className="text-xl font-bold text-amber-700">{fin.quotes_pending || 0}</span>
                <span className="text-sm text-amber-600 ms-2">₪{(fin.quotes_pending_value || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-lg">
              <span className="font-medium text-emerald-700">אושרו</span>
              <div className="text-left">
                <span className="text-xl font-bold text-emerald-700">{fin.quotes_approved || 0}</span>
                <span className="text-sm text-emerald-600 ms-2">₪{(fin.quotes_approved_value || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
              <span className="font-medium text-red-700">פגו תוקף</span>
              <div className="text-left">
                <span className="text-xl font-bold text-red-700">{fin.quotes_expired || 0}</span>
                <span className="text-sm text-red-600 ms-2">₪{(fin.quotes_expired_value || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
              <span className="font-medium text-muted-foreground">נדחו</span>
              <div className="text-left">
                <span className="text-xl font-bold text-muted-foreground">{fin.quotes_rejected || 0}</span>
                <span className="text-sm text-muted-foreground ms-2">₪{(fin.quotes_rejected_value || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="border-t pt-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-foreground">הזמנות שנסגרו (בתקופה)</span>
                <div className="text-left">
                  <span className="text-xl font-bold text-foreground">{fin.orders_count || 0}</span>
                  <span className="text-sm text-muted-foreground ms-2">₪{(fin.total_revenue || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Revenue by Source/Channel/Campaign Chart */}
        <Card className="border-border shadow-card rounded-xl">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">הכנסות לפי</CardTitle>
              <Select value={revenueView} onValueChange={setRevenueView}>
                <SelectTrigger className="w-[140px] h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="channel">ערוץ מכירה</SelectItem>
                  <SelectItem value="source">מקור שיווקי</SelectItem>
                  <SelectItem value="campaign">קמפיין</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[320px]">
              {showBarChart ? (
                campaignBarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={campaignBarData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => `₪${v.toLocaleString()}`} />
                      <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value) => `₪${value.toLocaleString()}`} />
                      <Bar dataKey="revenue" name="הכנסות" fill="#4f46e5" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">אין נתונים</div>
                )
              ) : (
                currentPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={currentPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ₪${value.toLocaleString()}`}
                      >
                        {currentPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `₪${value.toLocaleString()}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">אין נתונים</div>
                )
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment Status Summary */}
      <Card className="border-border shadow-card rounded-xl">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
          <CardTitle className="text-sm font-semibold">סיכום תשלומים (בתקופה)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid sm:grid-cols-4 gap-4">
            <div className="p-4 bg-emerald-50 rounded-lg text-center">
              <p className="text-sm font-medium text-emerald-700 mb-1">שולם במלואו</p>
              <p className="text-2xl font-bold text-emerald-700">₪{(fin.paid_revenue || 0).toLocaleString()}</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-lg text-center">
              <p className="text-sm font-medium text-amber-700 mb-1">מקדמות</p>
              <p className="text-2xl font-bold text-amber-700">₪{(fin.deposit_revenue || 0).toLocaleString()}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg text-center">
              <p className="text-sm font-medium text-red-700 mb-1">ממתין לתשלום</p>
              <p className="text-2xl font-bold text-red-700">₪{(fin.unpaid_revenue || 0).toLocaleString()}</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg text-center">
              <p className="text-sm font-medium text-purple-700 mb-1">עמלות ממתינות</p>
              <p className="text-2xl font-bold text-purple-700">₪{(fin.commissions_pending || 0).toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revenue by Campaign Table */}
      {(fin.revenue_by_campaign || []).filter(c => c.revenue > 0).length > 0 && (
        <Card className="border-border shadow-card rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-purple-100">
                <Megaphone className="h-4 w-4 text-purple-600" />
              </div>
              הכנסות לפי קמפיין
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50">
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">קמפיין</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הזמנות</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הכנסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fin.revenue_by_campaign.filter(c => c.revenue > 0).map((c, i) => (
                    <TableRow key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                      <TableCell className="py-2.5 px-4 font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <Megaphone className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                          {c.campaign}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-sm">{c.count}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-semibold text-emerald-600">₪{c.revenue.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
