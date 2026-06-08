import React from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import SectionCard from '../SectionCard';
import MiniKPI from '../MiniKPI';
import MiniSparkline from '../MiniSparkline';
import RepLeaderboard from '../RepLeaderboard';
import MarketingBreakdown from '../MarketingBreakdown';
import {
  Users,
  ShoppingCart,
  Headphones,
  Factory,
  TrendingUp,
  CheckSquare,
  Megaphone,
  Package,
} from 'lucide-react';

function formatCurrency(value) {
  return `₪${Number(value || 0).toLocaleString()}`;
}

export default function OverviewTab({ current = {}, previous = {}, dateRange, onSwitchTab }) {
  const navigate = useNavigate();
  const startIso = dateRange?.from ? new Date(dateRange.from).toISOString() : undefined;
  const endIso = dateRange?.to ? new Date(dateRange.to).toISOString() : undefined;

  const dateQuery = {};
  if (startIso) dateQuery.startDate = startIso;
  if (endIso) dateQuery.endDate = endIso;

  const goTo = (page, extraQuery = {}) => {
    const params = new URLSearchParams({ ...dateQuery, ...extraQuery });
    const query = params.toString();
    navigate(query ? `${createPageUrl(page)}?${query}` : createPageUrl(page));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {/* 1. לידים */}
      <SectionCard
        title="לידים"
        icon={Users}
        iconColor="text-blue-600"
        iconBg="bg-blue-100"
        drillToPage="Leads"
        drillQuery={dateQuery}
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniKPI label="חדשים בטווח" value={current.newLeadsCount} color="blue" onClick={() => goTo('Leads', { tab: 'all' })} />
          <MiniKPI label="פתוחים סה״כ" value={current.openLeadsTotal} color="indigo" onClick={() => goTo('Leads', { tab: 'open' })} />
          <MiniKPI label="ללא מענה" value={current.noAnswerLeads} color="amber" onClick={() => goTo('Leads', { tab: 'open' })} />
          <MiniKPI label="טרם טופלו" value={current.untouchedLeads} color="red" onClick={() => goTo('Leads', { status: 'new_lead' })} />
          <MiniKPI label="המרה" value={`${Number(current.conversion || 0).toFixed(0)}%`} color="emerald" />
        </div>
        <MiniSparkline data={current.leadsTrend || []} color="#3b82f6" valueLabel="לידים" />
      </SectionCard>

      {/* 2. הזמנות והכנסות */}
      <SectionCard
        title="הזמנות והכנסות"
        icon={ShoppingCart}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-100"
        drillToPage="Orders"
        drillQuery={dateQuery}
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniKPI label="מס׳ הזמנות" value={current.ordersCount} color="emerald" onClick={() => goTo('Orders', { tab: 'all' })} />
          <MiniKPI label="סכום מכירות" value={formatCurrency(current.revenue)} color="emerald" onClick={() => goTo('Orders', { tab: 'all' })} />
          <MiniKPI label="ממוצע הזמנה" value={formatCurrency(current.avgOrder)} color="indigo" />
          <MiniKPI label="ממתינות לתשלום" value={current.unpaidOrders} color="amber" onClick={() => goTo('Orders', { tab: 'unpaid' })} />
        </div>
        <MiniSparkline data={current.revenueTrend || []} color="#10b981" valueLabel="הכנסה" />
      </SectionCard>

      {/* 3. שירות לקוחות */}
      <SectionCard
        title="שירות לקוחות"
        icon={Headphones}
        iconColor="text-amber-600"
        iconBg="bg-amber-100"
        drillToPage="Support"
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniKPI label="פתוחים" value={current.openTickets} color="amber" onClick={() => goTo('Support', { status: 'open' })} />
          <MiniKPI label="דחופים" value={current.urgentTickets} color="red" onClick={() => goTo('Support', { priority: 'urgent' })} />
          <MiniKPI label="SLA פג" value={current.slaBreachedTickets} color="red" onClick={() => goTo('Support')} />
          <MiniKPI label="נפתחו היום" value={current.ticketsOpenedToday} color="cyan" onClick={() => goTo('Support')} />
        </div>
      </SectionCard>

      {/* 4. מפעל / ייצור */}
      <SectionCard
        title="מפעל / ייצור"
        icon={Factory}
        iconColor="text-violet-600"
        iconBg="bg-violet-100"
        drillToPage="Factory"
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniKPI label="בייצור" value={current.inProduction} color="violet" onClick={() => goTo('Factory')} />
          <MiniKPI label="מוכן למשלוח" value={current.readyForDelivery} color="emerald" onClick={() => goTo('Factory')} />
          <MiniKPI label="מאחרים" value={current.factoryOverdue} color="red" onClick={() => goTo('Factory')} />
          <MiniKPI label="לא התחיל" value={current.notStartedProduction} color="gray" onClick={() => goTo('Factory')} />
        </div>
      </SectionCard>

      {/* 5. ביצועי צוות מכירות — drills into the in-page Team tab */}
      <SectionCard
        title="ביצועי צוות מכירות"
        icon={TrendingUp}
        iconColor="text-indigo-600"
        iconBg="bg-indigo-100"
        onDrillClick={onSwitchTab ? () => onSwitchTab('team') : undefined}
      >
        <RepLeaderboard reps={current.reps || []} limit={5} />
      </SectionCard>

      {/* 6. משימות */}
      <SectionCard
        title="משימות"
        icon={CheckSquare}
        iconColor="text-cyan-600"
        iconBg="bg-cyan-100"
        drillToPage="SalesTasks"
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniKPI label="פתוחות" value={current.tasksOpen} color="cyan" onClick={() => goTo('SalesTasks', { tab: 'not_completed' })} />
          <MiniKPI label="להיום" value={current.tasksToday} color="amber" onClick={() => goTo('SalesTasks', { tab: 'today' })} />
          <MiniKPI label="באיחור" value={current.tasksOverdue} color="red" onClick={() => goTo('SalesTasks', { tab: 'overdue' })} />
          <MiniKPI label="הצעות ממתינות" value={current.pendingQuotes} color="indigo" onClick={() => goTo('Quotes', { tab: 'pending' })} />
        </div>
      </SectionCard>

      {/* 7. שיווק */}
      <SectionCard
        title="שיווק לפי מקור"
        icon={Megaphone}
        iconColor="text-orange-600"
        iconBg="bg-orange-100"
        drillToPage="Marketing"
      >
        <div className="grid grid-cols-3 gap-2">
          <MiniKPI label="עלויות שיווק" value={formatCurrency(current.marketingCost)} color="orange" />
          <MiniKPI label="לידים מקמפיינים" value={current.marketingLeads} color="orange" />
          <MiniKPI label="ROI כולל" value={current.marketingRoi ? `${current.marketingRoi}x` : '—'} color="emerald" />
        </div>
        <MarketingBreakdown sources={current.marketingBreakdown || []} limit={5} />
      </SectionCard>

      {/* 8. מלאי ומשלוחים */}
      <SectionCard
        title="מלאי ומשלוחים"
        icon={Package}
        iconColor="text-purple-600"
        iconBg="bg-purple-100"
        drillToPage="Inventory"
      >
        <div className="grid grid-cols-2 gap-2">
          <MiniKPI label="פריטים מתחת לסף" value={current.lowStockItems} color="red" onClick={() => goTo('Inventory')} />
          <MiniKPI label="משלוחים להיום" value={current.deliveriesToday} color="purple" onClick={() => goTo('Deliveries')} />
          <MiniKPI label="ממתינים לתזמון" value={current.deliveriesNeedScheduling} color="amber" onClick={() => goTo('Deliveries')} />
          <MiniKPI label="נשלחו בטווח" value={current.deliveriesShipped} color="emerald" onClick={() => goTo('Deliveries')} />
        </div>
      </SectionCard>
    </div>
  );
}
