import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from '@/components/shared/KPICard';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import Dashboard2DateRange, { DEFAULT_PRESETS } from '@/components/dashboard2/Dashboard2DateRange';
import UserAvatar from '@/components/shared/UserAvatar';
import { getDateRange } from '@/utils/dateRange';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Phone, PhoneIncoming, PhoneOutgoing, HelpCircle, Clock, Target, AlertCircle, Users } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly } from '@/lib/rbac';
import RecordingPlayer from '@/components/call/RecordingPlayer';

const RESULT_COLORS = {
  answered_positive: '#10b981',
  answered_neutral: '#3b82f6',
  answered_negative: '#f59e0b',
  no_answer: '#6b7280',
  busy: '#f59e0b',
  voicemail_left: '#8b5cf6',
  callback_requested: '#a855f7',
  not_interested: '#ef4444',
};

// Format seconds as m:ss.
const fmtDuration = (secs) => `${Math.floor((secs || 0) / 60)}:${((secs || 0) % 60).toString().padStart(2, '0')}`;

// Hebrew labels for the call-result codes (used by the pie chart + tooltip).
const RESULT_LABELS = {
  answered_positive: 'מעוניין',
  answered_neutral: 'נייטרלי',
  answered_negative: 'שלילי',
  no_answer: 'לא ענה',
  busy: 'תפוס',
  voicemail_left: 'הודעה',
  callback_requested: 'התקשרות חוזרת',
  not_interested: 'לא מעוניין',
};
const resultLabel = (code) => RESULT_LABELS[code] || code || 'אחר';

// Date presets: "כל הזמן" first (the default), then the shared presets.
const CALL_PRESETS = [{ key: 'all', label: 'כל הזמן' }, ...DEFAULT_PRESETS];

// Direction buckets. 'unknown' is a real population — imported and legacy rows
// that never got a call_direction — so it gets its own label and card instead
// of being dropped, which would stop the numbers adding up to the total.
const DIRECTION_LABELS = {
  inbound: 'נכנסות',
  outbound: 'יוצאות',
  unknown: 'ללא סיווג',
};
const DIRECTION_ORDER = ['inbound', 'outbound', 'unknown'];
const DIRECTION_ICONS = { inbound: PhoneIncoming, outbound: PhoneOutgoing, unknown: HelpCircle };
const DIRECTION_COLORS = { inbound: '#10b981', outbound: '#6366f1', unknown: '#94a3b8' };

// Most recent N rows shown in the table (server-capped).
const PAGE_SIZE = 500;

function applyCallFilters(query, { search, result, rep, direction }) {
  if (result && result !== 'all') query = query.eq('call_result', result);
  if (rep && rep !== 'all') query = query.eq('rep_id', rep);
  // The view exposes call_direction already bucketed, so 'unknown' is a plain
  // equality match rather than an is-null-or-empty dance.
  if (direction && direction !== 'all') query = query.eq('call_direction', direction);
  if (search && search.trim()) {
    const term = search.trim().replace(/[",()]/g, '');
    query = query.or(`lead_full_name.ilike.%${term}%,phone_number.ilike.%${term}%`);
  }
  return query;
}

// Apply the active date window to a call_logs_detailed query (filters on
// call_started_at; "all" leaves it unbounded).
function applyDateRange(query, startISO, endISO) {
  if (startISO) query = query.gte('call_started_at', startISO);
  if (endISO) query = query.lt('call_started_at', endISO);
  return query;
}

export default function CallAnalytics() {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();
  const [user, setUser] = useState(null);
  const [callingPhone, setCallingPhone] = useState(null);
  const [filters, setFilters] = useState({ search: '', result: 'all', rep: 'all', direction: 'all' });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rangeKey, setRangeKey] = useState('all');
  const [customRange, setCustomRange] = useState(undefined); // { from, to }

  // Debounce the free-text search so we don't fire an ilike scan per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const queryFilters = {
    search: debouncedSearch,
    result: filters.result,
    rep: filters.rep,
    direction: filters.direction,
  };
  // When a rep is selected, the KPIs + charts scope to that rep too (not just
  // the table). null = all reps. Same contract for the direction filter: it has
  // to move every number on the page, otherwise the cards and the table
  // disagree about what's being shown.
  const repFilter = filters.rep === 'all' ? null : filters.rep;
  const directionFilter = filters.direction === 'all' ? null : filters.direction;

  // Resolve the date window to ISO bounds. "all" → null bounds (whole table).
  const { startISO, endISO } = useMemo(() => {
    if (rangeKey === 'all') return { startISO: null, endISO: null };
    const { start, end } = getDateRange(rangeKey, customRange?.from, customRange?.to);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [rangeKey, customRange]);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        const effectiveUser = getEffectiveUser(userData);
        if (!canAccessAdminOnly(effectiveUser)) {
          navigate(createPageUrl('Dashboard2'));
        }
      } catch (err) {}
    };
    fetchUser();
  }, [getEffectiveUser, navigate]);

  const effectiveUser = getEffectiveUser(user);
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const handleClickToCall = async (phone, leadId) => {
    if (!phone) return;
    setCallingPhone(phone);
    try {
      await base44.functions.invoke('clickToCall', { customerPhone: phone, leadId });
      toast.success('השיחה התחילה בהצלחה ונרשמה');
      refetchLogs();
    } catch (error) {
      toast.error(`שגיאה: ${error.message}`);
    } finally {
      setCallingPhone(null);
    }
  };

  // ── KPIs for the window (one row) ──
  const { data: kpis = { total_calls: 0, answered_calls: 0, positive_calls: 0, avg_duration: 0 } } = useQuery({
    queryKey: ['callKpis', startISO, endISO, repFilter, directionFilter],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_kpis', { p_start: startISO, p_end: endISO, p_rep: repFilter, p_direction: directionFilter })
        .maybeSingle();
      if (error) throw error;
      return data || { total_calls: 0, answered_calls: 0, positive_calls: 0, avg_duration: 0 };
    },
  });

  // ── Result distribution (pie) ──
  const { data: byResult = [] } = useQuery({
    queryKey: ['callByResult', startISO, endISO, repFilter, directionFilter],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_by_result', { p_start: startISO, p_end: endISO, p_rep: repFilter, p_direction: directionFilter });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Hourly distribution (bar) ──
  const { data: byHour = [] } = useQuery({
    queryKey: ['callByHour', startISO, endISO, repFilter, directionFilter],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_by_hour', { p_start: startISO, p_end: endISO, p_rep: repFilter, p_direction: directionFilter });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Direction split for the window (drives the נכנסות/יוצאות summary cards).
  // Deliberately NOT scoped by the direction filter — these cards are how you
  // pick a direction, so they always show all three buckets. They do follow the
  // rep filter, like every other number on the page. ──
  const { data: byDirection = [] } = useQuery({
    queryKey: ['callByDirection', startISO, endISO, repFilter],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_by_direction', { p_start: startISO, p_end: endISO, p_rep: repFilter });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Per-rep breakdown for the window (drives the "ניתוח לפי נציג" cards) ──
  const { data: byRep = [] } = useQuery({
    queryKey: ['callByRep', startISO, endISO, directionFilter],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_by_rep', { p_start: startISO, p_end: endISO, p_direction: directionFilter });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Distinct reps for the filter dropdown (all-time) ──
  const { data: repRows = [] } = useQuery({
    queryKey: ['callReps'],
    enabled: isAdmin,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await base44.supabase.from('call_analytics_reps').select('rep_id');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    enabled: isAdmin,
    staleTime: 60000,
    queryFn: () => base44.entities.User.list(),
  });

  // ── Table: server-side filtered + windowed + capped to most recent PAGE_SIZE ──
  const { data: logs = [], isLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['callLogsDetailed', queryFilters, startISO, endISO, PAGE_SIZE],
    enabled: isAdmin,
    staleTime: 30000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = base44.supabase
        .from('call_logs_detailed')
        .select('*')
        .order('created_date', { ascending: false })
        .limit(PAGE_SIZE);
      q = applyDateRange(q, startISO, endISO);
      q = applyCallFilters(q, queryFilters);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: matchCount = null } = useQuery({
    queryKey: ['callLogsCount', queryFilters, startISO, endISO],
    enabled: isAdmin,
    staleTime: 30000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = base44.supabase.from('call_logs_detailed').select('*', { count: 'exact', head: true });
      q = applyDateRange(q, startISO, endISO);
      q = applyCallFilters(q, queryFilters);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  // ── Derived KPIs ──
  const totalCalls = Number(kpis.total_calls) || 0;
  const answeredCalls = Number(kpis.answered_calls) || 0;
  const positiveCalls = Number(kpis.positive_calls) || 0;
  const avgDuration = Number(kpis.avg_duration) || 0;
  const answerRate = totalCalls > 0 ? ((answeredCalls / totalCalls) * 100).toFixed(1) : 0;
  const conversionRate = answeredCalls > 0 ? ((positiveCalls / answeredCalls) * 100).toFixed(1) : 0;

  // ── Charts ──
  const pieData = byResult
    .filter((r) => r.result_code)
    .map((r) => ({ name: resultLabel(r.result_code), value: Number(r.cnt), color: RESULT_COLORS[r.result_code] || '#94a3b8' }));

  const hourlyData = Array.from({ length: 24 }, (_, i) => ({ hour: i, calls: 0, answered: 0 }));
  byHour.forEach((r) => {
    const h = Number(r.hour);
    if (h >= 0 && h < 24) {
      hourlyData[h].calls = Number(r.calls) || 0;
      hourlyData[h].answered = Number(r.answered) || 0;
    }
  });
  const activeHours = hourlyData.filter((h) => h.calls > 0);

  // Per-rep cards (sorted by name) + a "כל הצוות" aggregate, all window-scoped.
  const usersByEmail = useMemo(() => {
    const m = new Map();
    users.forEach((u) => { if (u.email) m.set(u.email, u); });
    return m;
  }, [users]);

  const repCards = useMemo(() => {
    return byRep
      .map((r) => ({
        rep_id: r.rep_id,
        name: getRepDisplayName(r.rep_id, users) || r.rep_id,
        user: usersByEmail.get(r.rep_id) || { full_name: getRepDisplayName(r.rep_id, users) || r.rep_id, email: r.rep_id },
        total: Number(r.total) || 0,
        answered: Number(r.answered) || 0,
        positive: Number(r.positive) || 0,
        totalDuration: Number(r.total_duration) || 0,
        inbound: Number(r.inbound) || 0,
        outbound: Number(r.outbound) || 0,
        noDirection: Number(r.no_direction) || 0,
        inboundAnswered: Number(r.inbound_answered) || 0,
        outboundAnswered: Number(r.outbound_answered) || 0,
      }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
  }, [byRep, users, usersByEmail]);

  const teamTotals = useMemo(() => repCards.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      answered: acc.answered + r.answered,
      positive: acc.positive + r.positive,
      totalDuration: acc.totalDuration + r.totalDuration,
      inbound: acc.inbound + r.inbound,
      outbound: acc.outbound + r.outbound,
      noDirection: acc.noDirection + r.noDirection,
      inboundAnswered: acc.inboundAnswered + r.inboundAnswered,
      outboundAnswered: acc.outboundAnswered + r.outboundAnswered,
    }),
    { total: 0, answered: 0, positive: 0, totalDuration: 0, inbound: 0, outbound: 0, noDirection: 0, inboundAnswered: 0, outboundAnswered: 0 },
  ), [repCards]);

  // ── Direction summary. Always all three buckets in a fixed order, even when
  // a bucket is empty, so the row doesn't reshuffle as the window changes. ──
  const directionStats = useMemo(() => {
    const byKey = new Map(byDirection.map((row) => [row.direction, row]));
    const grandTotal = byDirection.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    return DIRECTION_ORDER.map((key) => {
      const row = byKey.get(key);
      const total = Number(row?.total) || 0;
      const answered = Number(row?.answered) || 0;
      return {
        key,
        label: DIRECTION_LABELS[key],
        total,
        answered,
        shareOfAll: grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0,
        answerRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      };
    });
  }, [byDirection]);

  // Stacked bar: inbound vs outbound per rep. Reps with no calls in the window
  // would just be empty columns, so they're dropped.
  const directionByRepChart = useMemo(
    () => repCards
      .filter((r) => r.total > 0)
      .map((r) => ({ name: r.name, inbound: r.inbound, outbound: r.outbound, unknown: r.noDirection })),
    [repCards],
  );

  const filterOptions = [
    {
      key: 'result',
      label: 'תוצאה',
      options: Object.entries(RESULT_LABELS).map(([value, label]) => ({ value, label })),
    },
    {
      key: 'direction',
      label: 'כיוון שיחה',
      options: DIRECTION_ORDER.map((value) => ({ value, label: DIRECTION_LABELS[value] })),
    },
    {
      key: 'rep',
      label: 'נציג',
      options: repRows.map((r) => ({ value: r.rep_id, label: getRepDisplayName(r.rep_id, users) || r.rep_id })),
    },
  ];

  const columns = [
    {
      header: 'פעולות',
      width: '60px',
      render: (log) => (
        <button
          onClick={() => handleClickToCall(log.lead_phone, log.lead_id)}
          disabled={!log.lead_phone || callingPhone === log.lead_phone}
          className="p-2 text-primary hover:bg-primary/5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait"
          title="התקשר"
        >
          <Phone className={`h-4 w-4 ${callingPhone === log.lead_phone ? 'animate-pulse' : ''}`} />
        </button>
      ),
    },
    {
      header: 'תאריך',
      accessor: 'call_started_at',
      render: (log) => (log.call_started_at ? format(new Date(log.call_started_at), 'dd/MM HH:mm') : '-'),
      width: '120px',
    },
    {
      header: 'ליד',
      accessor: 'lead_id',
      render: (log) => {
        if (log.lead_full_name) return log.lead_full_name;
        if (log.phone_number) {
          return <span className="text-muted-foreground" dir="ltr">{log.phone_number}</span>;
        }
        return '-';
      },
    },
    {
      header: 'כיוון',
      accessor: 'call_direction',
      width: '90px',
      render: (log) => {
        const key = DIRECTION_LABELS[log.call_direction] ? log.call_direction : 'unknown';
        const Icon = DIRECTION_ICONS[key];
        const tone = {
          inbound: 'bg-emerald-50 text-emerald-700',
          outbound: 'bg-indigo-50 text-indigo-700',
          unknown: 'bg-muted text-muted-foreground',
        }[key];
        return (
          <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${tone}`}>
            <Icon className="h-3 w-3" />
            {DIRECTION_LABELS[key]}
          </span>
        );
      },
    },
    {
      header: 'נציג',
      accessor: 'rep_id',
      render: (log) => (log.rep_id ? getRepDisplayName(log.rep_id, users) : '-'),
    },
    {
      header: 'משך',
      accessor: 'call_duration_seconds',
      render: (log) => {
        if (!log.call_duration_seconds) return '-';
        const mins = Math.floor(log.call_duration_seconds / 60);
        const secs = log.call_duration_seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      },
      width: '80px',
    },
    {
      header: 'תוצאה',
      accessor: 'call_result',
      render: (log) => <StatusBadge status={log.call_result} />,
    },
    {
      header: 'הקלטה',
      accessor: 'recording_url',
      render: (log) => <RecordingPlayer recordingUrl={log.recording_url} hasRecording={!!log.recording_url} />,
    },
  ];

  if (!user) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <p className="text-muted-foreground">רק מנהלים יכולים לגשת לדף זה</p>
      </div>
    );
  }

  const shownCount = logs.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">ניתוח שיחות</h1>
        <Dashboard2DateRange
          rangeKey={rangeKey}
          dateRange={customRange}
          presets={CALL_PRESETS}
          onPresetChange={(k) => setRangeKey(k)}
          onCustomChange={(range) => { setCustomRange(range); setRangeKey('custom'); }}
        />
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="סה״כ שיחות" value={totalCalls} icon={Phone} color="indigo" />
        <KPICard
          title="אחוז מענה"
          value={`${answerRate}%`}
          formatValue={false}
          subtitle={`${answeredCalls.toLocaleString()} נענו`}
          icon={PhoneIncoming}
          color="emerald"
        />
        <KPICard
          title="משך ממוצע"
          value={fmtDuration(avgDuration)}
          formatValue={false}
          subtitle="דקות"
          icon={Clock}
          color="blue"
        />
        <KPICard
          title="המרה למעוניין"
          value={`${conversionRate}%`}
          formatValue={false}
          subtitle={`${positiveCalls.toLocaleString()} שיחות`}
          icon={Target}
          color="purple"
        />
      </div>

      {/* Direction summary — click a card to scope the WHOLE page to that
          direction (second click clears it). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {directionStats.map((d) => {
          const Icon = DIRECTION_ICONS[d.key];
          const isActive = filters.direction === d.key;
          const tone = {
            inbound: { ring: 'border-emerald-500 ring-2 ring-emerald-400 bg-emerald-50', icon: 'text-emerald-600', value: 'text-emerald-700' },
            outbound: { ring: 'border-indigo-500 ring-2 ring-indigo-400 bg-indigo-50', icon: 'text-indigo-600', value: 'text-indigo-700' },
            unknown: { ring: 'border-slate-400 ring-2 ring-slate-300 bg-slate-50', icon: 'text-slate-500', value: 'text-slate-700' },
          }[d.key];
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, direction: f.direction === d.key ? 'all' : d.key }))}
              className={`text-right rounded-xl border-2 p-3 shadow-card transition-all ${isActive ? tone.ring : 'border-border bg-card hover:border-foreground/30'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${tone.icon}`} />
                  {d.label}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{d.shareOfAll}% מכלל השיחות</span>
              </div>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${tone.value}`}>{d.total.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                {d.answered.toLocaleString()} נענו · {d.answerRate}% מענה
              </p>
            </button>
          );
        })}
      </div>

      {/* Per-rep analysis cards (window-scoped; click to filter the table) */}
      {repCards.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 px-1 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            ניתוח לפי נציג ({repCards.length})
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            <RepCallCard
              label="כל הצוות"
              avatar={<span className="h-8 w-8 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">כל</span>}
              total={teamTotals.total}
              answered={teamTotals.answered}
              totalDuration={teamTotals.totalDuration}
              inbound={teamTotals.inbound}
              outbound={teamTotals.outbound}
              isActive={filters.rep === 'all'}
              accent="indigo"
              onClick={() => setFilters((f) => ({ ...f, rep: 'all' }))}
            />
            {repCards.map((r) => (
              <RepCallCard
                key={r.rep_id}
                label={r.name}
                avatar={<UserAvatar user={r.user} size="sm" />}
                total={r.total}
                answered={r.answered}
                totalDuration={r.totalDuration}
                inbound={r.inbound}
                outbound={r.outbound}
                isActive={filters.rep === r.rep_id}
                accent="emerald"
                onClick={() => setFilters((f) => ({ ...f, rep: f.rep === r.rep_id ? 'all' : r.rep_id }))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inbound vs outbound per rep */}
      {directionByRepChart.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">נכנסות מול יוצאות לפי נציג</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={Math.max(220, directionByRepChart.length * 34)}>
              <BarChart data={directionByRepChart} layout="vertical" barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" orientation="top" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} orientation="right" />
                <Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name]} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="inbound" stackId="dir" fill={DIRECTION_COLORS.inbound} name={DIRECTION_LABELS.inbound} />
                <Bar dataKey="outbound" stackId="dir" fill={DIRECTION_COLORS.outbound} name={DIRECTION_LABELS.outbound} />
                <Bar dataKey="unknown" stackId="dir" fill={DIRECTION_COLORS.unknown} name={DIRECTION_LABELS.unknown} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Charts (compact) */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              התפלגות תוצאות{filters.direction !== 'all' ? ` — ${DIRECTION_LABELS[filters.direction]}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => (totalCalls > 0 ? `${((entry.value / totalCalls) * 100).toFixed(0)}%` : '')}
                  outerRadius={75}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name]} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">שעות אפקטיביות</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={activeHours} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" reversed tick={{ fontSize: 11 }} />
                <YAxis orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name]} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="calls" fill="#6366f1" name="סה״כ שיחות" />
                <Bar dataKey="answered" fill="#10b981" name="נענו" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', result: 'all', rep: 'all', direction: 'all' })}
        searchPlaceholder="חפש לפי שם ליד או טלפון..."
      />

      {matchCount !== null && (
        <p className="text-sm text-muted-foreground">
          מציג {shownCount.toLocaleString()} מתוך {matchCount.toLocaleString()} שיחות
          {matchCount > PAGE_SIZE && ' (סנן או חפש כדי לצמצם)'}
        </p>
      )}

      <DataTable columns={columns} data={logs} isLoading={isLoading} emptyMessage="אין שיחות להצגה" />
    </div>
  );
}

// Per-rep call card — mirrors LeadManagement's RepWorkloadCard design. Clicking
// it filters the table to that rep (toggle). "מעוניין" gave up its tile to the
// inbound/outbound split, which is the question this screen is now asked.
function RepCallCard({ label, avatar, total, answered, totalDuration, inbound = 0, outbound = 0, isActive, accent = 'emerald', onClick }) {
  const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;
  const avgSeconds = total > 0 ? Math.round(totalDuration / total) : 0;
  const tones = {
    indigo: { active: 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-400', total: 'text-indigo-700' },
    emerald: { active: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-400', total: 'text-emerald-700' },
  }[accent];
  const cardCls = isActive ? tones.active : 'border-border bg-card hover:border-foreground/30';
  const stats = [
    { label: 'נכנסות', value: inbound.toLocaleString(), box: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-700/80' },
    { label: 'יוצאות', value: outbound.toLocaleString(), box: 'bg-indigo-50', text: 'text-indigo-700', sub: 'text-indigo-700/80' },
    { label: 'נענו', value: `${answered.toLocaleString()} · ${answerRate}%`, box: 'bg-sky-50', text: 'text-sky-700', sub: 'text-sky-700/80' },
    { label: 'משך ממוצע', value: fmtDuration(avgSeconds), box: 'bg-violet-50', text: 'text-violet-700', sub: 'text-violet-700/80' },
  ];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right rounded-xl border-2 p-2.5 shadow-card transition-all ${cardCls}`}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {avatar}
        <span className="text-xs font-semibold truncate flex-1" title={label}>{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {stats.map((s) => (
          <div key={s.label} className={`${s.box} rounded p-1.5 text-center`}>
            <p className={`text-[10px] leading-tight ${s.sub}`}>{s.label}</p>
            <p className={`text-base font-bold tabular-nums leading-tight ${s.text}`}>{s.value}</p>
          </div>
        ))}
      </div>
      <p className={`text-[10px] mt-1.5 font-semibold ${isActive ? tones.total : 'text-muted-foreground'}`}>
        סה״כ {total.toLocaleString()} שיחות
      </p>
    </button>
  );
}
