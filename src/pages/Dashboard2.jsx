import React, { useMemo, useState, useEffect } from 'react';
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
import PlaceholderTab from '@/components/dashboard2/tabs/PlaceholderTab';
import useDashboard2Data from '@/components/dashboard2/useDashboard2Data';

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

  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [rangeKey, setRangeKey] = useState('today');
  const [customRange, setCustomRange] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [activeTab, setActiveTab] = useState('overview');

  // Same gating as Dashboard 1: admins only. Other roles bounce to their
  // home dashboard so they don't see an "Access denied" flash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userData = await base44.auth.me();
        if (cancelled) return;
        const effectiveUser = getEffectiveUser(userData);
        if (!canAccessAdminOnly(effectiveUser)) {
          if (isFactoryUser(effectiveUser)) {
            navigate(createPageUrl('FactoryDashboard'));
            return;
          }
          if (isBookkeeperUser(effectiveUser)) {
            navigate(createPageUrl('Bookkeeping'));
            return;
          }
          navigate(createPageUrl('SalesDashboard'));
          return;
        }
        setUser(userData);
      } finally {
        if (!cancelled) setIsCheckingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getEffectiveUser, navigate]);

  const { start, end } = useMemo(
    () => getDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );
  const { start: prevStart, end: prevEnd } = useMemo(
    () => getPreviousDateRange(rangeKey, customRange?.from, customRange?.to),
    [rangeKey, customRange],
  );

  const dateRange = useMemo(() => ({ from: start, to: end }), [start, end]);

  const currentQuery = useDashboard2Data({
    start,
    end,
    enabled: !!user && !isCheckingAuth,
    label: 'current',
  });
  const previousQuery = useDashboard2Data({
    start: prevStart,
    end: prevEnd,
    enabled: !!user && !isCheckingAuth,
    label: 'previous',
  });

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
    await Promise.all([currentQuery.refetch(), previousQuery.refetch()]);
    setLastUpdated(new Date());
  };

  if (isCheckingAuth || !user) {
    return <div className="text-center py-12 text-muted-foreground">טוען...</div>;
  }

  const current = currentQuery.data || {};
  const previous = previousQuery.data || {};
  const isLoading = currentQuery.isLoading && !currentQuery.data;
  const isFetching = currentQuery.isFetching || previousQuery.isFetching;

  return (
    <div className="space-y-6" dir="rtl">
      {isFetching && !isLoading ? (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-primary/20">
          <div className="h-full bg-primary animate-pulse" style={{ width: '55%' }} />
        </div>
      ) : null}

      <Dashboard2Header
        rangeKey={rangeKey}
        dateRange={dateRange}
        onPresetChange={handlePresetChange}
        onCustomChange={handleCustomChange}
        onRefresh={handleRefresh}
        isFetching={isFetching}
        lastUpdated={lastUpdated}
      />

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          <HeroStrip current={current} previous={previous} dateRange={dateRange} />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="bg-card border border-border h-auto flex-wrap p-1 justify-start">
              <TabsTrigger value="overview" className="text-xs">סקירה כללית</TabsTrigger>
              <TabsTrigger value="leads" className="text-xs">לידים</TabsTrigger>
              <TabsTrigger value="orders" className="text-xs">הזמנות</TabsTrigger>
              <TabsTrigger value="service" className="text-xs">שירות</TabsTrigger>
              <TabsTrigger value="factory" className="text-xs">מפעל</TabsTrigger>
              <TabsTrigger value="team" className="text-xs">צוות</TabsTrigger>
              <TabsTrigger value="marketing" className="text-xs">שיווק</TabsTrigger>
              <TabsTrigger value="inventory" className="text-xs">מלאי</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="m-0">
              <OverviewTab current={current} previous={previous} dateRange={dateRange} />
            </TabsContent>

            <TabsContent value="leads" className="m-0">
              <LeadsTab current={current} dateRange={dateRange} />
            </TabsContent>

            <TabsContent value="orders" className="m-0">
              <OrdersTab current={current} dateRange={dateRange} />
            </TabsContent>

            <TabsContent value="service" className="m-0">
              <PlaceholderTab
                title="שירות לקוחות"
                description="בקרוב: פירוט מלא של כרטיסים פתוחים לפי קטגוריה, דחיפות וזמן טיפול ממוצע."
                drillToPage="Support"
              />
            </TabsContent>

            <TabsContent value="factory" className="m-0">
              <PlaceholderTab
                title="מפעל וייצור"
                description="בקרוב: תור הייצור המלא, זמני ייצור ממוצעים, הזמנות מאחרות."
                drillToPage="Factory"
              />
            </TabsContent>

            <TabsContent value="team" className="m-0">
              <TeamTab current={current} />
            </TabsContent>

            <TabsContent value="marketing" className="m-0">
              <PlaceholderTab
                title="שיווק"
                description="בקרוב: עלויות לפי קמפיין, ROI לכל מקור, ביצועי דפי נחיתה."
                drillToPage="Marketing"
              />
            </TabsContent>

            <TabsContent value="inventory" className="m-0">
              <PlaceholderTab
                title="מלאי ומשלוחים"
                description="בקרוב: רשימת פריטים מתחת לסף, משלוחים מתוזמנים, מסלולי משלוח."
                drillToPage="Inventory"
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
