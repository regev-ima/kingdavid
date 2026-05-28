import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import ResponsiveLeadsTable from '@/components/lead/ResponsiveLeadsTable';
import { useLeadModal } from '@/components/lead/LeadModalContext';
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
import { Plus, AlertCircle, UserPlus, FileSpreadsheet, Phone, Users, FileText, ShoppingCart, MessageCircle, Calendar as CalendarIcon, Filter, X as XIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { startOfDay, endOfDay, startOfWeek, startOfMonth } from '@/lib/safe-date-fns';
import { format } from '@/lib/safe-date-fns';
import CompleteTaskDialog from '@/components/sales/CompleteTaskDialog';
import { useCustomStatuses } from '@/hooks/useCustomStatuses';
import { useToast } from "@/components/ui/use-toast";
import { formatInTimeZone, parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import ImportFromSheets from '@/components/lead/ImportFromSheets';
import UserAvatar from '@/components/shared/UserAvatar';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, SOURCE_LABELS, CLOSED_STATUSES, SLA_THRESHOLDS } from '@/constants/leadOptions';
import { useNavigate } from 'react-router-dom';
import { canAccessSalesWorkspace, isFactoryUser } from '@/components/shared/rbac';
import { getLeadSlaAnchor, isReturningLead, isLeadHandled } from '@/utils/leadStatus';
import { isPhoneShapedQuery } from '@/utils/phoneUtils';

// filterOptions for the source filter is static. The status filter is built
// inside the component because admin-added custom statuses (per-browser
// localStorage) need to show up alongside the built-in list.
const sourceFilterOption = { key: 'source', label: 'מקור', options: LEAD_SOURCE_OPTIONS };

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
  // Date-range filter for the leads page. Initialized from ?startDate/?endDate
  // (used by Dashboard drilldowns) so existing deep-links keep working; once
  // the user picks a preset/range below, this becomes the source of truth.
  const initialFrom = startDateParam ? new Date(startDateParam) : null;
  const initialTo = endDateParam ? new Date(endDateParam) : null;
  const initialDateRange =
    initialFrom && !Number.isNaN(initialFrom.getTime()) &&
    initialTo && !Number.isNaN(initialTo.getTime())
      ? { from: initialFrom, to: initialTo }
      : undefined;
  const [dateRange, setDateRange] = useState(initialDateRange);
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [assigningRep, setAssigningRep] = useState('');
  const [showImportFromSheets, setShowImportFromSheets] = useState(false);
  const [limit, setLimit] = useState(100);
  const { customStatuses: customStatusesForFilter } = useCustomStatuses();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();
  // Open a lead as a popup over this list (no navigation); keep the last
  // opened row highlighted after it closes.
  const { openLead, lastOpenedLeadId } = useLeadModal();

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

  const effectiveUser = getEffectiveUser(user);
  const isAdmin = effectiveUser?.role === 'admin';
  const userEmail = effectiveUser?.email;

  // Live KPI counts. Previously the strip read from the cached `lead_counters`
  // table, but that cache had no DB trigger keeping it in sync — values drifted
  // (e.g. "הלידים שלי: 3" while the table actually showed 5). This runs four
  // server-side `count: 'exact', head: true` queries in parallel, ~150 ms total
  // even at 100k+ rows. Same pattern SalesTasks moved to in #76.
  const { data: kpiCounts = { total: 0, my: 0, open: 0, unassigned: 0 } } = useQuery({
    queryKey: ['leadsKpiCounts', isAdmin, userEmail],
    enabled: !!effectiveUser && !!userEmail,
    staleTime: 60_000,
    queryFn: async () => {
      const myFilter = {
        '$or': [
          { rep1: userEmail },
          { rep2: userEmail },
          { pending_rep_email: userEmail },
        ],
      };
      const unassignedFilter = { '$or': [{ rep1: null }, { rep1: '' }] };
      const openFilter = { status: { '$nin': CLOSED_STATUSES } };
      const myOpenFilter = { '$and': [myFilter, openFilter] };

      const [total, my, open, unassigned] = await Promise.all([
        isAdmin ? base44.entities.Lead.count({}) : base44.entities.Lead.count(myFilter),
        base44.entities.Lead.count(myFilter),
        isAdmin ? base44.entities.Lead.count(openFilter) : base44.entities.Lead.count(myOpenFilter),
        base44.entities.Lead.count(unassignedFilter),
      ]);
      return { total, my, open, unassigned };
    },
  });

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
    const startDate = dateRange?.from instanceof Date ? dateRange.from : null;
    const endDate = dateRange?.to instanceof Date ? dateRange.to : null;
    const hasValidDateRange =
      startDate &&
      endDate &&
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

  const fromIso = dateRange?.from ? new Date(dateRange.from).toISOString() : '';
  const toIso = dateRange?.to ? new Date(dateRange.to).toISOString() : '';

  const { data: leads = [], isLoading, isFetching } = useQuery({
    queryKey: ['leads', limit, activeTab, userEmail, isAdmin, filters.rep1, filters.search, filters.status, filters.source, repScope, fromIso, toIso],
    queryFn: () => {
      const query = buildQuery();
      return base44.entities.Lead.filter(query, '-effective_sort_date', limit);
    },
    enabled: !!effectiveUser,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  // Server-side count of every lead matching the current filter combo. The
  // visible `leads` array is capped at `limit`, so without this the badge
  // would lie ("מציג 100" when 16k actually match). Same query shape; just
  // returns the total rather than the rows.
  const { data: filteredCount = null } = useQuery({
    queryKey: ['leadsCount', activeTab, userEmail, isAdmin, filters.rep1, filters.search, filters.status, filters.source, repScope, fromIso, toIso],
    queryFn: () => base44.entities.Lead.count(buildQuery()),
    enabled: !!effectiveUser,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  // Count of "new" leads within the selected date range. Uses
  // effective_sort_date so a returning lead (פניה חוזרת) whose latest
  // activity falls in the range is counted as a new lead for volume
  // purposes — a re-contact is treated as a new lead. When no range is
  // selected, this is just the total lead count.
  const { data: newLeadsCount = null } = useQuery({
    queryKey: ['newLeadsCount', fromIso, toIso, isAdmin, userEmail],
    queryFn: () => {
      const conditions = [];
      if (!isAdmin) {
        conditions.push({
          '$or': [{ rep1: userEmail }, { rep2: userEmail }, { pending_rep_email: userEmail }],
        });
      }
      if (fromIso && toIso) {
        conditions.push({ effective_sort_date: { '$gte': fromIso, '$lte': toIso } });
      }
      const query = conditions.length === 0
        ? {}
        : conditions.length === 1 ? conditions[0] : { '$and': conditions };
      return base44.entities.Lead.count(query);
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

  // Fetch the open task per loaded lead so we can show next-action info
  // and re-sort by overdue/today first. Limited to lead ids we already
  // have in memory (server-side leads query is paginated), so the
  // additional request stays small.
  const leadIds = React.useMemo(() => leads.map((l) => l.id).filter(Boolean), [leads]);
  const { data: leadActiveTasks = [] } = useQuery({
    queryKey: ['leads-active-tasks', leadIds.join(',')],
    queryFn: async () => {
      if (leadIds.length === 0) return [];
      return base44.entities.SalesTask.filter(
        { lead_id: { '$in': leadIds }, task_status: 'not_completed' },
        'due_date',
        leadIds.length * 5, // a few active tasks per lead at most
      );
    },
    enabled: leadIds.length > 0,
    staleTime: 30000,
  });

  // Keep only the earliest active task per lead (= "next action").
  const nextActiveTaskByLead = React.useMemo(() => {
    const map = new Map();
    for (const t of leadActiveTasks) {
      if (!t?.lead_id) continue;
      const existing = map.get(t.lead_id);
      if (!existing) { map.set(t.lead_id, t); continue; }
      const a = t.due_date ? new Date(t.due_date).getTime() : Infinity;
      const b = existing.due_date ? new Date(existing.due_date).getTime() : Infinity;
      if (a < b) map.set(t.lead_id, t);
    }
    return map;
  }, [leadActiveTasks]);

  // Re-sort the loaded leads so overdue tasks bubble up. Within each
  // bucket, earlier due dates win.
  const filteredLeads = React.useMemo(() => {
    const bucketOf = (lead) => {
      const t = nextActiveTaskByLead.get(lead.id);
      if (!t?.due_date) return 3; // no task → bottom bucket
      const due = new Date(t.due_date).getTime();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayEnd = new Date(todayStart.getTime() + dayMs);
      if (due < todayStart.getTime()) return 0; // overdue
      if (due < todayEnd.getTime()) return 1;   // today
      return 2;                                  // future
    };
    return [...leads].sort((a, b) => {
      const ba = bucketOf(a);
      const bb = bucketOf(b);
      if (ba !== bb) return ba - bb;
      const ta = nextActiveTaskByLead.get(a.id);
      const tb = nextActiveTaskByLead.get(b.id);
      if (ta?.due_date && tb?.due_date) {
        return new Date(ta.due_date).getTime() - new Date(tb.due_date).getTime();
      }
      return 0;
    });
  }, [leads, nextActiveTaskByLead]);

  // Drives the "מה קרה?" dialog after the rep clicks a quick action.
  const [completingTask, setCompletingTask] = React.useState(null);


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
        const returning = isReturningLead(row);
        const createdAt = parseDbTimestamp(row.created_date);
        const returnedAt = parseDbTimestamp(row.effective_sort_date);
        const returningTooltip = returning && createdAt && returnedAt
          ? `נוצר ${formatInTimeZone(createdAt, 'Asia/Jerusalem', 'dd/MM/yyyy')} · חזר ${formatInTimeZone(returnedAt, 'Asia/Jerusalem', 'dd/MM/yyyy')}`
          : '';
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{row.full_name}</p>
              {returning && (
                <span
                  title={returningTooltip}
                  className="inline-flex items-center gap-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0"
                >
                  🔁 פניה חוזרת
                </span>
              )}
            </div>
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
      render: (row) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge status={row.status} />
          {(row.source === 'website' || (Array.isArray(row.tags) && row.tags.includes('אתר'))) && (
            <span
              className="inline-flex items-center rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-semibold px-1.5 py-0.5"
              title={row.source_form || 'הגיע מהאתר'}
            >
              אתר
            </span>
          )}
        </div>
      ),
      width: '130px'
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
        // A returning lead's SLA timer restarts from the latest touch
        // (effective_sort_date), not the original created_date — so a
        // 528-day-old lead that re-submitted this morning shows minutes,
        // not days. isLeadHandled honors the same anchor so a lead that
        // came back AFTER being handled stops showing "טופל".
        if (isLeadHandled(row)) return <span className="text-xs text-muted-foreground/70">טופל</span>;
        const anchor = getLeadSlaAnchor(row);
        if (!anchor) return <span className="text-xs text-muted-foreground/70">-</span>;

        const now = new Date();
        const diffMinutes = Math.floor((now - anchor) / 1000 / 60);

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
          const pendingRep = users.find(u => u.email === row.pending_rep_email);
          const pendingName = pendingRep?.full_name || row.pending_rep_email;
          return (
            <span className="text-amber-600 flex items-center gap-1 text-sm">
              <AlertCircle className="h-4 w-4" />
              ממתין: {pendingName}
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
        const displayUser = rep || { email: row.rep1, full_name: row.rep1 };
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
      header: 'משימה הבאה',
      accessor: 'next_active_task',
      width: '230px',
      render: (row) => {
        const task = nextActiveTaskByLead.get(row.id);
        if (!task) {
          return <span className="text-xs text-muted-foreground/70">—</span>;
        }
        const TYPE_META = {
          call: { Icon: Phone, label: 'שיחה', color: 'text-blue-600' },
          meeting: { Icon: Users, label: 'פגישה', color: 'text-amber-600' },
          quote_preparation: { Icon: FileText, label: 'הצעת מחיר', color: 'text-primary' },
          close_order: { Icon: ShoppingCart, label: 'סגירת הזמנה', color: 'text-emerald-600' },
          whatsapp: { Icon: MessageCircle, label: 'וואטסאפ', color: 'text-green-600' },
        };
        const meta = TYPE_META[task.task_type] || { Icon: Phone, label: task.task_type, color: 'text-muted-foreground' };
        const due = task.due_date ? new Date(task.due_date) : null;
        const now = new Date();
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const todayEnd = new Date(todayStart.getTime() + 86400000);
        const overdueDays = due && due.getTime() < todayStart.getTime()
          ? Math.floor((todayStart.getTime() - due.getTime()) / 86400000)
          : 0;
        const isToday = due && due.getTime() >= todayStart.getTime() && due.getTime() < todayEnd.getTime();
        let timeLabel = '—';
        if (due) {
          if (overdueDays > 0) timeLabel = `בפיגור ${overdueDays} ימים`;
          else if (isToday) timeLabel = `היום ${formatInTimeZone(due, 'Asia/Jerusalem', 'HH:mm')}`;
          else timeLabel = formatInTimeZone(due, 'Asia/Jerusalem', 'dd/MM HH:mm');
        }
        const handleQuickComplete = (e) => {
          e.stopPropagation();
          setCompletingTask({ ...task, rep1: task.rep1 || row.rep1, rep2: task.rep2 || row.rep2 });
        };
        return (
          <div onClick={(e) => e.stopPropagation()} className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm">
              <meta.Icon className={`h-3.5 w-3.5 ${meta.color}`} />
              <span className="font-medium">{meta.label}</span>
            </div>
            <div className={`text-xs font-medium whitespace-nowrap ${
              overdueDays > 0 ? 'text-red-600' : isToday ? 'text-amber-600' : 'text-muted-foreground'
            }`}>
              {timeLabel}
            </div>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={handleQuickComplete}>
              סיים משימה
            </Button>
          </div>
        );
      },
    },
    {
      header: 'תאריך',
      accessor: 'created_date',
      render: (row) => {
        const d = parseDbTimestamp(row.created_date);
        if (!d) return <span className="text-sm text-muted-foreground">-</span>;
        try {
          return (
            <div className="text-sm text-muted-foreground whitespace-nowrap">
              <div>{formatInTimeZone(d, 'Asia/Jerusalem', 'dd/MM/yyyy')}</div>
              <div className="text-xs">{formatInTimeZone(d, 'Asia/Jerusalem', 'HH:mm')}</div>
            </div>
          );
        } catch { return <span className="text-sm text-muted-foreground">-</span>; }
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
            onView={() => openLead(row.id)}
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

  const handleDatePreset = (preset) => {
    setLimit(100);
    const today = new Date();
    switch (preset) {
      case 'today':
        setDateRange({ from: startOfDay(today), to: endOfDay(today) });
        break;
      case 'week':
        setDateRange({ from: startOfWeek(today, { weekStartsOn: 0 }), to: endOfDay(today) });
        break;
      case 'month':
        setDateRange({ from: startOfMonth(today), to: endOfDay(today) });
        break;
      case 'clear':
      default:
        setDateRange(undefined);
    }
  };

  const handleDateRangeSelect = (range) => {
    setLimit(100);
    if (!range?.from) {
      setDateRange(undefined);
      return;
    }
    setDateRange({
      from: startOfDay(range.from),
      to: endOfDay(range.to || range.from),
    });
  };

  const totalLeadCount = kpiCounts.total;
  const myLeadsCount = kpiCounts.my;
  const openLeadsCount = kpiCounts.open;
  const unassignedCount = kpiCounts.unassigned;

  // Six-figure totals need the thousands separator or they read as
  // "1542" instead of "1,542" — the per-tile <span>s used to interpolate
  // the raw number, so 106645 rendered as "106645". toLocaleString gives
  // RTL-safe grouping ("106,645") which scans much faster in a glance.
  const fmt = (n) => Number(n || 0).toLocaleString();

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

      {/* Date-range filter — drives the new-leads tile and filters the table */}
      <div className="flex flex-wrap items-center gap-2" dir="rtl">
        <span className="text-sm font-medium text-muted-foreground me-1">סינון לפי תאריך:</span>
        <Button
          variant={(() => {
            if (!dateRange?.from || !dateRange?.to) return 'outline';
            const today = new Date();
            return dateRange.from.toDateString() === startOfDay(today).toDateString()
              && dateRange.to.toDateString() === endOfDay(today).toDateString()
              ? 'default' : 'outline';
          })()}
          size="sm"
          onClick={() => handleDatePreset('today')}
          className="h-8 text-xs"
        >
          היום
        </Button>
        <Button
          variant={(() => {
            if (!dateRange?.from || !dateRange?.to) return 'outline';
            const today = new Date();
            return dateRange.from.toDateString() === startOfWeek(today, { weekStartsOn: 0 }).toDateString()
              && dateRange.to.toDateString() === endOfDay(today).toDateString()
              ? 'default' : 'outline';
          })()}
          size="sm"
          onClick={() => handleDatePreset('week')}
          className="h-8 text-xs"
        >
          השבוע
        </Button>
        <Button
          variant={(() => {
            if (!dateRange?.from || !dateRange?.to) return 'outline';
            const today = new Date();
            return dateRange.from.toDateString() === startOfMonth(today).toDateString()
              && dateRange.to.toDateString() === endOfDay(today).toDateString()
              ? 'default' : 'outline';
          })()}
          size="sm"
          onClick={() => handleDatePreset('month')}
          className="h-8 text-xs"
        >
          החודש
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs font-normal" dir="rtl">
              <CalendarIcon className="me-2 h-4 w-4" />
              {dateRange?.from && dateRange?.to ? (
                <>
                  {format(dateRange.from, 'dd.MM.yy')}
                  {' - '}
                  {format(dateRange.to, 'dd.MM.yy')}
                </>
              ) : (
                <span>טווח תאריכים</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end" dir="rtl">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={handleDateRangeSelect}
              numberOfMonths={1}
            />
          </PopoverContent>
        </Popover>
        {dateRange?.from && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDatePreset('clear')}
            className="h-8 text-xs"
          >
            נקה תאריך
          </Button>
        )}
      </div>

      {/* Dashboard-style Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            <span className="text-sm font-medium whitespace-nowrap">לא משויכים</span>
            <span className={`text-2xl font-bold tabular-nums whitespace-nowrap ${activeTab === 'unassigned' ? 'text-primary' : 'text-foreground'}`}>
              {fmt(unassignedCount)}
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
          <span className="text-sm font-medium whitespace-nowrap">פתוחים</span>
          <span className={`text-2xl font-bold tabular-nums whitespace-nowrap ${activeTab === 'open' ? 'text-primary' : 'text-foreground'}`}>
            {fmt(openLeadsCount)}
          </span>
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
          <span className="text-sm font-medium whitespace-nowrap">הלידים שלי</span>
          <span className={`text-2xl font-bold tabular-nums whitespace-nowrap ${activeTab === 'my' ? 'text-primary' : 'text-foreground'}`}>
            {fmt(myLeadsCount)}
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
            <span className="text-sm font-medium whitespace-nowrap">כל הלידים</span>
            <span className={`text-2xl font-bold tabular-nums whitespace-nowrap ${activeTab === 'all' ? 'text-primary' : 'text-foreground'}`}>
              {fmt(totalLeadCount)}
            </span>
          </div>
        )}

        {/* 5. New leads in the selected date range */}
        <div
          className="p-4 rounded-xl border-2 border-emerald-100 bg-emerald-50/40 flex flex-col items-center justify-center gap-2"
        >
          <span className="text-sm font-medium text-muted-foreground">לידים חדשים</span>
          <span className="text-2xl font-bold text-emerald-700">
            {newLeadsCount === null ? '...' : Number(newLeadsCount).toLocaleString()}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {dateRange?.from && dateRange?.to
              ? `${format(dateRange.from, 'dd.MM.yy')} - ${format(dateRange.to, 'dd.MM.yy')}`
              : 'מאז ומעולם'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <FilterBar
          filters={[
            { key: 'status', label: 'סטטוס', options: [...LEAD_STATUS_OPTIONS, ...customStatusesForFilter] },
            sourceFilterOption,
            // Admins also get a rep dropdown inline — same row as status /
            // source instead of stranded on its own line below the bar,
            // which was forcing an extra scroll on smaller screens.
            ...(isAdmin
              ? [{
                  key: 'rep1',
                  label: 'נציג',
                  allLabel: 'כל הנציגים',
                  options: salesReps.map((rep) => ({ value: rep.email, label: rep.full_name })),
                }]
              : []),
          ]}
          values={filters}
          onChange={handleFilterChange}
          onClear={clearFilters}
          searchPlaceholder="חפש לפי שם, טלפון או אימייל..."
        />
      </div>

      {/* Prominent "filter result" card. Shown whenever any filter is active
          or the user picked a non-default tab. Highlights the count of leads
          matching the current cut + the share-of-total — so a manager who
          filtered "status=new_lead, rep=שלמה" sees at a glance how big that
          slice is, both in absolute numbers and as a percentage of all
          leads. Active filter chips spell out the cut in plain Hebrew. */}
      {(filters.search || filters.status !== 'all' || filters.source !== 'all' || filters.rep1 !== 'all' || activeTab !== 'all') && (() => {
        const TAB_LABELS = { unassigned: 'לא משויכים', open: 'פתוחים', my: 'הלידים שלי', all: 'כל הלידים' };
        const statusLabel = filters.status !== 'all'
          ? (LEAD_STATUS_OPTIONS.find((s) => s.value === filters.status)?.label
             || customStatusesForFilter.find((s) => s.value === filters.status)?.label
             || filters.status)
          : null;
        const sourceLabel = filters.source !== 'all'
          ? (SOURCE_LABELS[filters.source] || filters.source)
          : null;
        const repLabel = filters.rep1 !== 'all'
          ? (salesReps.find((r) => r.email === filters.rep1)?.full_name || filters.rep1)
          : null;
        const chips = [
          activeTab !== 'all' && { key: 'tab', label: TAB_LABELS[activeTab] || activeTab, onClear: () => setActiveTab('all') },
          statusLabel && { key: 'status', label: `סטטוס: ${statusLabel}`, onClear: () => handleFilterChange('status', 'all') },
          sourceLabel && { key: 'source', label: `מקור: ${sourceLabel}`,  onClear: () => handleFilterChange('source', 'all') },
          repLabel    && { key: 'rep',    label: `נציג: ${repLabel}`,     onClear: () => handleFilterChange('rep1', 'all') },
          filters.search && { key: 'search', label: `חיפוש: "${filters.search}"`, onClear: () => handleFilterChange('search', '') },
        ].filter(Boolean);
        const pct = totalLeadCount > 0 && filteredCount != null
          ? Math.round((Number(filteredCount) / Number(totalLeadCount)) * 1000) / 10
          : null;
        return (
          <div className="flex flex-col gap-3 rounded-xl border-2 border-primary/30 bg-gradient-to-l from-primary/10 to-primary/5 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-primary">
                    <Filter className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-foreground">תוצאות הסינון</span>
                </div>
                <span className="text-3xl font-bold text-primary tabular-nums whitespace-nowrap">
                  {filteredCount === null ? '...' : fmt(filteredCount)}
                </span>
                {pct != null ? (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    ({pct}% מתוך {fmt(totalLeadCount)} לידים)
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {filteredCount === null
                  ? 'סופר...'
                  : `מציג ${fmt(leads.length)}${Number(filteredCount) > leads.length ? ' · גלול למטה לטעון עוד' : ''}`}
              </div>
            </div>
            {chips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onClear}
                    className="inline-flex items-center gap-1 rounded-full bg-background border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors"
                    title="הסר סינון"
                  >
                    {chip.label}
                    <XIcon className="h-3 w-3 opacity-60" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { clearFilters(); if (activeTab !== 'all') setActiveTab('all'); }}
                  className="text-[11px] font-medium text-primary hover:text-primary/80 px-2 py-1"
                >
                  נקה הכל
                </button>
              </div>
            ) : null}
          </div>
        );
      })()}

      {!isLoading && Number(filteredCount) === 0 && isPhoneShapedQuery(filters.search) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="text-sm text-foreground">
            לא נמצא ליד עם הטלפון <span className="font-semibold" dir="ltr">{filters.search}</span>.
          </div>
          <Link to={createPageUrl('NewLead') + `?phone=${encodeURIComponent(filters.search)}`}>
            <Button size="sm" className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              צור ליד חדש עם טלפון זה
            </Button>
          </Link>
        </div>
      )}

      <ResponsiveLeadsTable
        columns={columns}
        data={filteredLeads}
        isLoading={isLoading}
        selectedIds={selectedLeads}
        users={users}
        onToggleSelect={(row, checked) => handleSelectLead(row.id, checked)}
        onOpenLead={(row) => openLead(row.id)}
        highlightId={lastOpenedLeadId}
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

      {/* Complete-task dialog opened by the row's "סיים משימה" button */}
      <CompleteTaskDialog
        isOpen={!!completingTask}
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={() => queryClient.invalidateQueries({ queryKey: ['leads-active-tasks'] })}
      />
    </div>
  );
}