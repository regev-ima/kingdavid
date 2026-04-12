import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import ResponsiveLeadsTable from '@/components/lead/ResponsiveLeadsTable';
import FilterBar from '@/components/shared/FilterBar';
import StatusBadge from '@/components/shared/StatusBadge';
import QuickActions from '@/components/shared/QuickActions';
import { Button } from "@/components/ui/button";
// Tabs removed
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Users, AlertCircle, UserPlus, FileSpreadsheet, Phone } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { formatInTimeZone } from 'date-fns-tz';
import ImportFromSheets from '@/components/lead/ImportFromSheets';
import UserAvatar from '@/components/shared/UserAvatar';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, SOURCE_LABELS, CLOSED_STATUSES, SLA_THRESHOLDS } from '@/constants/leadOptions';
import { useNavigate } from 'react-router-dom';
import { canAccessSalesWorkspace, isFactoryUser } from '@/components/shared/rbac';

const filterOptions = [
  { key: 'status', label: 'סטטוס', options: LEAD_STATUS_OPTIONS },
  { key: 'source', label: 'מקור', options: LEAD_SOURCE_OPTIONS },
];

export default function Leads() {
  const initialParams = new URLSearchParams(window.location.search);
  const repScope = initialParams.get('repScope') === 'primary' ? 'primary' : 'any';
  const startDateParam = initialParams.get('startDate') || '';
  const endDateParam = initialParams.get('endDate') || '';
  const [user, setUser] = useState(null);
  const initialTab = initialParams.get('tab');
  const [activeTab, setActiveTab] = useState(['all', 'my', 'open', 'unassigned'].includes(initialTab) ? initialTab : 'all');
  const [filters, setFilters] = useState({
    search: initialParams.get('search') || '',
    status: initialParams.get('status') || 'all',
    source: initialParams.get('source') || 'all',
    rep1: initialParams.get('rep1') || 'all'
  });
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [assigningRep, setAssigningRep] = useState('');
  const [showImportFromSheets, setShowImportFromSheets] = useState(false);
  const [limit, setLimit] = useState(100);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        const effectiveUser = getEffectiveUser(userData);
        
        // Check URL params for filter
        const params = new URLSearchParams(window.location.search);
        if (params.get('filter') === 'unassigned' && effectiveUser?.role === 'admin') {
          setActiveTab('unassigned');
        } else if (effectiveUser?.role !== 'admin') {
          // Non-admin users default to 'my' tab
          setActiveTab('my');
        }
      } catch (err) {}
    };
    fetchUser();
  }, [getEffectiveUser]);

  // Fetch lead counters (lightweight)
  const { data: leadCounters = [] } = useQuery({
    queryKey: ['leadCounters'],
    queryFn: () => base44.entities.LeadCounter.list('-created_date', 500),
    staleTime: 60000,
  });

  const effectiveUser = getEffectiveUser(user);
  const isAdmin = effectiveUser?.role === 'admin';
  const userEmail = effectiveUser?.email;

  useEffect(() => {
    if (!effectiveUser) return;

    if (!canAccessSalesWorkspace(effectiveUser)) {
      navigate(createPageUrl(isFactoryUser(effectiveUser) ? 'FactoryDashboard' : 'Dashboard'));
      return;
    }

    if (!isAdmin && activeTab === 'unassigned') {
      setActiveTab('my');
    }
  }, [activeTab, effectiveUser, isAdmin, navigate]);

  const closedStatuses = CLOSED_STATUSES;

  const buildQuery = () => {
    const conditions = [];
    const startDate = startDateParam ? new Date(startDateParam) : null;
    const endDate = endDateParam ? new Date(endDateParam) : null;
    const hasValidDateRange =
      startDate instanceof Date &&
      endDate instanceof Date &&
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime());

    // Role-based filter: non-admin only sees their own leads (unless viewing unassigned pool)
    if (!isAdmin && activeTab !== 'unassigned') {
      conditions.push({
        '$or': [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }]
      });
    }

    // Tab-based filter
    if (activeTab === 'unassigned') {
      conditions.push({ 
        '$or': [
          { rep1: null },
          { rep1: '' }
        ]
      });
    } else if (activeTab === 'my') {
      if (isAdmin) {
        conditions.push({
          '$or': [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }]
        });
      }
    } else if (activeTab === 'open') {
      conditions.push({ status: { '$nin': closedStatuses } });
    }

    if (hasValidDateRange) {
      conditions.push({
        effective_sort_date: {
          '$gte': startDate.toISOString(),
          '$lte': endDate.toISOString()
        }
      });
    }

    // Rep filter - add to server query
    if (filters.rep1 && filters.rep1 !== 'all') {
      if (repScope === 'primary') {
        conditions.push({ rep1: filters.rep1 });
      } else {
        conditions.push({
          '$or': [{ rep1: filters.rep1 }, { rep2: filters.rep1 }]
        });
      }
    }

    // Status filter - add to server query
    if (filters.status && filters.status !== 'all') {
      conditions.push({ status: filters.status });
    }

    // Source filter - add to server query
    if (filters.source && filters.source !== 'all') {
      conditions.push({ source: filters.source });
    }

    // Search filter - add to server query
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      conditions.push({
        '$or': [
          { full_name: { '$regex': searchLower, '$options': 'i' } },
          { phone: { '$regex': filters.search, '$options': 'i' } },
          { email: { '$regex': searchLower, '$options': 'i' } }
        ]
      });
    }

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0];
    return { '$and': conditions };
  };

  const { data: leads = [], isLoading, isFetching } = useQuery({
    queryKey: ['leads', limit, activeTab, userEmail, isAdmin, filters.rep1, filters.search, filters.status, filters.source, repScope, startDateParam, endDateParam],
    queryFn: () => {
      const query = buildQuery();
      return base44.entities.Lead.filter(query, '-effective_sort_date', limit);
    },
    enabled: !!effectiveUser,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  const hasMore = leads.length >= limit;
  const loadMoreRef = useRef(null);
  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setLimit(prev => prev + 100);
    }
  }, [hasMore, isFetching]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
  });

  const assignLeadsMutation = useMutation({
    mutationFn: async ({ leadIds, repEmail }) => {
      const repName = users.find(r => r.email === repEmail)?.full_name || repEmail;
      const assignerName = user?.full_name || 'מנהל';

      const processLead = async (leadId) => {
        const lead = leads.find(l => l.id === leadId);
        const leadName = lead?.full_name || '';

        // 1. Update lead (keep existing status)
        await base44.entities.Lead.update(leadId, {
          rep1: repEmail,
          pending_rep_email: null,
          first_action_at: new Date().toISOString()
        });

        // 2. Mark open assignment tasks as completed
        const existingTasks = await base44.entities.SalesTask.filter({ lead_id: leadId });
        const openAssignmentTasks = existingTasks.filter(t =>
          t.task_status === 'not_completed' && t.task_type === 'assignment'
        );

        if (openAssignmentTasks.length > 0) {
          await Promise.all(openAssignmentTasks.map(t =>
            base44.entities.SalesTask.update(t.id, {
              task_status: 'completed',
              rep1: repEmail,
              summary: `${assignerName} שייך את הליד לנציג ${repName}`,
            })
          ));
        } else {
          await base44.entities.SalesTask.create({
            lead_id: leadId,
            rep1: repEmail,
            task_type: 'assignment',
            task_status: 'completed',
            summary: `${assignerName} שייך את הליד לנציג ${repName}`,
            work_start_date: new Date().toISOString(),
          });
        }

        // 3. Create call task for assigned rep (due in 3 hours)
        const dueDate = new Date();
        dueDate.setHours(dueDate.getHours() + 3);
        await base44.entities.SalesTask.create({
          lead_id: leadId,
          rep1: repEmail,
          task_type: 'call',
          task_status: 'not_completed',
          summary: `יש להתקשר ללקוח ${leadName}`,
          due_date: dueDate.toISOString(),
          work_start_date: new Date().toISOString(),
          status: 'assigned',
        });
      };

      return Promise.all(leadIds.map(processLead));
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['leads']);
      setSelectedLeads([]);
      setAssigningRep('');
    },
  });

  // All filtering is now server-side
  const filteredLeads = leads;


  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedLeads(filteredLeads.map(l => l.id));
    } else {
      setSelectedLeads([]);
    }
  };

  const handleSelectLead = (leadId, checked) => {
    if (checked) {
      setSelectedLeads(prev => [...prev, leadId]);
    } else {
      setSelectedLeads(prev => prev.filter(id => id !== leadId));
    }
  };

  const handleBulkAssign = () => {
    if (selectedLeads.length > 0 && assigningRep) {
      assignLeadsMutation.mutate({ leadIds: selectedLeads, repEmail: assigningRep });
    }
  };

  const salesReps = users.filter(u => u.role === 'user' || u.role === 'admin');
  const { toast } = useToast();

  const handleClickToCall = async (phone, leadId) => {
    try {
      toast({ title: "מתחיל שיחה...", description: phone });
      await base44.functions.invoke('clickToCall', { customerPhone: phone, leadId });
      toast({ title: "השיחה התחילה בהצלחה" });
    } catch (err) {
      toast({ title: "שגיאה בהתחלת שיחה", description: err?.response?.data?.error || err.message, variant: "destructive" });
    }
  };

  const columns = [
    {
      header: () => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={selectedLeads.length === filteredLeads.length && filteredLeads.length > 0}
            onCheckedChange={handleSelectAll}
          />
        </div>
      ),
      accessor: 'select',
      align: 'center',
      headerClassName: "[&:has([role=checkbox])]:!px-4",
      cellClassName: "[&:has([role=checkbox])]:!pr-4 [&:has([role=checkbox])]:!pl-4",
      render: (row) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={selectedLeads.includes(row.id)}
            onCheckedChange={(checked) => handleSelectLead(row.id, checked)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ),
      width: '40px'
    },
    {
      header: 'לקוח',
      accessor: 'full_name',
      width: '260px',
      render: (row) => {
        const formatPhone = (p) => {
          if (!p) return '';
          const cleaned = p.replace(/\D/g, '');
          if (cleaned.length === 10) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
          }
          return p;
        };
        return (
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{row.full_name}</p>
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm text-muted-foreground whitespace-nowrap" dir="ltr">{formatPhone(row.phone)}</p>
              {row.phone && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleClickToCall(row.phone, row.id); }}
                  className="h-6 w-6 rounded-full bg-green-100 hover:bg-green-200 flex items-center justify-center transition-colors flex-shrink-0"
                  title="התקשר"
                >
                  <Phone className="h-3.5 w-3.5 text-green-700" />
                </button>
              )}
            </div>
            {row.unique_id && <p className="text-xs text-muted-foreground/70 mt-0.5">ID: {row.unique_id}</p>}
          </div>
        );
      }
    },
    {
      header: 'סטטוס',
      accessor: 'status',
      render: (row) => <StatusBadge status={row.status} />,
      width: '112px'
    },
    {
      header: 'שם מודעה',
      accessor: 'facebook_ad_name',
      render: (row) => {
        const adName = row.facebook_ad_name;
        if (!adName) return <span className="text-muted-foreground/40 text-sm">-</span>;
        return <span className="text-sm text-foreground/80 line-clamp-2">{adName}</span>;
      },
      width: '150px'
    },
    {
      header: 'SLA',
      accessor: 'sla_status',
      render: (row) => {
        if (!row.created_date || row.first_action_at) return <span className="text-xs text-muted-foreground/70">טופל</span>;
        
        const now = new Date();
        const created = new Date(row.created_date + (row.created_date.includes('Z') ? '' : 'Z'));
        const diffMinutes = Math.floor((now - created) / 1000 / 60);
        
        let color = 'text-green-600';
        if (diffMinutes > SLA_THRESHOLDS.AMBER_MAX_MINUTES) color = 'text-red-600';
        else if (diffMinutes > SLA_THRESHOLDS.GREEN_MAX_MINUTES) color = 'text-amber-600';
        
        if (diffMinutes < 60) {
          return <span className={`text-sm font-medium ${color}`}>{diffMinutes === 1 ? 'דקה אחת' : `${diffMinutes} דקות`}</span>;
        } else if (diffMinutes < 1440) {
          const hours = Math.floor(diffMinutes / 60);
          const mins = diffMinutes % 60;
          const hoursText = hours === 1 ? 'שעה אחת' : `${hours} שעות`;
          if (mins === 0) return <span className={`text-sm font-medium ${color}`}>{hoursText}</span>;
          const minsText = mins === 1 ? 'דקה' : `${mins} דקות`;
          return <span className={`text-sm font-medium ${color}`}>{hoursText} ו-{minsText}</span>;
        } else {
          const days = Math.floor(diffMinutes / 1440);
          const hours = Math.floor((diffMinutes % 1440) / 60);
          const daysText = days === 1 ? 'יום אחד' : `${days} ימים`;
          if (hours === 0) return <span className={`text-sm font-medium ${color}`}>{daysText}</span>;
          const hoursText = hours === 1 ? 'שעה' : `${hours} שעות`;
          return <span className={`text-sm font-medium ${color}`}>{daysText} ו-{hoursText}</span>;
        }
      },
      width: '128px'
    },
    {
      header: 'מקור',
      accessor: 'source',
      render: (row) => {
        const source = row.source;
        const utmSource = row.utm_source;
        if (!source && !utmSource) {
          return <span className="text-muted-foreground/70 text-xs">-</span>;
        }
        return (
          <div className="text-xs leading-relaxed">
            <span className="font-medium">{SOURCE_LABELS[source] || source || '-'}</span>
            {utmSource && <p className="text-muted-foreground">{utmSource}</p>}
          </div>
        );
      },
      width: '110px'
    },
    {
      header: 'נציג',
      accessor: 'rep1',
      render: (row) => {
        // Show pending_rep_email if rep1 is not assigned
        if (!row.rep1 && row.pending_rep_email) {
          return (
            <span className="text-amber-600 flex items-center gap-1 text-sm">
              <AlertCircle className="h-4 w-4" />
              ממתין: {row.pending_rep_email}
            </span>
          );
        }
        if (!row.rep1 || row.rep1 === '') {
          return (
            <span className="text-amber-600 flex items-center gap-1 text-sm">
              <AlertCircle className="h-4 w-4" />
              לא משויך
            </span>
          );
        }
        const rep = users.find(u => u.email === row.rep1);
        const displayUser = rep || { email: row.rep1, full_name: row.rep1.split('@')[0] };
        return (
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar user={displayUser} size="sm" />
            <span className="text-sm truncate">{displayUser.full_name}</span>
          </div>
        );
      },
      width: '190px'
    },
    {
      header: 'תאריך',
      accessor: 'created_date',
      render: (row) => {
        const dateStr = row.created_date ? (row.created_date.includes('Z') ? row.created_date : row.created_date + 'Z') : new Date().toISOString();
        return (
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            <div>{formatInTimeZone(new Date(dateStr), 'Asia/Jerusalem', 'dd/MM/yyyy')}</div>
            <div className="text-xs">{formatInTimeZone(new Date(dateStr), 'Asia/Jerusalem', 'HH:mm')}</div>
          </div>
        );
      },
      width: '110px'
    },
    {
      header: 'פעולות',
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
          <QuickActions 
            type="lead" 
            data={row}
            hideContactButtons={true}
            onView={() => navigate(createPageUrl('LeadDetails') + `?id=${row.id}`)}
          />
        </div>
      ),
      width: '72px'
    }
  ];

  const handleFilterChange = (key, value) => {
    setLimit(100);
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setLimit(100);
    setFilters({ search: '', status: 'all', source: 'all', rep1: 'all' });
  };

  // Use counters from LeadCounter entity instead of counting loaded leads
  const getLeadCounterValue = (key) => {
    if (isAdmin) {
      const c = leadCounters.find(c => c.counter_key === key && !c.rep_email);
      return c?.count || 0;
    } else {
      const c = leadCounters.find(c => c.counter_key === key && c.rep_email === userEmail);
      return c?.count || 0;
    }
  };

  const totalLeadCount = getLeadCounterValue('total');
  const unassignedCount = leadCounters.find(c => c.counter_key === 'unassigned' && (!c.rep_email || c.rep_email === ''))?.count || 0;
  const myLeadsCount = isAdmin
    ? leadCounters.find(c => c.counter_key === 'total' && c.rep_email === userEmail)?.count || 0
    : getLeadCounterValue('total');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">לידים</h1>
          <p className="text-sm text-muted-foreground mt-1">ניהול לידים ומעקב אחרי הזדמנויות מכירה</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setShowImportFromSheets(true)}
          >
            <FileSpreadsheet className="h-4 w-4 me-2" />
            ייבא מ-Sheets
          </Button>
          <Link to={createPageUrl('NewLead')}>
            <Button>
              <Plus className="h-4 w-4 me-2" />
              ליד חדש
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Select + Bulk Assignment Bar */}
      {isAdmin && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground">בחירה מהירה:</span>
              {[10, 20, 30].map((count) => (
                <Button
                  key={count}
                  variant={selectedLeads.length === count ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    const ids = filteredLeads.slice(0, count).map(l => l.id);
                    setSelectedLeads(ids);
                  }}
                >
                  {count} אחרונים
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedLeads([])}
                disabled={selectedLeads.length === 0}
              >
                נקה בחירה
              </Button>
              {selectedLeads.length > 0 && (
                <span className="font-bold text-primary bg-primary/10 px-3 py-1 rounded-full text-sm">
                  {selectedLeads.length} נבחרו
                </span>
              )}
            </div>
            {selectedLeads.length > 0 && (
              <div className="flex items-center gap-3">
                <Select value={assigningRep} onValueChange={setAssigningRep}>
                  <SelectTrigger className="w-48 h-10">
                    <SelectValue placeholder="בחר נציג" />
                  </SelectTrigger>
                  <SelectContent>
                    {salesReps.map(rep => (
                      <SelectItem key={rep.id} value={rep.email}>
                        {rep.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleBulkAssign}
                  disabled={!assigningRep || assignLeadsMutation.isPending}
                  className="h-10"
                >
                  <UserPlus className="h-4 w-4 me-2" />
                  שייך לנציג
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dashboard-style Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isAdmin && (
          <div
            onClick={() => setActiveTab('unassigned')}
            className={`
              relative p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2
              ${activeTab === 'unassigned' 
                ? 'border-primary bg-primary/5 text-primary shadow-sm' 
                : 'border-border/50 bg-card hover:border-primary/20 hover:bg-muted/50 text-muted-foreground shadow-card'
              }
            `}
          >
            <span className="text-sm font-medium">לא משויכים</span>
            <span className={`text-2xl font-bold ${activeTab === 'unassigned' ? 'text-primary' : 'text-foreground'}`}>
              {unassignedCount}
            </span>
            {unassignedCount > 0 && (
              <span className="absolute top-3 left-3 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
            )}
          </div>
        )}

        {/* 2. Open */}
        <div
          onClick={() => setActiveTab('open')}
          className={`
            p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2
            ${activeTab === 'open' 
              ? 'border-primary bg-primary/5 text-primary shadow-sm' 
              : 'border-border/50 bg-card hover:border-primary/20 hover:bg-muted/50 text-muted-foreground shadow-card'
            }
          `}
        >
          <span className="text-sm font-medium">פתוחים</span>
          <span className="text-xs text-muted-foreground/70 mt-1">פעילים</span>
        </div>

        {/* 3. My Leads */}
        <div
          onClick={() => setActiveTab('my')}
          className={`
            p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2
            ${activeTab === 'my' 
              ? 'border-primary bg-primary/5 text-primary shadow-sm' 
              : 'border-border/50 bg-card hover:border-primary/20 hover:bg-muted/50 text-muted-foreground shadow-card'
            }
          `}
        >
          <span className="text-sm font-medium">הלידים שלי</span>
          <span className={`text-2xl font-bold ${activeTab === 'my' ? 'text-primary' : 'text-foreground'}`}>
            {myLeadsCount}
          </span>
        </div>

        {/* 4. All Leads (Admin only) */}
        {isAdmin && (
          <div
            onClick={() => setActiveTab('all')}
            className={`
              p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2
              ${activeTab === 'all' 
                ? 'border-primary bg-primary/5 text-primary shadow-sm' 
                : 'border-border/50 bg-card hover:border-primary/20 hover:bg-muted/50 text-muted-foreground shadow-card'
              }
            `}
          >
            <span className="text-sm font-medium">כל הלידים</span>
            <span className={`text-2xl font-bold ${activeTab === 'all' ? 'text-primary' : 'text-foreground'}`}>
              {totalLeadCount}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <FilterBar
          filters={filterOptions}
          values={filters}
          onChange={handleFilterChange}
          onClear={clearFilters}
          searchPlaceholder="חפש לפי שם, טלפון או אימייל..."
        />
        
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Select value={filters.rep1} onValueChange={(value) => handleFilterChange('rep1', value)}>
              <SelectTrigger className="w-48 h-9 bg-card border-border">
                <SelectValue placeholder="נציג מטפל" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הנציגים</SelectItem>
                {salesReps.map(rep => (
                  <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <ResponsiveLeadsTable
        columns={columns}
        data={filteredLeads}
        isLoading={isLoading}
        selectedIds={selectedLeads}
        users={users}
        onToggleSelect={(row, checked) => handleSelectLead(row.id, checked)}
        onOpenLead={(row) => navigate(createPageUrl('LeadDetails') + `?id=${row.id}`)}
        onClickToCall={handleClickToCall}
      />

      {/* Infinite scroll sentinel */}
      <div ref={loadMoreRef} className="h-1" />
      {isFetching && !isLoading && (
        <div className="flex justify-center py-3">
          <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Import from Sheets Dialog */}
      <ImportFromSheets
        isOpen={showImportFromSheets}
        onClose={() => setShowImportFromSheets(false)}
      />
    </div>
  );
}