import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from '@/components/shared/KPICard';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Phone, PhoneIncoming, Clock, Target, AlertCircle } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly } from '@/lib/rbac';
import { fetchAllList } from '@/lib/base44Pagination';

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

export default function CallAnalytics() {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();
  const [user, setUser] = useState(null);
  const [callingPhone, setCallingPhone] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    result: 'all',
    rep: 'all',
  });

  const handleClickToCall = async (phone, leadId) => {
    setCallingPhone(phone);
    try {
      await base44.functions.invoke('clickToCall', { customerPhone: phone, leadId });
      toast.success('השיחה התחילה בהצלחה ונרשמה');
      refetchCallLogs();
    } catch (error) {
      toast.error(`שגיאה: ${error.message}`);
    } finally {
      setCallingPhone(null);
    }
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        const effectiveUser = getEffectiveUser(userData);
        // RBAC: Only ADMIN can access CallAnalytics
        if (!canAccessAdminOnly(effectiveUser)) {
          navigate(createPageUrl('Dashboard'));
        }
      } catch (err) {}
    };
    fetchUser();
  }, [getEffectiveUser, navigate]);

  const effectiveUser = getEffectiveUser(user);

  const { data: callLogs = [], isLoading, refetch: refetchCallLogs } = useQuery({
    queryKey: ['callLogs'],
    queryFn: () => fetchAllList(base44.entities.CallLog, '-created_date'),
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
  });

  // Filter logs
  const filteredLogs = callLogs.filter(log => {
    const searchMatch = !filters.search || 
      log.call_notes?.toLowerCase().includes(filters.search.toLowerCase()) ||
      leads.find(l => l.id === log.lead_id)?.full_name?.toLowerCase().includes(filters.search.toLowerCase());
    
    const resultMatch = filters.result === 'all' || log.call_result === filters.result;
    const repMatch = filters.rep === 'all' || log.rep_id === filters.rep;

    return searchMatch && resultMatch && repMatch;
  });

  // Calculate KPIs
  const totalCalls = callLogs.length;
  const answeredCalls = callLogs.filter(log => 
    log.call_result?.startsWith('answered')
  ).length;
  const answerRate = totalCalls > 0 ? ((answeredCalls / totalCalls) * 100).toFixed(1) : 0;
  
  const avgDuration = callLogs.length > 0
    ? Math.round(callLogs.reduce((sum, log) => sum + (log.call_duration_seconds || 0), 0) / callLogs.length)
    : 0;

  const positiveCalls = callLogs.filter(log => log.call_result === 'answered_positive').length;
  const conversionRate = answeredCalls > 0 ? ((positiveCalls / answeredCalls) * 100).toFixed(1) : 0;

  // Prepare chart data - Results distribution
  const resultCounts = {};
  callLogs.forEach(log => {
    resultCounts[log.call_result] = (resultCounts[log.call_result] || 0) + 1;
  });

  const pieData = Object.entries(resultCounts).map(([result, count]) => ({
    name: result,
    value: count,
    color: RESULT_COLORS[result]
  }));

  // Hourly distribution
  const hourlyData = Array.from({ length: 24 }, (_, i) => ({ hour: i, calls: 0, answered: 0 }));
  callLogs.forEach(log => {
    if (!log.call_started_at) return;
    const hour = new Date(log.call_started_at).getHours();
    hourlyData[hour].calls++;
    if (log.call_result?.startsWith('answered')) {
      hourlyData[hour].answered++;
    }
  });

  const activeHours = hourlyData.filter(h => h.calls > 0);

  // Get unique reps
  const uniqueReps = [...new Set(callLogs.map(log => log.rep_id))];

  const filterOptions = [
    {
      key: 'result',
      label: 'תוצאה',
      options: [
        { value: 'answered_positive', label: 'חיובי' },
        { value: 'answered_neutral', label: 'נייטרלי' },
        { value: 'answered_negative', label: 'שלילי' },
        { value: 'no_answer', label: 'לא ענה' },
        { value: 'busy', label: 'תפוס' },
        { value: 'voicemail_left', label: 'הודעה' },
        { value: 'callback_requested', label: 'התקשרות חוזרת' },
        { value: 'not_interested', label: 'לא מעוניין' },
      ]
    },
    {
      key: 'rep',
      label: 'נציג',
      options: uniqueReps.map(rep => ({ value: rep, label: getRepDisplayName(rep, users) || rep }))
    }
  ];

  const columns = [
    {
      header: 'פעולות',
      width: '60px',
      render: (log) => {
        const lead = leads.find(l => l.id === log.lead_id);
        return (
          <button
            onClick={() => lead?.phone && handleClickToCall(lead.phone, log.lead_id)}
            disabled={callingPhone === lead?.phone}
            className="p-2 text-primary hover:bg-primary/5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="התקשר"
          >
            <Phone className={`h-4 w-4 ${callingPhone === lead?.phone ? 'animate-pulse' : ''}`} />
          </button>
        );
      }
    },
    {
      header: 'תאריך',
      accessor: 'call_started_at',
      render: (log) => log.call_started_at ? format(new Date(log.call_started_at), 'dd/MM HH:mm') : '-',
      width: '120px'
    },
    {
      header: 'ליד',
      accessor: 'lead_id',
      render: (log) => {
        const lead = leads.find(l => l.id === log.lead_id);
        return lead?.full_name || '-';
      }
    },
    {
      header: 'נציג',
      accessor: 'rep_id',
      render: (log) => {
        if (!log.rep_id) return '-';
        return getRepDisplayName(log.rep_id, users);
      }
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
      width: '80px'
    },
    {
      header: 'תוצאה',
      accessor: 'call_result',
      render: (log) => <StatusBadge status={log.call_result} />
    },
    {
      header: 'הערות',
      accessor: 'call_notes',
      render: (log) => (
        <div className="max-w-xs truncate text-sm text-muted-foreground">
          {log.call_notes || '-'}
        </div>
      )
    },
    {
      header: 'הקלטה',
      accessor: 'recording_url',
      render: (log) => (
        log.recording_url ? (
          <audio controls src={log.recording_url} className="h-8 w-48" preload="none" />
        ) : (
          <span className="text-muted-foreground/70 text-xs">אין הקלטה</span>
        )
      )
    }
  ];

  if (!user) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessAdminOnly(effectiveUser)) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <p className="text-muted-foreground">רק מנהלים יכולים לגשת לדף זה</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">ניתוח שיחות</h1>
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="סה״כ שיחות"
          value={totalCalls.toLocaleString()}
          icon={Phone}
          color="indigo"
        />
        <KPICard
          title="אחוז מענה"
          value={`${answerRate}%`}
          subtitle={`${answeredCalls} מענות`}
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
          subtitle={`${positiveCalls} שיחות`}
          icon={Target}
          color="purple"
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>התפלגות תוצאות</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${((entry.value / totalCalls) * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>שעות אפקטיביות</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={activeHours}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" label={{ value: 'שעה', position: 'insideBottom', offset: -5 }} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="calls" fill="#6366f1" name="שיחות" />
                <Bar dataKey="answered" fill="#10b981" name="מענות" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', result: 'all', rep: 'all' })}
        searchPlaceholder="חפש בהערות או שם ליד..."
      />

      <DataTable
        columns={columns}
        data={filteredLogs}
        isLoading={isLoading}
        emptyMessage="אין שיחות להצגה"
      />
    </div>
  );
}
