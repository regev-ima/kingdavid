import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Megaphone, Users, Target, TrendingUp, DollarSign, RefreshCw, AlertTriangle,
  Handshake, Timer, Wallet,
} from 'lucide-react';
import Dashboard2DateRange, { DEFAULT_PRESETS } from '@/components/dashboard2/Dashboard2DateRange';
import KPICard from '@/components/shared/KPICard';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessAdminOnly } from '@/lib/rbac';
import { formatCurrency } from '@/utils/currency';
import { useMarketingPanelData } from '@/components/marketing/useMarketingPanelData';
import { formatMins } from '@/components/marketing/PanelBits';
import InfoTip from '@/components/marketing/InfoTip';
import ChannelChips from '@/components/marketing/ChannelChips';
import InsightsPanel from '@/components/marketing/InsightsPanel';
import TrendCharts from '@/components/marketing/TrendCharts';
import MarketingFunnelCard from '@/components/marketing/MarketingFunnelCard';
import MarketingHeatmap from '@/components/marketing/MarketingHeatmap';
import ChannelsTable from '@/components/marketing/ChannelsTable';
import CampaignsTable from '@/components/marketing/CampaignsTable';
import LandingPagesTable from '@/components/marketing/LandingPagesTable';

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
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={refetch} disabled={isFetching} title="טעינה מחדש של כל נתוני הפאנל">
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
        <div className="flex items-start gap-2">
          <ChannelChips
            channels={channels.filter((c) => c.leads > 0)}
            selected={channelFilter}
            onSelect={setChannelFilter}
          />
          <InfoTip title="איך ליד משתייך לערוץ" className="mt-1.5">
            <p>לחיצה על ערוץ חותכת את כל הפאנל (מדדים, גרפים וטבלאות) לערוץ הזה. לחיצה נוספת מבטלת.</p>
            <p>השיוך נקבע לפי <b>מקור ההגעה של הליד</b>, בסדר הזה: תגית utm_source מהקישור ← שדה המקור של הליד ← זיהוי פייסבוק לפי נתוני טופס הלידים.</p>
            <p>לכן ליד שהגיע <b>לאתר דרך מודעה</b> נספר בערוץ המודעה (פייסבוק/גוגל) ולא ב"אתר" — "אתר" מונה רק לידים שמקורם ישירות מטפסי האתר, בלי קמפיין מזוהה.</p>
            <p><b>"אחר"</b> = לידים שהמקור שלהם לא זוהה כאף ערוץ. כדי לראות מה יש שם: לחצו על "אחר" ופתחו את טאב הקמפיינים — שמות המקור הגולמיים יופיעו שם.</p>
          </InfoTip>
        </div>
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
            info={(
              <InfoTip title="לידים">
                <p>כמה לידים נכנסו בטווח התאריכים שנבחר (לפי תאריך הכניסה של הליד למערכת).</p>
                <p><b>טופלו</b> = בוצעה להם שיחה ראשונה. <b>הצעות</b> = נשלחה להם הצעת מחיר מהמערכת.</p>
                <p>החץ משווה לתקופה מקבילה באותו אורך שקדמה לטווח (למשל: 30 הימים שלפני 30 הימים האחרונים).</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="עסקאות שנסגרו" value={kpi.won} icon={Handshake} color="emerald"
            delta={kpi.deltas.won}
            subtitle={`המרה ${Number(kpi.conversion || 0).toFixed(1)}%`}
            info={(
              <InfoTip title="עסקאות שנסגרו">
                <p>לידים מהטווח שהגיעו לסטטוס <b>"נסגרה עסקה"</b> — גם אם הסגירה עצמה קרתה אחרי סוף הטווח.</p>
                <p><b>המרה</b> = עסקאות שנסגרו חלקי סך הלידים. שימו לב: לידים שעדיין בטיפול יכולים עוד להיסגר, אז ההמרה של תקופה טרייה תמשיך לעלות.</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="הכנסות מלידי התקופה" value={formatCurrency(kpi.revenue)} formatValue={false}
            icon={TrendingUp} color="violet" delta={kpi.deltas.revenue}
            subtitle={kpi.orders ? `${Number(kpi.orders).toLocaleString()} הזמנות` : undefined}
            info={(
              <InfoTip title="הכנסות מלידי התקופה">
                <p>סכום ההזמנות של הלידים שנכנסו בטווח — <b>גם אם ההזמנה בוצעה אחרי הטווח</b>. ככה מודדים כמה קמפיין באמת שווה.</p>
                <p>הזמנות מבוטלות לא נספרות. הזמנה משויכת דרך הליד שממנו נוצרה.</p>
                <p>שימו לב: זה שונה מגרף "הכנסות ביום" בסקירה, שמציג הזמנות שבוצעו בתוך הטווח (מכל הלידים).</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="הוצאות שיווק" value={formatCurrency(kpi.spend)} formatValue={false}
            icon={DollarSign} color="red" delta={kpi.deltas.spend} deltaPolarity="negative"
            info={(
              <InfoTip title="הוצאות שיווק">
                <p>סך העלויות שהוזנו בטבלת עלויות השיווק עבור הטווח, משויכות לערוץ ולקמפיין לפי השם שהוזן.</p>
                <p><b>₪0 אומר שלא הוזנו עלויות לתקופה</b> — ברגע שיוזנו, יחושבו אוטומטית גם CPL, CAC ו-ROAS, וההמלצות החכמות יתחילו להתחשב בכסף.</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="עלות לליד (CPL)" value={kpi.cpl != null ? formatCurrency(kpi.cpl) : '—'} formatValue={false}
            icon={Target} color="amber" delta={kpi.deltas.cpl} deltaPolarity="negative"
            info={(
              <InfoTip title="עלות לליד (CPL)">
                <p>הוצאות השיווק חלקי מספר הלידים בטווח. כמה עולה להביא ליד אחד.</p>
                <p>ככל שנמוך יותר — טוב יותר. מוצג רק כשהוזנו עלויות שיווק לתקופה.</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="עלות לעסקה (CAC)" value={kpi.cac != null ? formatCurrency(kpi.cac) : '—'} formatValue={false}
            icon={Wallet} color="orange" delta={kpi.deltas.cac} deltaPolarity="negative"
            info={(
              <InfoTip title="עלות לעסקה (CAC)">
                <p>הוצאות השיווק חלקי מספר העסקאות שנסגרו. כמה עולה להשיג לקוח משלם אחד.</p>
                <p>המדד החשוב באמת להחלטות תקציב: קמפיין עם CPL זול אבל CAC יקר מביא לידים זולים שלא קונים.</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="החזר על השקעה (ROAS)" value={kpi.roas != null ? `${kpi.roas.toFixed(2)}x` : '—'} formatValue={false}
            icon={TrendingUp} color={kpi.roas != null && kpi.roas >= 1 ? 'emerald' : 'gray'}
            delta={kpi.deltas.roas}
            info={(
              <InfoTip title="החזר על השקעה (ROAS)">
                <p>הכנסות מלידי התקופה חלקי הוצאות השיווק. כל שקל שהושקע — כמה שקלים החזיר.</p>
                <p><b>מעל 1x</b> = ההשקעה מחזירה את עצמה. <b>2x ומעלה</b> = טוב. מתחת ל-1x = הפסד על הקמפיין.</p>
              </InfoTip>
            )}
          />
          <KPICard
            title="זמן תגובה חציוני" value={formatMins(kpi.medianMins)} formatValue={false}
            icon={Timer} color="blue" delta={kpi.medianDelta} deltaPolarity="negative"
            subtitle="מהגעת הליד לשיחה ראשונה"
            info={(
              <InfoTip title="זמן תגובה חציוני">
                <p>כמה זמן עובר מרגע שהליד נכנס ועד השיחה הראשונה אליו — הערך החציוני (חצי מהלידים נענו מהר יותר, חצי לאט יותר).</p>
                <p>ליד שנענה מהר נסגר בסיכוי גבוה משמעותית. אם הזמן כאן ארוך — הבעיה בקיבולת המוקד, לא בקמפיינים.</p>
              </InfoTip>
            )}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border w-full h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">סקירה</TabsTrigger>
          <TabsTrigger value="campaigns">קמפיינים</TabsTrigger>
          <TabsTrigger value="landing">דפי נחיתה</TabsTrigger>
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
    </div>
  );
}
