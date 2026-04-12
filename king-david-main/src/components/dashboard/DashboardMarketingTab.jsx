import React from 'react';
import KPICard from '@/components/shared/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Users, Target, TrendingUp, Megaphone, FileText, Tag, BarChart3, ArrowLeftRight } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const STATUS_LABELS = {
  new_lead: 'ליד חדש',
  hot_lead: 'ליד רותח',
  followup_before_quote: 'פולאפ - לפני הצעה',
  followup_after_quote: 'פולאפ - אחרי הצעה',
  coming_to_branch: 'יגיע לסניף',
  no_answer_1: 'ללא מענה 1',
  no_answer_2: 'ללא מענה 2',
  no_answer_3: 'ללא מענה 3',
  no_answer_4: 'ללא מענה 4',
  no_answer_5: 'ללא מענה 5',
  no_answer_whatsapp_sent: 'ללא מענה - וואטסאפ',
  no_answer_calls: 'אין מענה - חיוגים',
  changed_direction: 'שנה כיוון',
  deal_closed: 'נסגרה עסקה',
  not_relevant_duplicate: 'כפול',
  not_relevant_bought_elsewhere: 'רכש במקום אחר',
  not_interested_hangs_up: 'לא מעוניין',
  heard_price_not_interested: 'שמע מחיר - לא מעוניין',
  closed_by_manager_to_mailing: 'הועבר לדיוור',
};

const ConversionBadge = ({ rate }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
    rate >= 20 ? 'bg-emerald-100 text-emerald-700' :
    rate >= 10 ? 'bg-blue-100 text-blue-700' :
    rate >= 5 ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-500'
  }`}>
    {rate}%
  </span>
);

const ProgressBar = ({ value, max, color = 'bg-primary' }) => {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-left">{pct}%</span>
    </div>
  );
};

export default function DashboardMarketingTab({ stats }) {
  const mkt = stats?.marketing || {};
  const totalLeads = mkt.leads_count || 0;
  const wonLeads = mkt.won_leads_count || 0;

  // Chart data - leads by source (bar: leads vs won)
  const sourceBarData = (mkt.by_source || []).filter(s => s.leads > 0 && s.source !== 'other').map(s => ({
    name: s.source,
    leads: s.leads,
    won: s.won,
    conversionRate: s.conversionRate,
  }));

  // Pie chart - leads distribution by source
  const leadsBySourcePie = (mkt.by_source || []).filter(s => s.leads > 0 && s.source !== 'other').map(s => ({
    name: s.source,
    value: s.leads,
  }));

  // Status funnel data
  const statusData = Object.entries(mkt.status_breakdown || {})
    .map(([status, count]) => ({ status, label: STATUS_LABELS[status] || status, count }))
    .sort((a, b) => b.count - a.count);

  // Group statuses into funnel stages
  const activeStatuses = ['new_lead', 'hot_lead', 'followup_before_quote', 'followup_after_quote', 'coming_to_branch'];
  const noAnswerStatuses = ['no_answer_1', 'no_answer_2', 'no_answer_3', 'no_answer_4', 'no_answer_5', 'no_answer_whatsapp_sent', 'no_answer_calls'];
  const sb = mkt.status_breakdown || {};
  const activeCount = activeStatuses.reduce((sum, s) => sum + (sb[s] || 0), 0);
  const noAnswerCount = noAnswerStatuses.reduce((sum, s) => sum + (sb[s] || 0), 0);
  const closedWon = sb['deal_closed'] || 0;
  const closedLost = totalLeads - activeCount - noAnswerCount - closedWon;

  return (
    <div className="space-y-6">
      {/* Marketing KPIs — focused on leads & conversions */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-4">
        <KPICard
          title="סה״כ לידים"
          value={totalLeads.toLocaleString()}
          icon={Users}
          color="blue"
        />
        <KPICard
          title="סגירות (עסקאות)"
          value={wonLeads.toLocaleString()}
          subtitle={`מתוך ${totalLeads} לידים`}
          icon={Target}
          color="emerald"
        />
        <KPICard
          title="אחוז המרה כללי"
          value={`${mkt.overall_conversion_rate || 0}%`}
          subtitle={`${wonLeads} מתוך ${totalLeads}`}
          icon={TrendingUp}
          color={mkt.overall_conversion_rate >= 10 ? 'emerald' : mkt.overall_conversion_rate >= 5 ? 'amber' : 'red'}
        />
        <KPICard
          title="קיבלו הצעת מחיר"
          value={`${mkt.quote_sent_count || 0}`}
          subtitle={`${mkt.quote_rate || 0}% מהלידים`}
          icon={FileText}
          color="purple"
        />
        <KPICard
          title="הכנסות מלידים"
          value={`₪${(mkt.attributed_revenue || 0).toLocaleString()}`}
          icon={BarChart3}
          color="amber"
        />
      </div>

      {/* Funnel Overview */}
      <Card className="border-border shadow-card rounded-xl">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-blue-100">
              <ArrowLeftRight className="h-4 w-4 text-blue-600" />
            </div>
            משפך לידים - סטטוס נוכחי
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-2xl font-bold text-blue-700">{activeCount}</div>
              <div className="text-xs text-blue-600 font-medium">בטיפול פעיל</div>
              <ProgressBar value={activeCount} max={totalLeads} color="bg-blue-500" />
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-2xl font-bold text-amber-700">{noAnswerCount}</div>
              <div className="text-xs text-amber-600 font-medium">ללא מענה</div>
              <ProgressBar value={noAnswerCount} max={totalLeads} color="bg-amber-500" />
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-2xl font-bold text-emerald-700">{closedWon}</div>
              <div className="text-xs text-emerald-600 font-medium">נסגרה עסקה</div>
              <ProgressBar value={closedWon} max={totalLeads} color="bg-emerald-500" />
            </div>
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <div className="text-2xl font-bold text-red-700">{closedLost > 0 ? closedLost : 0}</div>
              <div className="text-xs text-red-600 font-medium">לא רלוונטי / סגור</div>
              <ProgressBar value={closedLost > 0 ? closedLost : 0} max={totalLeads} color="bg-red-500" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Leads by Source Pie */}
        <Card className="border-border shadow-card rounded-xl">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold">חלוקת לידים לפי מקור</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[300px]">
              {leadsBySourcePie.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={leadsBySourcePie}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {leadsBySourcePie.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">אין נתוני UTM</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Leads vs Won by Source Bar */}
        <Card className="border-border shadow-card rounded-xl">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold">לידים מול סגירות לפי מקור</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[300px]">
              {sourceBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceBarData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip
                      formatter={(value, name) => [value, name === 'leads' ? 'לידים' : 'סגירות']}
                      labelFormatter={(label) => `מקור: ${label}`}
                    />
                    <Legend formatter={(value) => value === 'leads' ? 'לידים' : 'סגירות'} />
                    <Bar dataKey="leads" name="leads" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="won" name="won" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">אין נתונים</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source Breakdown Table */}
      {(mkt.by_source || []).filter(s => s.source !== 'other').length > 0 && (
        <Card className="border-border shadow-card rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-blue-100">
                <Users className="h-4 w-4 text-blue-600" />
              </div>
              ביצועים לפי מקור (Source)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50">
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">מקור</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">לידים</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">בטיפול</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הצעות נשלחו</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% הצעה</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגירות</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% המרה</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הכנסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mkt.by_source.filter(s => s.source !== 'other').map(s => (
                    <TableRow key={s.source} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                      <TableCell className="py-2.5 px-4 font-semibold text-sm">{s.source}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-bold text-primary">{s.leads}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm text-blue-600">{s.inProgress}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm">{s.quoteSent}</TableCell>
                      <TableCell className="py-2.5 px-4"><ConversionBadge rate={s.quoteRate} /></TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-bold text-emerald-600">{s.won}</TableCell>
                      <TableCell className="py-2.5 px-4"><ConversionBadge rate={s.conversionRate} /></TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-medium">₪{s.revenue.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campaign Breakdown Table */}
      {(mkt.by_campaign || []).length > 0 && (
        <Card className="border-border shadow-card rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-purple-100">
                <Megaphone className="h-4 w-4 text-purple-600" />
              </div>
              ביצועי קמפיינים (Campaign)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50">
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">קמפיין</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">מקור</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">לידים</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">בטיפול</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הצעות</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% הצעה</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגירות</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% המרה</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הכנסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mkt.by_campaign.map((c, i) => (
                    <TableRow key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                      <TableCell className="py-2.5 px-4 font-semibold text-sm max-w-[200px]">
                        <div className="flex items-center gap-2">
                          <Megaphone className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                          <span className="truncate" title={c.campaign}>{c.campaign}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-sm text-muted-foreground">{c.source}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-bold text-primary">{c.leads}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm text-blue-600">{c.inProgress}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm">{c.quoteSent}</TableCell>
                      <TableCell className="py-2.5 px-4"><ConversionBadge rate={c.quoteRate} /></TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-bold text-emerald-600">{c.won}</TableCell>
                      <TableCell className="py-2.5 px-4"><ConversionBadge rate={c.conversionRate} /></TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-medium">₪{c.revenue.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content (Ad Sets) Breakdown Table */}
      {(mkt.by_content || []).length > 0 && (
        <Card className="border-border shadow-card rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-amber-100">
                <FileText className="h-4 w-4 text-amber-600" />
              </div>
              פירוט לפי תוכן (Content - מודעות / קהלים)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50">
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">תוכן</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">מקור</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">קמפיין</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">לידים</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגירות</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% המרה</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">הכנסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mkt.by_content.map((c, i) => (
                    <TableRow key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                      <TableCell className="py-2.5 px-4 font-medium text-sm max-w-[200px] truncate" title={c.content}>
                        {c.content}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-sm text-muted-foreground">{c.source}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm text-muted-foreground max-w-[150px] truncate" title={c.campaign}>
                        {c.campaign || '-'}
                      </TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-bold text-primary">{c.leads}</TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-bold text-emerald-600">{c.won}</TableCell>
                      <TableCell className="py-2.5 px-4"><ConversionBadge rate={c.conversionRate} /></TableCell>
                      <TableCell className="py-2.5 px-4 text-sm font-medium">₪{c.revenue.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Medium + Term side by side */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Medium Breakdown */}
        {(mkt.by_medium || []).length > 0 && (
          <Card className="border-border shadow-card rounded-xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-indigo-100">
                  <BarChart3 className="h-4 w-4 text-indigo-600" />
                </div>
                לפי מדיום (Medium)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/50">
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">Medium</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">לידים</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגירות</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% המרה</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mkt.by_medium.map((m, i) => (
                      <TableRow key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                        <TableCell className="py-2.5 px-4 font-medium text-sm">{m.medium}</TableCell>
                        <TableCell className="py-2.5 px-4 text-sm font-bold text-primary">{m.leads}</TableCell>
                        <TableCell className="py-2.5 px-4 text-sm font-bold text-emerald-600">{m.won}</TableCell>
                        <TableCell className="py-2.5 px-4"><ConversionBadge rate={m.conversionRate} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Term Breakdown */}
        {(mkt.by_term || []).length > 0 && (
          <Card className="border-border shadow-card rounded-xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-cyan-100">
                  <Tag className="h-4 w-4 text-cyan-600" />
                </div>
                לפי Term (תחומי עניין / מילות חיפוש)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/50">
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">Term</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">לידים</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סגירות</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">% המרה</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mkt.by_term.map((t, i) => (
                      <TableRow key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                        <TableCell className="py-2.5 px-4 font-medium text-sm">{t.term}</TableCell>
                        <TableCell className="py-2.5 px-4 text-sm font-bold text-primary">{t.leads}</TableCell>
                        <TableCell className="py-2.5 px-4 text-sm font-bold text-emerald-600">{t.won}</TableCell>
                        <TableCell className="py-2.5 px-4"><ConversionBadge rate={t.conversionRate} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Status Detail Breakdown */}
      {statusData.length > 0 && (
        <Card className="border-border shadow-card rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-gray-100">
                <Target className="h-4 w-4 text-gray-600" />
              </div>
              פירוט סטטוסים - כל הלידים
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50">
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">סטטוס</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4">כמות</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-4 w-1/3">חלק מהסה״כ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statusData.map((s, i) => (
                    <TableRow key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/50">
                      <TableCell className="py-2 px-4 font-medium text-sm">{s.label}</TableCell>
                      <TableCell className="py-2 px-4 text-sm font-bold">{s.count}</TableCell>
                      <TableCell className="py-2 px-4">
                        <ProgressBar
                          value={s.count}
                          max={totalLeads}
                          color={s.status === 'deal_closed' ? 'bg-emerald-500' : s.status === 'new_lead' ? 'bg-blue-500' : 'bg-gray-400'}
                        />
                      </TableCell>
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
