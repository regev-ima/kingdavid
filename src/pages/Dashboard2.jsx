import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly, isBookkeeperUser, isFactoryUser } from '@/lib/rbac';
import { getDateRange, getPreviousDateRange } from '@/utils/dateRange';

import Dashboard2Header from '@/components/dashboard2/Dashboard2Header';
import HeroStrip from '@/components/dashboard2/HeroStrip';
import OverviewTab from '@/components/dashboard2/tabs/OverviewTab';
import LeadsTab from '@/components/dashboard2/tabs/LeadsTab';
import OrdersTab from '@/components/dashboard2/tabs/OrdersTab';
import TeamTab from '@/components/dashboard2/tabs/TeamTab';
import MarketingTab from '@/components/dashboard2/tabs/MarketingTab';
import useDashboard2Data, { useDashboard2Live, useDashboard2LowStock, useDashboard2Previous } from '@/components/dashboard2/useDashboard2Data';
import { getDemoData, getDemoPrevious } from '@/components/dashboard2/demoData';

const DEMO_MODE_STORAGE_KEY = 'dashboard2.demoMode';

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-2xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard2() {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();

  // Shares Layout's cached ['currentUser'] query instead of running a THIRD
  // auth.me() round-trip that used to gate every dashboard query behind it
  // (the data fetches couldn't even start until it finished).
  const { data: user, isLoading: isCheckingAuth } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
  const [rangeKey, setRangeKey] = useState('today');
  const [customRange, setCustomRange] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [activeTab, setActiveTab] = useState('overview');
  const [demoMode, setDemoMode] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage?.getItem(DEMO_MODE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleDemoMode = () => {
    setDemoMode((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          window.localStorage?.setItem(DEMO_MODE_STORAGE_KEY, next ? '1' : '0');
        }
      } catch {
        // localStorage not available — ignore.
      }
      return next;
    });
  };

  // Same gating as Dashboard 1: admins only. Other roles bounce to their
  // home dashboard so they don't see an "Access denied" flash.
  const effectiveUserForGate = user ? getEffectiveUser(user) : null;
  const isAdminUser = effectiveUserForGate ? canAccessAdminOnly(effectiveUserForGate) : false;
  useEffect(() => {
    if (!effectiveUserForGate || isAdminUser) return;
    if (isFactoryUser(effectiveUserForGate)) {
      navigate(createPageUrl('FactoryDashboard'));
      return;
    }
    if (isBookkeeperUser(effectiveUserForGate)) {
      navigate(createPageUrl('Bookkeeping'));
      return;
    }
    // Reps land on "לידים/משימות מכירה" (LeadManagement) — their main
    // screen and first nav item.
    navigate(createPageUrl('LeadManagement'));
  }, [effectiveUserForGate, isAdminUser, navigate]);

  const { start, end } = useMemo(
    () => getDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );
  const { start: prevStart, end: prevEnd } = useMemo(
    () => getPreviousDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );

  const dateRange = useMemo(() => ({ from: start, to: end }), [start, end]);

  // Range-INDEPENDENT live counts + the slow inventory scan are cached on their
  // own keys, so switching the date range only refetches the range-dependent
  // query below — not the whole dashboard.
  const liveEnabled = !!user && !isCheckingAuth && !demoMode && isAdminUser;
  const liveQuery = useDashboard2Live({ enabled: liveEnabled });
  const lowStockQuery = useDashboard2LowStock({ enabled: liveEnabled });
  const currentQuery = useDashboard2Data({ start, end, enabled: liveEnabled });
  const previousQuery = useDashboard2Previous({ start: prevStart, end: prevEnd, enabled: liveEnabled });

  const demoCurrent = useMemo(
    () => (demoMode ? getDemoData(rangeKey, customRange, { start, end }) : null),
    [demoMode, rangeKey, customRange, start, end],
  );
  const demoPrevious = useMemo(
    () => (demoMode ? getDemoPrevious(rangeKey, customRange, { start: prevStart, end: prevEnd }) : null),
    [demoMode, rangeKey, customRange, prevStart, prevEnd],
  );

  const handlePresetChange = (key) => {
    setRangeKey(key);
    if (key !== 'custom') {
      setCustomRange(null);
    }
  };

  const handleCustomChange = (range) => {
    setCustomRange(range || null);
    if (range?.from && range?.to) {
      setRangeKey('custom');
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      currentQuery.refetch(),
      previousQuery.refetch(),
      liveQuery.refetch(),
      lowStockQuery.refetch(),
    ]);
    setLastUpdated(new Date());
  };

  if (isCheckingAuth || !user) {
    return <div className="text-center py-12 text-muted-foreground">טוען...</div>;
  }

  const current = demoMode
    ? (demoCurrent || {})
    : { ...(liveQuery.data || {}), ...(currentQuery.data || {}), lowStockItems: lowStockQuery.data ?? 0 };
  const previous = demoMode ? demoPrevious || {} : previousQuery.data || {};
  // First paint waits only on the range query + the (fast) live counts — NOT on
  // the inventory scan or the previous-period deltas, which fill in after.
  const isLoading = !demoMode
    && ((currentQuery.isLoading && !currentQuery.data) || (liveQuery.isLoading && !liveQuery.data));
  const isFetching = !demoMode && (currentQuery.isFetching || previousQuery.isFetching || liveQuery.isFetching);

  // Surface partial-load failures honestly. The snapshot now catches each
  // sub-query, so instead of the whole dashboard silently blanking to 0 when
  // (say) the stats Edge Function 500s, the parts that loaded show real data
  // and a banner names what failed. `currentQuery.error` covers the rare case
  // where the query rejects entirely (something outside the per-call guards).
  const dataErrors = demoMode
    ? []
    : [
        ...(currentQuery.data?._errors || []),
        ...(liveQuery.data?._errors || []),
        ...(currentQuery.error ? [{ source: 'dashboard', message: currentQuery.error.message || String(currentQuery.error) }] : []),
      ];

  return (
    <div className="space-y-4" dir="rtl">
      {isFetching && !isLoading ? (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-primary/20">
          <div className="h-full bg-primary animate-pulse" style={{ width: '55%' }} />
        </div>
      ) : null}

      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-2 pb-2 bg-background/80 backdrop-blur-sm">
        <Dashboard2Header
          rangeKey={rangeKey}
          dateRange={dateRange}
          onPresetChange={handlePresetChange}
          onCustomChange={handleCustomChange}
          onRefresh={handleRefresh}
          isFetching={isFetching}
          lastUpdated={lastUpdated}
          demoMode={demoMode}
          onToggleDemoMode={toggleDemoMode}
        />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          {dataErrors.length > 0 ? (
            <div
              className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 flex items-start justify-between gap-3"
              title={dataErrors.map((e) => `${e.source}: ${e.message}`).join('\n')}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">חלק מהנתונים לא נטענו — ייתכן שחלק מהמספרים חסרים או חלקיים.</p>
                <p className="text-xs text-amber-800/80 mt-0.5 truncate">
                  מקורות שנכשלו: {dataErrors.map((e) => e.source).join(' · ')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                className="shrink-0 text-xs font-semibold rounded-lg border border-amber-400 bg-white/70 px-3 py-1.5 hover:bg-white transition-colors"
              >
                נסה שוב
              </button>
            </div>
          ) : null}

          <HeroStrip current={current} previous={previous} dateRange={dateRange} rangeKey={rangeKey} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4" dir="rtl">
            <TabsList
              dir="rtl"
              className="bg-card border border-border h-auto flex flex-wrap p-1 justify-start w-full"
            >
              <TabsTrigger value="overview" className="text-xs">סקירה כללית</TabsTrigger>
              <TabsTrigger value="leads" className="text-xs">לידים</TabsTrigger>
              {/* שירות/מפעל/מלאי היו אריחי "בקרוב" — הוסרו עד שיהיה בהם תוכן
                  אמיתי; המסכים הייעודיים נגישים מהתפריט. */}
              <TabsTrigger value="orders" className="text-xs">הזמנות</TabsTrigger>
              <TabsTrigger value="team" className="text-xs">צוות</TabsTrigger>
              <TabsTrigger value="marketing" className="text-xs">שיווק</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="m-0">
              <OverviewTab current={current} previous={previous} dateRange={dateRange} onSwitchTab={setActiveTab} />
            </TabsContent>

            <TabsContent value="leads" className="m-0">
              <LeadsTab current={current} dateRange={dateRange} demoMode={demoMode} />
            </TabsContent>

            <TabsContent value="orders" className="m-0">
              <OrdersTab current={current} dateRange={dateRange} />
            </TabsContent>

            <TabsContent value="team" className="m-0">
              <TeamTab demoMode={demoMode} />
            </TabsContent>

            <TabsContent value="marketing" className="m-0">
              {/* Dashboard2-native marketing view. Drives off the same
                  `current` snapshot the other tabs use, so demo mode + the
                  global date range work out of the box. Charts are kept
                  compact (h-44) so the four breakdown tables (source /
                  campaign / landing page / rep) actually fit above the
                  fold — the standalone /Marketing route is one click
                  away for the deep-dive. */}
              <MarketingTab current={current} previous={previous} dateRange={dateRange} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
