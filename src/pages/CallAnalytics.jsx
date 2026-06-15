import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from '@/components/shared/KPICard';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import Dashboard2DateRange, { DEFAULT_PRESETS } from '@/components/dashboard2/Dashboard2DateRange';
import { getDateRange } from '@/utils/dateRange';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Phone, PhoneIncoming, Clock, Target, AlertCircle } from "lucide-react";
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

// Hebrew labels for the call-result codes (used by the pie chart + tooltip).
const RESULT_LABELS = {
  answered_positive: 'חיובי',
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

// Most recent N rows shown in the table (server-capped).
const PAGE_SIZE = 500;

function applyCallFilters(query, { search, result, rep }) {
  if (result && result !== 'all') query = query.eq('call_result', result);
  if (rep && rep !== 'all') query = query.eq('rep_id', rep);
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
  const [filters, setFilters] = useState({ search: '', result: 'all', rep: 'all' });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rangeKey, setRangeKey] = useState('all');
  const [customRange, setCustomRange] = useState(undefined); // { from, to }

  // Debounce the free-text search so we don't fire an ilike scan per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const queryFilters = { search: debouncedSearch, result: filters.result, rep: filters.rep };

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
    queryKey: ['callKpis', startISO, endISO],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_kpis', { p_start: startISO, p_end: endISO })
        .maybeSingle();
      if (error) throw error;
      return data || { total_calls: 0, answered_calls: 0, positive_calls: 0, avg_duration: 0 };
    },
  });

  // ── Result distribution (pie) ──
  const { data: byResult = [] } = useQuery({
    queryKey: ['callByResult', startISO, endISO],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_by_result', { p_start: startISO, p_end: endISO });
      if (error) throw error;
      return data || [];
    },
  });

  // ── Hourly distribution (bar) ──
  const { data: byHour = [] } = useQuery({
    queryKey: ['callByHour', startISO, endISO],
    enabled: isAdmin,
    staleTime: 60000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await base44.supabase
        .rpc('call_analytics_by_hour', { p_start: startISO, p_end: endISO });
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

  const filterOptions = [
    {
      key: 'result',
      label: 'תוצאה',
      options: Object.entries(RESULT_LABELS).map(([value, label]) => ({ value, label })),
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
        <KPICard title="סה״כ שיחות" value={totalCalls.toLocaleString()} icon={Phone} color="indigo" />
        <KPICard
          title="אחוז מענה"
          value={`${answerRate}%`}
          subtitle={`${answeredCalls.toLocaleString()} נענו`}
          icon={PhoneIncoming}
          color="emerald"
        />
        <KPICard
          title="משך ממוצע"
          value={`${Math.floor(avgDuration / 60)}:${(avgDuration % 60).toString().padStart(2, '0')}`}
          subtitle="דקות"
          icon={Clock}
          color="blue"
        />
        <KPICard
          title="המרה לחיובי"
          value={`${conversionRate}%`}
          subtitle={`${positiveCalls.toLocaleString()} שיחות`}
          icon={Target}
          color="purple"
        />
      </div>

      {/* Charts (compact) */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">התפלגות שיחות יוצאות</CardTitle>
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
              <BarChart data={activeHours}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
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
        onClear={() => setFilters({ search: '', result: 'all', rep: 'all' })}
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
