import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { fetchAllList, fetchAllFiltered } from '@/lib/base44Pagination';
import KPICard from '@/components/shared/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BarChart3, Users, Target, TrendingUp, DollarSign, Handshake, Megaphone } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const normalizeSource = (source) => {
  if (!source) return 'other';
  const s = source.toLowerCase();
  if (s.includes('facebook') || s.includes('fb')) return 'facebook';
  if (s.includes('google') || s.includes('adwords')) return 'google';
  if (s.includes('tiktok')) return 'tiktok';
  if (s.includes('instagram') || s.includes('ig')) return 'instagram';
  if (s.includes('taboola')) return 'taboola';
  if (s.includes('outbrain')) return 'outbrain';
  return s;
};

export default function Marketing() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [dateRange, setDateRange] = useState('30');
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedLeadsForModal, setSelectedLeadsForModal] = useState(null);
  const [leadsModalTitle, setLeadsModalTitle] = useState('');
  const [filters, setFilters] = useState({
    utm_source: 'all',
    utm_medium: 'all',
    utm_campaign: 'all',
    utm_content: 'all',
  });
  const isAdmin = canAccessAdminOnly(effectiveUser);

  // Queries
  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => fetchAllList(base44.entities.Lead, '-created_date'),
    staleTime: 120000,
    enabled: isAdmin,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => fetchAllList(base44.entities.Order, '-created_date'),
    staleTime: 120000,
    enabled: isAdmin,
  });

  const { data: costs = [] } = useQuery({
    queryKey: ['marketingCosts'],
    queryFn: () => fetchAllList(base44.entities.MarketingCost, '-date'),
    staleTime: 120000,
    enabled: isAdmin,
  });

  const { data: meetings = [] } = useQuery({
    queryKey: ['salesTasks', 'meetings'],
    queryFn: () => fetchAllFiltered(base44.entities.SalesTask, { task_type: 'meeting' }, '-created_date'),
    staleTime: 120000,
    enabled: isAdmin,
  });

  // Filter Logic
  const now = new Date();
  let startDate = startOfDay(now);
  let endDate = new Date(2100, 1, 1);

  if (dateRange === 'today') {
    startDate = startOfDay(now);
  } else if (dateRange === 'yesterday') {
    startDate = startOfDay(subDays(now, 1));
    endDate = startOfDay(now);
  } else {
    startDate = startOfDay(subDays(now, parseInt(dateRange) || 30));
  }

  const isWithinRange = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= startDate && d < endDate;
  };

  const filteredCosts = costs.filter(c => isWithinRange(c.date));
  const filteredLeads = leads.filter(l => isWithinRange(l.created_date));
  const filteredOrders = orders.filter(o => isWithinRange(o.created_date));
  const filteredMeetings = meetings.filter(m => isWithinRange(m.due_date || m.created_date));

  // Apply detailed filters to leads
  let displayLeads = filteredLeads;
  if (filters.utm_source !== 'all') displayLeads = displayLeads.filter(l => l.utm_source === filters.utm_source);
  if (filters.utm_medium !== 'all') displayLeads = displayLeads.filter(l => l.utm_medium === filters.utm_medium);
  if (filters.utm_campaign !== 'all') displayLeads = displayLeads.filter(l => l.utm_campaign === filters.utm_campaign);
  if (filters.utm_content !== 'all') displayLeads = displayLeads.filter(l => l.utm_content === filters.utm_content);

  // Aggregations
  const totalCost = filteredCosts.reduce((sum, c) => sum + (c.amount || 0), 0);
  const totalLeadsCount = displayLeads.length;
  const wonLeads = displayLeads.filter(l => l.status === 'deal_closed');
  const wonLeadsCount = wonLeads.length;
  
  // Revenue from WON leads (cross-reference leads with orders if needed, or use orders directly if UTMs are passed)
  // Ideally orders should have source info. Assuming orders have matching lead_id or we track via leads.
  // We'll approximate revenue by summing orders that are linked to the filtered leads
  const wonLeadIds = new Set(wonLeads.map(l => l.id));
  const attributedRevenue = orders
    .filter(o => wonLeadIds.has(o.lead_id))
    .reduce((sum, o) => sum + (o.total || 0), 0);

  const cpl = totalLeadsCount > 0 ? Math.round(totalCost / totalLeadsCount) : 0;
  const cac = wonLeadsCount > 0 ? Math.round(totalCost / wonLeadsCount) : 0;
  const roi = totalCost > 0 ? ((attributedRevenue - totalCost) / totalCost * 100).toFixed(1) : 0;

  // Meetings KPIs
  const totalMeetings = filteredMeetings.length;
  const completedMeetings = filteredMeetings.filter(m => m.task_status === 'completed').length;
  // Check how many meetings resulted in a sale (lead status is deal_closed)
  const meetingLeadIds = new Set(filteredMeetings.map(m => m.lead_id));
  const meetingsWon = leads.filter(l => meetingLeadIds.has(l.id) && l.status === 'deal_closed').length;
  
  // Data for Charts
  // 1. Source Performance (Cost vs Revenue vs Leads)
  const processedSourceData = useMemo(() => {
    const sourcePerformanceMap = displayLeads.reduce((acc, lead) => {
      const source = normalizeSource(lead.utm_source || lead.source || 'other');
      if (!acc[source]) acc[source] = { name: source, leads: [], cost: 0, revenue: 0, won: 0 };
      acc[source].leads.push(lead);
      if (lead.status === 'deal_closed') {
        acc[source].won++;
        const order = orders.find(o => o.lead_id === lead.id);
        if (order) acc[source].revenue += order.total || 0;
      }
      return acc;
    }, {});

    filteredCosts.forEach(c => {
      const source = normalizeSource(c.source);
      if (!sourcePerformanceMap[source]) {
        sourcePerformanceMap[source] = { name: source, leads: [], cost: 0, revenue: 0, won: 0 };
      }
      sourcePerformanceMap[source].cost += c.amount || 0;
    });

    return Object.values(sourcePerformanceMap).map(item => ({
      ...item,
      leadsCount: item.leads.length,
      cpl: item.leads.length > 0 ? Math.round(item.cost / item.leads.length) : 0,
      roi: item.cost > 0 ? ((item.revenue - item.cost) / item.cost * 100).toFixed(0) : 0
    })).sort((a, b) => b.revenue - a.revenue);
  }, [displayLeads, filteredCosts, orders]);

  // 2. Ad Performance (Content)
  const adPerformance = useMemo(() => {
    return Object.values(displayLeads.reduce((acc, lead) => {
      const ad = lead.utm_content || 'Unknown Ad';
      if (!acc[ad]) acc[ad] = { name: ad, leads: [], won: 0, revenue: 0 };
      acc[ad].leads.push(lead);
      if (lead.status === 'deal_closed') {
        acc[ad].won++;
        const order = orders.find(o => o.lead_id === lead.id);
        if (order) acc[ad].revenue += order.total || 0;
      }
      return acc;
    }, {})).map(item => ({
      ...item,
      leadsCount: item.leads.length
    })).sort((a, b) => b.leadsCount - a.leadsCount).slice(0, 15);
  }, [displayLeads, orders]);

  // 3. Campaign Performance
  const processedCampaignData = useMemo(() => {
    const campaignPerformanceMap = displayLeads.reduce((acc, lead) => {
      const campaign = lead.utm_campaign || 'Unknown Campaign';
      if (!acc[campaign]) acc[campaign] = { name: campaign, leads: [], won: 0, revenue: 0, cost: 0 };
      acc[campaign].leads.push(lead);
      if (lead.status === 'deal_closed') {
        acc[campaign].won++;
        const order = orders.find(o => o.lead_id === lead.id);
        if (order) acc[campaign].revenue += order.total || 0;
      }
      return acc;
    }, {});

    filteredCosts.forEach(c => {
      const campaign = c.campaign_name || 'Unknown Campaign';
      if (!campaignPerformanceMap[campaign]) {
        campaignPerformanceMap[campaign] = { name: campaign, leads: [], cost: 0, revenue: 0, won: 0 };
      }
      campaignPerformanceMap[campaign].cost += c.amount || 0;
    });

    return Object.values(campaignPerformanceMap).map(item => ({
      ...item,
      leadsCount: item.leads.length,
      cpl: item.leads.length > 0 ? Math.round(item.cost / item.leads.length) : 0,
      roi: item.cost > 0 ? ((item.revenue - item.cost) / item.cost * 100).toFixed(0) : 0
    })).sort((a, b) => b.revenue - a.revenue);
  }, [displayLeads, filteredCosts, orders]);

  // 3. Meetings Data
  const meetingsData = [
    { name: 'תואמו', value: totalMeetings },
    { name: 'בוצעו', value: completedMeetings },
    { name: 'נסגרו', value: meetingsWon }
  ];

  // Filters Options
  const uniqueSources = [...new Set(filteredLeads.map(l => l.utm_source).filter(Boolean))];
  const uniqueCampaigns = [...new Set(filteredLeads.map(l => l.utm_campaign).filter(Boolean))];

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת לדשבורד שיווק</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">דשבורד שיווק</h1>
          <p className="text-muted-foreground">ניתוח עלויות, החזר השקעה (ROI) וביצועי קמפיינים</p>
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">היום</SelectItem>
            <SelectItem value="yesterday">אתמול</SelectItem>
            <SelectItem value="7">7 ימים אחרונים</SelectItem>
            <SelectItem value="14">14 ימים אחרונים</SelectItem>
            <SelectItem value="30">30 ימים אחרונים</SelectItem>
            <SelectItem value="90">90 ימים אחרונים</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main Financial KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="סה״כ הוצאות שיווק"
          value={`₪${totalCost.toLocaleString()}`}
          icon={DollarSign}
          color="red"
        />
        <KPICard
          title="עלות לליד (CPL)"
          value={`₪${cpl}`}
          subtitle={`${totalLeadsCount} לידים`}
          icon={Users}
          color="blue"
        />
        <KPICard
          title="עלות ללקוח (CAC)"
          value={`₪${cac}`}
          subtitle={`${wonLeadsCount} לקוחות`}
          icon={Target}
          color="emerald"
        />
        <KPICard
          title="הכנסות (מיוחסות)"
          value={`₪${attributedRevenue.toLocaleString()}`}
          icon={BarChart3}
          color="amber"
        />
        <KPICard
          title="החזר השקעה (ROI)"
          value={`${roi}%`}
          subtitle={roi > 0 ? "חיובי" : "שלילי"}
          icon={TrendingUp}
          color={roi > 0 ? "green" : "red"}
        />
      </div>

      {/* Meeting Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 bg-white">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Handshake className="h-5 w-5 text-purple-600" />
              ביצועי פגישות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={meetingsData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={50} />
                  <Tooltip cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={30}>
                    <Cell fill="#a78bfa" />
                    <Cell fill="#8b5cf6" />
                    <Cell fill="#10b981" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground mt-4 px-2">
              <div className="text-center">
                <span className="block font-bold text-foreground text-lg">{totalMeetings}</span>
                תואמו
              </div>
              <div className="text-center">
                <span className="block font-bold text-foreground text-lg">{completedMeetings}</span>
                בוצעו
              </div>
              <div className="text-center">
                <span className="block font-bold text-green-600 text-lg">{meetingsWon}</span>
                נסגרו
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Source Performance Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>ניתוח מקורות: עלות מול הכנסות</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={processedSourceData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="left" orientation="left" stroke="#ef4444" label={{ value: 'עלות (₪)', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" stroke="#10b981" label={{ value: 'הכנסות (₪)', angle: 90, position: 'insideRight' }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="cost" name="עלות" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="revenue" name="הכנסות" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border w-full h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
          <TabsTrigger value="campaigns">קמפיינים (Campaigns)</TabsTrigger>
          <TabsTrigger value="ads">מודעות (Ads)</TabsTrigger>
          <TabsTrigger value="roi_table">טבלת ROI מפורטת</TabsTrigger>
          <TabsTrigger value="leads_data">דוח לידים</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Detailed Source Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>פירוט לפי מקור (CPL & ROI)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>מקור</TableHead>
                      <TableHead>לידים</TableHead>
                      <TableHead>עלות</TableHead>
                      <TableHead>עלות לליד (CPL)</TableHead>
                      <TableHead>לקוחות (סגירות)</TableHead>
                      <TableHead>עלות ללקוח (CAC)</TableHead>
                      <TableHead>הכנסות</TableHead>
                      <TableHead>ROI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedSourceData.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>
                          <Button 
                            variant="link" 
                            className="p-0 h-auto font-bold text-primary"
                            onClick={() => {
                              setLeadsModalTitle(`לידים - מקור: ${row.name}`);
                              setSelectedLeadsForModal(row.leads);
                            }}
                          >
                            {row.leadsCount}
                          </Button>
                        </TableCell>
                        <TableCell>₪{row.cost.toLocaleString()}</TableCell>
                        <TableCell>₪{row.cpl}</TableCell>
                        <TableCell>{row.won}</TableCell>
                        <TableCell>₪{row.won > 0 ? Math.round(row.cost / row.won).toLocaleString() : '-'}</TableCell>
                        <TableCell className="text-green-600 font-medium">₪{row.revenue.toLocaleString()}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${row.roi >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {row.roi}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'campaigns' && (
        <Card>
          <CardHeader>
            <CardTitle>ביצועי קמפיינים (UTM Campaign)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם הקמפיין</TableHead>
                    <TableHead>לידים</TableHead>
                    <TableHead>עלות</TableHead>
                    <TableHead>עלות לליד (CPL)</TableHead>
                    <TableHead>סגירות</TableHead>
                    <TableHead>הכנסות מיוחסות</TableHead>
                    <TableHead>ROI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedCampaignData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">אין נתונים להצגה</TableCell>
                    </TableRow>
                  ) : (
                    processedCampaignData.map((cmp, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Megaphone className="h-4 w-4 text-purple-500" />
                            {cmp.name === 'Unknown Campaign' ? 'לא ידוע (ללא UTM)' : cmp.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button 
                            variant="link" 
                            className="p-0 h-auto font-bold text-primary"
                            onClick={() => {
                              setLeadsModalTitle(`לידים - קמפיין: ${cmp.name === 'Unknown Campaign' ? 'ללא UTM' : cmp.name}`);
                              setSelectedLeadsForModal(cmp.leads);
                            }}
                          >
                            {cmp.leadsCount}
                          </Button>
                        </TableCell>
                        <TableCell>₪{cmp.cost.toLocaleString()}</TableCell>
                        <TableCell>₪{cmp.cpl}</TableCell>
                        <TableCell>{cmp.won}</TableCell>
                        <TableCell className="text-green-600 font-medium">₪{cmp.revenue.toLocaleString()}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${cmp.roi >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {cmp.roi}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'ads' && (
        <Card>
          <CardHeader>
            <CardTitle>ביצועי מודעות (UTM Content)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם המודעה</TableHead>
                    <TableHead>לידים</TableHead>
                    <TableHead>סגירות</TableHead>
                    <TableHead>אחוז המרה</TableHead>
                    <TableHead>הכנסות מיוחסות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adPerformance.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">אין נתונים להצגה</TableCell>
                    </TableRow>
                  ) : (
                    adPerformance.map((ad, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Megaphone className="h-4 w-4 text-primary" />
                            {ad.name === 'Unknown Ad' ? 'לא ידוע (ללא UTM)' : ad.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button 
                            variant="link" 
                            className="p-0 h-auto font-bold text-primary"
                            onClick={() => {
                              setLeadsModalTitle(`לידים - מודעה: ${ad.name === 'Unknown Ad' ? 'ללא UTM' : ad.name}`);
                              setSelectedLeadsForModal(ad.leads);
                            }}
                          >
                            {ad.leadsCount}
                          </Button>
                        </TableCell>
                        <TableCell>{ad.won}</TableCell>
                        <TableCell>{ad.leadsCount > 0 ? ((ad.won / ad.leadsCount) * 100).toFixed(1) : 0}%</TableCell>
                        <TableCell className="text-green-600 font-medium">₪{ad.revenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'roi_table' && (
        <Card>
          <CardHeader>
            <CardTitle>ניתוח ROI מלא</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="text-sm text-muted-foreground mb-4">
               * הנתונים מבוססים על הצלבת עלויות שיווק (MarketingCost) מול לידים (UTM Source) והזמנות שנסגרו.
             </div>
             <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ערוץ</TableHead>
                      <TableHead>הוצאה</TableHead>
                      <TableHead>הכנסה</TableHead>
                      <TableHead>רווח/הפסד</TableHead>
                      <TableHead>ROAS (החזר על הוצאה)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedSourceData.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-red-600">₪{row.cost.toLocaleString()}</TableCell>
                        <TableCell className="text-green-600">₪{row.revenue.toLocaleString()}</TableCell>
                        <TableCell className={`font-bold ${row.revenue - row.cost >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          ₪{(row.revenue - row.cost).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          x{row.cost > 0 ? (row.revenue / row.cost).toFixed(2) : '0'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
             </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'leads_data' && (
        <Card>
          <CardHeader>
            <CardTitle>נתוני שיווק מפורטים ללידים</CardTitle>
            <div className="flex gap-2 mt-2">
               <Select value={filters.utm_source} onValueChange={(v) => setFilters(f => ({ ...f, utm_source: v }))}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Source: הכל</SelectItem>{uniqueSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.utm_campaign} onValueChange={(v) => setFilters(f => ({ ...f, utm_campaign: v }))}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Campaign" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Campaign: הכל</SelectItem>{uniqueCampaigns.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם לקוח</TableHead>
                    <TableHead>תאריך</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Content (Ad)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayLeads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        לא נמצאו נתונים התואמים לחיפוש
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">{lead.full_name}</TableCell>
                        <TableCell>{format(new Date(lead.created_date), 'dd/MM/yyyy HH:mm')}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${lead.status === 'deal_closed' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-foreground'}`}>
                            {lead.status === 'deal_closed' ? 'סגור (המר)' : lead.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{lead.utm_source || '-'}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{lead.utm_campaign || '-'}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{lead.utm_content || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedLeadsForModal} onOpenChange={(open) => !open && setSelectedLeadsForModal(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{leadsModalTitle}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם לקוח</TableHead>
                  <TableHead>טלפון</TableHead>
                  <TableHead>תאריך</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Campaign</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedLeadsForModal?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-4">אין לידים</TableCell>
                  </TableRow>
                ) : (
                  selectedLeadsForModal?.map(lead => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.full_name}</TableCell>
                      <TableCell dir="ltr" className="text-right">{lead.phone}</TableCell>
                      <TableCell>{format(new Date(lead.created_date), 'dd/MM/yyyy HH:mm')}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${lead.status === 'deal_closed' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-foreground'}`}>
                          {lead.status === 'deal_closed' ? 'סגור (המר)' : lead.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{lead.utm_source || lead.source || '-'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{lead.utm_campaign || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
