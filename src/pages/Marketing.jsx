import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Megaphone, Users, Target, TrendingUp, DollarSign, RefreshCw, AlertTriangle,
  Handshake, Timer, Wallet,
} from 'lucide-react';
import Dashboard2DateRange, { DEFAULT_PRESETS } from '@/components/dashboard2/Dashboard2DateRange';
import KPICard from '@/components/shared/KPICard';
import LeadListTable from '@/components/lead/LeadListTable';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';
import { formatCurrency } from '@/utils/currency';
import { resolveSourceChannel } from '@/constants/sourceChannels';
import { useMarketingPanelData } from '@/components/marketing/useMarketingPanelData';
import { channelLabel } from '@/components/marketing/channelVisuals';
import { formatMins } from '@/components/marketing/PanelBits';
import ChannelChips from '@/components/marketing/ChannelChips';
import InsightsPanel from '@/components/marketing/InsightsPanel';
import TrendCharts from '@/components/marketing/TrendCharts';
import MarketingFunnelCard from '@/components/marketing/MarketingFunnelCard';
import MarketingHeatmap from '@/components/marketing/MarketingHeatmap';
import ChannelsTable from '@/components/marketing/ChannelsTable';
import CampaignsTable from '@/components/marketing/CampaignsTable';
import LandingPagesTable from '@/components/marketing/LandingPagesTable';

// The lead report needs the same channel the aggregates used server-side —
// including the "facebook only via facebook_* metadata" fallback, which the old
// client-side filter missed. Mirrors the CASE in marketing_stats_v1 exactly:
// same three name columns, so the report and the cubes bucket identically.
const leadChannel = (l) => resolveSourceChannel(
  l?.utm_source || l?.source
  || (l?.facebook_campaign_name || l?.facebook_ad_name || l?.facebook_adset_name ? 'facebook' : ''),
);

const fracDelta = (curr, prev) => (
  curr != null && prev != null && prev > 0 ? (curr - prev) / prev : null
);

// Same preset list as everywhere, plus "all time" (the Orders-page pattern).
// With 'all' selected the hook skips the previous-period comparison.
const RANGE_PRESETS = [{ key: 'all', label: 'הכול' }, ...DEFAULT_PRESETS];

export default function Marketing() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const [rangeKey, setRangeKey] = useState('30days');
  const [customRange, setCustomRange] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [channelFilter, setChannelFilter] = useState('all');
  const [focus, setFocus] = useState(null); // { campaign, nonce } from insight clicks

  const {
    data, raw, hasComparison, dateRange, isLoading, isFetching, error, partialFailures, refetch,
  } = useMarketingPanelData({ rangeKey, customRange, enabled: isAdmin });

  const uiRange = useMemo(
    () => ({ from: dateRange.start, to: dateRange.end }),
    [dateRange.start, dateRange.end],
  );

  const channels = data?.channels || [];
  const selectedChannelRow = channelFilter === 'all' ? null : channels.find((c) => c.channel === channelFilter);

  // A range change can make the selected channel disappear from the chips
  // (no leads in the new range) — reset instead of filtering by an invisible
  // chip the user can't see or un-click.
  useEffect(() => {
    if (channelFilter !== 'all' && data
        && !data.channels.some((c) => c.channel === channelFilter && c.leads > 0)) {
      setChannelFilter('all');
    }
  }, [data, channelFilter]);

  // The KPI strip follows the channel cut: with a channel selected the cards
  // show that channel's economics (its deltas came merged from the hook).
  const kpi = useMemo(() => {
    if (!data) return null;
    if (!selectedChannelRow) {
      const t = data.totals;
      return { ...t, deltas: t.deltas, medianDelta: fracDelta(t.medianMins, t.prevMedianMins) };
    }
    const c = selectedChannelRow;
    return {
      leads: c.leads, won: c.won, conversion: c.conversion, revenue: c.revenue,
      spend: c.spend, cpl: c.cpl, cac: c.cac, roas: c.roas,
      contacted: c.contacted, quoted: c.quoted, open: c.open, orders: c.orders,
      medianMins: c.medianMins,
      deltas: { leads: c.leadsDelta, won: null, revenue: c.revenueDelta, spend: null, cpl: null, cac: null, roas: null },
      medianDelta: null,
    };
  }, [data, selectedChannelRow]);

  const visibleCampaigns = useMemo(() => {
    const rows = data?.campaigns || [];
    return channelFilter === 'all' ? rows : rows.filter((c) => c.channel === channelFilter);
  }, [data, channelFilter]);

  const visibleLandingPages = useMemo(() => {
    const rows = raw?.landing_pages || [];
    return channelFilter === 'all' ? rows : rows.filter((r) => r.channel === channelFilter);
  }, [raw, channelFilter]);

  const insightByCampaign = useMemo(
    () => new Map((data?.insights || []).filter((i) => i.campaign).map((i) => [i.campaign, i.type])),
    [data],
  );

  const funnelTotals = selectedChannelRow || data?.totals;

  const jumpToCampaign = (campaign) => {
    setChannelFilter('all');
    setActiveTab('campaigns');
    setFocus({ campaign, nonce: Date.now() });
  };
  // Cleared once the table scrolled to it, so leaving and re-entering the
  // campaigns tab doesn't replay the spotlight and wipe the user's filters.
  const clearFocus = useCallback(() => setFocus(null), []);

  // ── דוח לידים — fetched only when that tab is open, on the same date basis
  // (effective_sort_date) the aggregates use, so the counts agree.
  const { openLead, lastOpenedLeadId } = useLeadModal();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin,
  });
  const repNameByEmail = useMemo(() => new Map(users.map((u) => [u.email, u.full_name || u.email])), [users]);

  const startIso = dateRange.start.toISOString();
  const endIso = dateRange.end.toISOString();
  const { data: rangeLeads = [], isFetching: leadsFetching } = useQuery({
    queryKey: ['marketingLeads', startIso, endIso],
    enabled: isAdmin && activeTab === 'leads',
    staleTime: 60 * 1000,
    queryFn: () => base44.entities.Lead.filter(
      { effective_sort_date: { $gte: startIso, $lte: endIso } },
      '-effective_sort_date',
      1000,
    ),
  });
  const displayLeads = useMemo(
    () => (channelFilter === 'all' ? rangeLeads : rangeLeads.filter((l) => leadChannel(l) === channelFilter)),
    [rangeLeads, channelFilter],
  );

  if (isLoadingUser) return <div className="text-center py-12 text-muted-foreground">טוען...</div>;
  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת לדשבורד שיווק</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-orange-100">
            <Megaphone className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">פאנל שיווק</h1>
            <p className="text-sm text-muted-foreground">
              איזה קמפיין עובד, איפה להעלות תקציב ואיפה להוריד — עם השוואה לתקופה הקודמת
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dashboard2DateRange
            rangeKey={rangeKey}
            dateRange={uiRange}
            presets={RANGE_PRESETS}
            onPresetChange={(k) => { setRangeKey(k); if (k !== 'custom') setCustomRange(null); }}
            onCustomChange={(r) => { setCustomRange(r || null); if (r?.from && r?.to) setRangeKey('custom'); }}
          />
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={refetch} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            רענן
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-900 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">לא הצלחנו לטעון את נתוני השיווק: {error.message || String(error)}</span>
          <Button variant="outline" size="sm" onClick={refetch}>נסה שוב</Button>
        </div>
      ) : partialFailures.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 flex items-center gap-2 text-xs">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          חלק מהנתונים לא נטענו ({partialFailures.join(' · ')}) — ייתכן שחלק מהמספרים חלקיים.
        </div>
      ) : null}

      {/* Channel cut — everything below re-slices to the selected channel */}
      {channels.length > 0 && (
        <ChannelChips
          channels={channels.filter((c) => c.leads > 0)}
          selected={channelFilter}
          onSelect={setChannelFilter}
        />
      )}

      {/* KPI strip */}
      {isLoading || !kpi ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard
            title="לידים" value={kpi.leads} icon={Users} color="indigo"
            delta={kpi.deltas.leads} deltaLabel={hasComparison ? 'מול תקופה קודמת' : undefined}
            subtitle={`${(kpi.contacted || 0).toLocaleString()} טופלו · ${(kpi.quoted || 0).toLocaleString()} הצעות`}
          />
          <KPICard
            title="עסקאות שנסגרו" value={kpi.won} icon={Handshake} color="emerald"
            delta={kpi.deltas.won}
            subtitle={`המרה ${Number(kpi.conversion || 0).toFixed(1)}%`}
          />
          <KPICard
            title="הכנסות מלידי התקופה" value={formatCurrency(kpi.revenue)} formatValue={false}
            icon={TrendingUp} color="violet" delta={kpi.deltas.revenue}
            subtitle={kpi.orders ? `${Number(kpi.orders).toLocaleString()} הזמנות` : undefined}
          />
          <KPICard
            title="הוצאות שיווק" value={formatCurrency(kpi.spend)} formatValue={false}
            icon={DollarSign} color="red" delta={kpi.deltas.spend} deltaPolarity="negative"
          />
          <KPICard
            title="עלות לליד (CPL)" value={kpi.cpl != null ? formatCurrency(kpi.cpl) : '—'} formatValue={false}
            icon={Target} color="amber" delta={kpi.deltas.cpl} deltaPolarity="negative"
          />
          <KPICard
            title="עלות לעסקה (CAC)" value={kpi.cac != null ? formatCurrency(kpi.cac) : '—'} formatValue={false}
            icon={Wallet} color="orange" delta={kpi.deltas.cac} deltaPolarity="negative"
          />
          <KPICard
            title="החזר על השקעה (ROAS)" value={kpi.roas != null ? `${kpi.roas.toFixed(2)}x` : '—'} formatValue={false}
            icon={TrendingUp} color={kpi.roas != null && kpi.roas >= 1 ? 'emerald' : 'gray'}
            delta={kpi.deltas.roas}
          />
          <KPICard
            title="זמן תגובה חציוני" value={formatMins(kpi.medianMins)} formatValue={false}
            icon={Timer} color="blue" delta={kpi.medianDelta} deltaPolarity="negative"
            subtitle="מהגעת הליד לשיחה ראשונה"
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border w-full h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">סקירה</TabsTrigger>
          <TabsTrigger value="campaigns">קמפיינים</TabsTrigger>
          <TabsTrigger value="landing">דפי נחיתה</TabsTrigger>
          <TabsTrigger value="leads">דוח לידים</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <InsightsPanel insights={data?.insights || []} onCampaignClick={jumpToCampaign} />
          <TrendCharts
            daily={raw?.daily || []}
            revenueDaily={raw?.revenue_daily || []}
            selectedChannel={channelFilter}
          />
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <MarketingFunnelCard totals={funnelTotals || {}} />
            <div className="xl:col-span-2">
              <MarketingHeatmap
                hours={raw?.hours || []}
                note={channelFilter !== 'all' ? 'כל הערוצים (ללא סינון)' : undefined}
              />
            </div>
          </div>
          <ChannelsTable
            channels={channels}
            isLoading={isLoading}
            onChannelClick={(ch) => setChannelFilter((prev) => (prev === ch ? 'all' : ch))}
          />
        </div>
      )}

      {activeTab === 'campaigns' && (
        <CampaignsTable
          campaigns={visibleCampaigns}
          isLoading={isLoading}
          start={dateRange.start}
          end={dateRange.end}
          insightByCampaign={insightByCampaign}
          focusCampaign={focus?.campaign}
          focusNonce={focus?.nonce}
          onFocusHandled={clearFocus}
        />
      )}

      {activeTab === 'landing' && (
        <LandingPagesTable rows={visibleLandingPages} isLoading={isLoading} />
      )}

      {activeTab === 'leads' && (
        <Card>
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span>דוח לידים {channelFilter !== 'all' ? `— ${channelLabel(channelFilter)}` : ''}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {leadsFetching ? 'טוען…'
                  : displayLeads.length > 500
                    ? `מציג 500 מתוך ${displayLeads.length}${rangeLeads.length >= 1000 ? '+' : ''} לידים`
                    : `${displayLeads.length} לידים`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {/* Same table as ניהול לידים — click a row to open the lead in the
                same popup. */}
            <LeadListTable
              leads={displayLeads.slice(0, 500)}
              isLoading={leadsFetching && displayLeads.length === 0}
              repNameByEmail={repNameByEmail}
              onRowClick={(lead) => openLead(lead.id)}
              highlightId={lastOpenedLeadId}
              emptyMessage="לא נמצאו לידים בטווח"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
