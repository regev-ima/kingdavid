import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Clock, Phone, MessageCircle, CheckCircle, FileText, Plus, FileSpreadsheet, Search, X, CheckCircle2, XCircle, Ban, List, AlertCircle, ArrowUpRight, Mail, Users, RefreshCw, ClipboardList, Paperclip, LayoutGrid, ChevronDown } from "lucide-react";
import { format, isValid, formatDistanceToNow, startOfDay, endOfDay } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';

const safeFormat = (dateStr, fmt) => {
  if (!dateStr) return '';
  let d;
  if (typeof dateStr === 'string') {
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, day, month, year, hour, minute] = match;
      d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`);
    } else {
      const matchDate = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (matchDate) {
        const [, day, month, year] = matchDate;
        d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      } else {
        d = new Date(dateStr);
      }
    }
  } else {
    d = dateStr;
  }
  return isValid(d) ? format(d, fmt) : dateStr;
};



import ImportSalesTasks from '@/components/lead/ImportSalesTasks';
import AddSalesTaskDialog from '@/components/task/AddSalesTaskDialog';
import EditSalesTaskDialog from '@/components/task/EditSalesTaskDialog';
import TaskDayView from '@/components/task/TaskDayView';
import TaskWeekView from '@/components/task/TaskWeekView';
import StatusBadge from '@/components/shared/StatusBadge';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import { buildLeadsById, canAccessSalesWorkspace, filterSalesTasksForUser, isAdmin as isAdminUser } from '@/components/shared/rbac';
import { compareSalesTasks, getTaskCounterMismatches, matchesSalesTaskTab, normalizeTaskStatus, parseSalesTaskDate, sortSalesTasks } from '@/components/shared/salesTaskWorkbench';
import { compareTasksByPriority, isAssignmentTask, isStaleOverdueTask, STALE_TASK_THRESHOLD_DAYS } from '@/lib/salesTaskWorkbench';
import { getRepDisplayName } from '@/lib/repDisplay';

export default function SalesTasks() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab');
  const [activeTab, setActiveTab] = useState(['today', 'overdue', 'upcoming', 'undated', 'not_completed', 'assignment', 'completed', 'not_done', 'cancelled', 'all'].includes(initialTab) ? initialTab : 'today');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('priority');
  const [dateFilter, setDateFilter] = useState('');
  const [showStale, setShowStale] = useState(false);
  const [showAssignmentTasks, setShowAssignmentTasks] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'day' | 'week'
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showEditTaskDialog, setShowEditTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [leadStatusFilter, setLeadStatusFilter] = useState('all');

  const initialTaskId = urlParams.get('id');

  const { data: initialTask } = useQuery({
    queryKey: ['initialTask', initialTaskId],
    queryFn: async () => {
      const taskRes = await base44.entities.SalesTask.filter({ id: initialTaskId });
      const task = taskRes[0];
      if (task && task.lead_id) {
        const leadRes = await base44.entities.Lead.filter({ id: task.lead_id });
        task.lead = leadRes[0];
      }
      return task || null;
    },
    enabled: !!initialTaskId,
  });

  useEffect(() => {
    if (initialTask && !editingTask && !showEditTaskDialog) {
      setEditingTask(initialTask);
      setShowEditTaskDialog(true);
    }
  }, [initialTask]);

  const [tasksPage, setTasksPage] = useState(0);
  const TASKS_PER_PAGE = 50;
  const canAccessSales = canAccessSalesWorkspace(effectiveUser);
  const isAdmin = isAdminUser(effectiveUser);
  const userEmail = effectiveUser?.email;

  // Effective rules:
  //   - non-admin reps never see assignment tasks anywhere on this page
  //   - admin sees them only on the dedicated "להקצות" tab, or when the
  //     "כלול X משימות שיוך" toggle is on
  //   - the toggle drives BOTH the counts and the list, so the badge on
  //     "היום" can't say 73 while the list renders 1 (the bug we just hit)
  // Counts ignore activeTab (they describe every bucket at once), so the
  // assignment tab itself doesn't bring assignment rows into the count.
  const includeAssignmentInCounts = isAdmin && showAssignmentTasks;
  const includeAssignmentInList = isAdmin && (showAssignmentTasks || activeTab === 'assignment');
  const applyUserScope = (q, { includeAssignment } = { includeAssignment: false }) => {
    if (!includeAssignment) q = q.neq('task_type', 'assignment');
    if (!isAdmin && userEmail) {
      q = q.or(`rep1.eq.${userEmail},rep2.eq.${userEmail},pending_rep_email.eq.${userEmail}`);
    }
    return q;
  };

  const { data: taskCounters = [] } = useQuery({
    queryKey: ['taskCounters'],
    queryFn: () => base44.entities.TaskCounter.list('-created_date', 200),
    enabled: canAccessSales,
  });

  // KPI counts come from server-side aggregation queries — much cheaper
  // than shipping every row to the browser. We had to do that briefly after
  // we removed the 500/200/100/100 hard caps to fix the truncated KPIs, but
  // it made initial load ~2s on an 8k-row table. Now: ~150 ms for all 8
  // counts in parallel, regardless of table size.
  //
  // Tab/date math is duplicated from getSalesTaskQueueBucket so the server
  // side computes the same buckets the client renders. Asia/Jerusalem is
  // implicit — `due_date` is timestamptz and `now()` boundaries are in the
  // same tz, so the comparison against startOfDay/endOfDay (browser local
  // time) matches the rep's day. Mismatches under DST are 1-hour-bounded.
  const today = new Date();
  const todayStartIso = startOfDay(today).toISOString();
  const todayEndIso = endOfDay(today).toISOString();
  // Cutoff for "stale" — applied to assignment tasks via created_date and
  // (in the legacy hint UI) regular tasks via due_date. Same threshold so
  // the toggle reads as one unified concept to the user.
  const staleCutoffIso = useMemo(() => {
    const c = new Date();
    c.setDate(c.getDate() - STALE_TASK_THRESHOLD_DAYS);
    return c.toISOString();
  }, []);

  const { data: counts = { total: 0, open: 0, completed: 0, today: 0, overdue: 0, upcoming: 0, undated: 0, completedToday: 0, assignmentOpen: 0, staleAssignmentHidden: 0 } } = useQuery({
    queryKey: ['salesTasks-counts', todayStartIso, todayEndIso, isAdmin ? 'admin' : userEmail || 'anon', includeAssignmentInCounts, showStale],
    enabled: canAccessSales,
    staleTime: 60_000,
    queryFn: async () => {
      const head = async (build) => {
        const { count, error } = await build(
          applyUserScope(base44.supabase.from('sales_tasks').select('*', { count: 'exact', head: true }), { includeAssignment: includeAssignmentInCounts }),
        );
        if (error) throw error;
        return count || 0;
      };
      // Assignment-tab badge needs its own count regardless of the
      // includeAssignmentInCounts toggle — the badge is the whole reason
      // an admin notices the queue exists. The stale filter applies here
      // too so the badge stays in sync with the list when showStale=false.
      const assignmentHead = async () => {
        if (!isAdmin) return 0;
        let q = base44.supabase
          .from('sales_tasks')
          .select('*', { count: 'exact', head: true })
          .eq('task_status', 'not_completed')
          .eq('task_type', 'assignment');
        if (!showStale) q = q.gte('created_date', staleCutoffIso);
        const { count, error } = await q;
        if (error) throw error;
        return count || 0;
      };
      // How many assignment tasks the stale filter is hiding right now —
      // surfaced in the toggle button so the admin knows what's parked.
      const staleAssignmentHiddenHead = async () => {
        if (!isAdmin || showStale) return 0;
        const { count, error } = await base44.supabase
          .from('sales_tasks')
          .select('*', { count: 'exact', head: true })
          .eq('task_status', 'not_completed')
          .eq('task_type', 'assignment')
          .lt('created_date', staleCutoffIso);
        if (error) throw error;
        return count || 0;
      };
      const [total, open, completed, todayCnt, overdue, upcoming, undated, completedToday, assignmentOpen, staleAssignmentHidden] = await Promise.all([
        head((q) => q),
        head((q) => q.eq('task_status', 'not_completed')),
        head((q) => q.eq('task_status', 'completed')),
        head((q) => q.eq('task_status', 'not_completed').gte('due_date', todayStartIso).lte('due_date', todayEndIso)),
        head((q) => q.eq('task_status', 'not_completed').lt('due_date', todayStartIso)),
        head((q) => q.eq('task_status', 'not_completed').gt('due_date', todayEndIso)),
        head((q) => q.eq('task_status', 'not_completed').is('due_date', null)),
        head((q) => q.eq('task_status', 'completed').gte('updated_date', todayStartIso).lte('updated_date', todayEndIso)),
        assignmentHead(),
        staleAssignmentHiddenHead(),
      ]);
      return { total, open, completed, today: todayCnt, overdue, upcoming, undated, completedToday, assignmentOpen, staleAssignmentHidden };
    },
  });

  // Per-active-tab paginated row fetch. We push the tab/status filter to the
  // server so we never download more than `TASKS_FETCH_LIMIT` rows for the
  // bucket the user is actually looking at. The previous full-fetch shipped
  // ~8k rows on every page load; this brings it down to ≤ 1000.
  const TASKS_FETCH_LIMIT = 1000;
  const { data: allSalesTasks = [], isLoading } = useQuery({
    queryKey: ['salesTasks-tab', activeTab, todayStartIso, todayEndIso, isAdmin ? 'admin' : userEmail || 'anon', includeAssignmentInList, showStale],
    enabled: canAccessSales,
    staleTime: 60_000,
    queryFn: async () => {
      let q = applyUserScope(base44.supabase.from('sales_tasks').select('*'), { includeAssignment: includeAssignmentInList });
      if (activeTab === 'today') {
        q = q.eq('task_status', 'not_completed').gte('due_date', todayStartIso).lte('due_date', todayEndIso);
      } else if (activeTab === 'overdue') {
        q = q.eq('task_status', 'not_completed').lt('due_date', todayStartIso);
      } else if (activeTab === 'upcoming') {
        q = q.eq('task_status', 'not_completed').gt('due_date', todayEndIso);
      } else if (activeTab === 'undated') {
        q = q.eq('task_status', 'not_completed').is('due_date', null);
      } else if (activeTab === 'not_completed') {
        q = q.eq('task_status', 'not_completed');
      } else if (activeTab === 'assignment') {
        q = q.eq('task_status', 'not_completed').eq('task_type', 'assignment');
        if (!showStale) q = q.gte('created_date', staleCutoffIso);
      } else if (['completed', 'not_done', 'cancelled'].includes(activeTab)) {
        q = q.eq('task_status', activeTab);
      }
      // 'all' falls through with no filter.

      // Sort: closed tabs by most-recently-touched. Open tabs by due_date —
      // ascending for forward-looking buckets (today/upcoming/not_completed),
      // but descending for overdue so the *most recent* misses come back
      // first. With 6k+ migration leftovers, ascending pulled only ancient
      // garbage and crowded out anything actionable.
      const recentlyTouched = ['completed', 'not_done', 'cancelled'].includes(activeTab);
      if (recentlyTouched) {
        q = q.order('updated_date', { ascending: false, nullsFirst: false });
      } else if (activeTab === 'overdue') {
        q = q.order('due_date', { ascending: false, nullsFirst: false });
      } else {
        q = q.order('due_date', { ascending: true, nullsFirst: false });
      }

      q = q.limit(TASKS_FETCH_LIMIT);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['sales-task-ownership-leads'],
    queryFn: async () => {
      let skip = 0;
      const leads = [];
      while (true) {
        const batch = await base44.entities.Lead.list('-created_date', 500, skip);
        leads.push(...batch);
        if (batch.length < 500) break;
        skip += 500;
      }
      return leads;
    },
    enabled: canAccessSales,
    staleTime: 60000,
  });

  // Fetch users for rep name display
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: canAccessSales,
  });

  const getRepName = (email) => getRepDisplayName(email, allUsers);

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const leadsById = useMemo(() => buildLeadsById(allLeads), [allLeads]);
  // Non-admin reps never see assignment tasks anywhere on this page —
  // those belong to the manager workflow. Stripping them at the
  // ownedTasks layer makes counts, toggles, and empty-state CTAs all
  // collapse to 0/hidden automatically for non-admins.
  const ownedTasks = useMemo(() => {
    const base = filterSalesTasksForUser(effectiveUser, allSalesTasks, leadsById);
    return isAdminUser(effectiveUser) ? base : base.filter((t) => !isAssignmentTask(t));
  }, [effectiveUser, allSalesTasks, leadsById]);

  // Counts of what the default-view filter is hiding so we can tell the user.
  const hiddenStaleCount = useMemo(
    () => ownedTasks.filter((t) => isStaleOverdueTask(t, now)).length,
    [ownedTasks, now],
  );
  // Server-side count — survives the toggle, since otherwise hiding
  // assignment tasks would also hide the only signal that they exist.
  const assignmentTaskCount = counts.assignmentOpen || 0;
  // When the active tab's entire bucket is assignment-only (e.g. today
  // is dominated by `assignment` tasks the rep filter hides), the list
  // looks empty and the rep doesn't know why. Surface this as a CTA in
  // the empty state.
  const assignmentInActiveTabCount = useMemo(
    () =>
      ownedTasks.filter(
        (t) => isAssignmentTask(t) && matchesSalesTaskTab(t, activeTab, now),
      ).length,
    [ownedTasks, activeTab, now],
  );

  // The list view drops legacy migration leftovers and the admin-only
  // assignment queue by default, since both flooded the rep's screen with
  // noise. Toggles below the filter bar bring them back. The "assignment"
  // tab always shows assignment tasks regardless of the toggle.
  const scopedTasks = useMemo(() => {
    let tasks = ownedTasks;
    if (!showStale) tasks = tasks.filter((t) => !isStaleOverdueTask(t, now));
    if (activeTab === 'assignment') {
      tasks = tasks.filter(isAssignmentTask);
    } else if (!showAssignmentTasks) {
      tasks = tasks.filter((t) => !isAssignmentTask(t));
    }
    return tasks;
  }, [ownedTasks, showStale, showAssignmentTasks, activeTab, now]);
  // (Used to call buildScopedTaskMetrics here. Now that KPIs come from the
  // server-side `counts` query, the metric arrays it produced were unused on
  // this page. Dropped to avoid the wasted computation on every rerender.)

  // Reset pagination when filters change
  useEffect(() => {
    setTasksPage(0);
  }, [activeTab, search, sortBy, dateFilter, leadStatusFilter, showStale, showAssignmentTasks]);

  // Assignment tab is admin-only. Bounce non-admins who land here via
  // a stale URL (?tab=assignment) back to the default view.
  useEffect(() => {
    if (!isAdmin && activeTab === 'assignment') setActiveTab('today');
  }, [isAdmin, activeTab]);

  // 2. Filter & sort tasks BEFORE enriching with lead data (no lead data needed here)
  const { totalFilteredCount, paginatedTasks } = useMemo(() => {
    let tasks = scopedTasks;
    tasks = tasks.filter((task) => matchesSalesTaskTab(task, activeTab, now));

    if (dateFilter) {
      const filterDate = new Date(dateFilter);
      const filterStart = new Date(filterDate.getFullYear(), filterDate.getMonth(), filterDate.getDate());
      const filterEnd = new Date(filterDate.getFullYear(), filterDate.getMonth(), filterDate.getDate(), 23, 59, 59);
      tasks = tasks.filter(t => {
        const d = parseSalesTaskDate(t.due_date);
        
        if (!d) return false;
        return d >= filterStart && d <= filterEnd;
      });
    }

    if (search) {
      const searchLower = search.toLowerCase();
      tasks = tasks.filter(t => t.summary?.toLowerCase().includes(searchLower));
    }

    tasks = sortSalesTasks(tasks, activeTab, now).sort((a, b) => {
      if (sortBy === 'priority') {
        return compareTasksByPriority(a, b, leadsById, now);
      } else if (sortBy === 'status') {
        return (a.task_status || '').localeCompare(b.task_status || '');
      } else if (sortBy === 'rep') {
        return (a.rep1 || '').localeCompare(b.rep1 || '');
      } else if (sortBy === 'created_date') {
        return new Date(b.created_date || 0) - new Date(a.created_date || 0);
      }
      return compareSalesTasks(a, b, activeTab, now);
    });

    const total = tasks.length;
    const paginated = tasks.slice(0, (tasksPage + 1) * TASKS_PER_PAGE);
    return { totalFilteredCount: total, paginatedTasks: paginated };
  }, [scopedTasks, activeTab, dateFilter, search, sortBy, tasksPage, now]);

  // 3. Fetch leads ONLY for the paginated (visible) tasks
  const paginatedTaskLeadIds = useMemo(() => 
    [...new Set(paginatedTasks.map(t => t.lead_id).filter(Boolean))],
    [paginatedTasks]
  );

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-paginated-tasks', paginatedTaskLeadIds.join(',')],
    queryFn: async () => {
      if (paginatedTaskLeadIds.length === 0) return [];
      const allLeads = [];
      const batchSize = 20;
      for (let i = 0; i < paginatedTaskLeadIds.length; i += batchSize) {
        const batch = paginatedTaskLeadIds.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(id => base44.entities.Lead.filter({ id }).then(res => res[0] || null).catch(() => null))
        );
        allLeads.push(...results.filter(Boolean));
      }
      return allLeads;
    },
    enabled: canAccessSales && paginatedTaskLeadIds.length > 0,
  });

  // 4. Enrich paginated tasks with lead data
  const enrichedPaginatedTasks = useMemo(() => 
    paginatedTasks.map(task => {
      const lead = leads.find(l => l.id === task.lead_id);
      return { ...task, lead };
    }),
    [paginatedTasks, leads]
  );

  // Re-apply search for lead-related fields on enriched data
  const finalVisibleTasks = (search 
    ? enrichedPaginatedTasks.filter(t =>
        t.lead?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        t.lead?.phone?.includes(search) ||
        t.summary?.toLowerCase().includes(search.toLowerCase())
      )
    : enrichedPaginatedTasks)
    .filter(t => {
      if (leadStatusFilter !== 'all') {
        const taskLeadStatus = t.status || t.lead?.status;
        if (taskLeadStatus !== leadStatusFilter) return false;
      }
      return true;
    });

  const hasMoreTasks = paginatedTasks.length < totalFilteredCount;

  // KPI numbers come straight from the server-side count query — no longer
  // capped by which rows happen to be loaded for the current tab. The
  // client-side scopedTaskMetrics is still computed (it powers things like
  // taskActionItems for the row-level UI), but the top strip uses `counts`.
  const totalCount = counts.total;
  const notCompletedCount = counts.open;
  const completedCount = counts.completed;
  const todayCount = counts.today;
  const overdueCount = counts.overdue;
  const upcomingCount = counts.upcoming;
  const undatedCount = counts.undated;
  // Compare the auth-side cached counters against the server-side counts.
  // The 5th-arg shape matches what scopedTaskMetrics.counts used to expose.
  const counterMismatches = useMemo(
    () => getTaskCounterMismatches(taskCounters, isAdmin, userEmail, counts),
    [taskCounters, isAdmin, userEmail, counts],
  );

  useEffect(() => {
    if (isAdmin && Object.keys(counterMismatches).length > 0) {
      console.warn('TaskCounter mismatch on SalesTasks', {
        userEmail,
        mismatches: counterMismatches,
      });
    }
  }, [counterMismatches, isAdmin, userEmail]);

  // Still needed for tab counts display
  const handleCall = async (phone) => {
    if (!phone) return;
    try {
      await base44.functions.invoke('clickToCall', { customerPhone: phone });
    } catch (error) {
      // Call initiation failed
    }
  };

  const handleWhatsApp = (phone) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/972${cleanPhone.startsWith('0') ? cleanPhone.slice(1) : cleanPhone}`, '_blank');
  };

  const handleOpenTaskDetails = (task) => {
    setEditingTask(task);
    setShowEditTaskDialog(true);
  };

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSales) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת למשימות מכירה</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* ===== HEADER ===== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-1 h-12 rounded-full bg-gradient-to-b from-primary to-primary/70 flex-shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">משימות מכירה</h1>
            <p className="text-sm text-muted-foreground/70 mt-0.5">ניהול מעקב וטיפול בלידים</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {/* View toggle: list ↔ day grid */}
          <div className="inline-flex h-9 rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 rounded-md px-3 transition-colors ${
                viewMode === 'list' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="h-3.5 w-3.5" /> רשימה
            </button>
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`flex items-center gap-1.5 rounded-md px-3 transition-colors ${
                viewMode === 'day' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> יום
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`flex items-center gap-1.5 rounded-md px-3 transition-colors ${
                viewMode === 'week' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" /> שבוע
            </button>
          </div>
          <Button
            onClick={() => setShowImportDialog(true)}
            variant="outline"
            size="sm"
            className="h-9 border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground gap-1.5"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span className="hidden sm:inline">ייבוא מ-Sheets</span>
          </Button>
          <Button
            onClick={() => setShowNewTaskDialog(true)}
            size="sm"
            className="h-9 gap-1.5"
          >
            <Plus className="h-4 w-4" />
            משימה חדשה
          </Button>
        </div>
      </div>

      {viewMode === 'day' ? (
        <TaskDayView
          effectiveUser={effectiveUser}
          isAdmin={isAdmin}
          onTaskClick={(task) => handleOpenTaskDetails(task)}
        />
      ) : viewMode === 'week' ? (
        <TaskWeekView
          effectiveUser={effectiveUser}
          isAdmin={isAdmin}
          onTaskClick={(task) => handleOpenTaskDetails(task)}
        />
      ) : (
      <>
      {/* ===== TABS - Primary strip + "more" overflow =====
          The KPI cards above this strip used to repeat the same numbers and
          fire the same setActiveTab() calls — pure redundancy. Tabs alone
          carry both the count and the filter affordance. Secondary statuses
          (upcoming / undated / completed / not_done / cancelled / all) live
          behind a "עוד" dropdown so daily-driver tabs stay legible. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList
          className="w-full h-auto p-1 gap-1 bg-muted/80 rounded-xl flex flex-row flex-nowrap overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <TabsTrigger value="today" className="group flex-shrink-0 whitespace-nowrap h-11 px-4 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
            <Calendar className="w-4 h-4 me-1.5 inline-block" /> היום
            <span className="ms-1.5 rounded-full px-2 py-0.5 text-xs font-bold leading-none bg-muted text-muted-foreground group-data-[state=active]:bg-white/25 group-data-[state=active]:text-white">{todayCount}</span>
          </TabsTrigger>
          <TabsTrigger value="overdue" className="group flex-shrink-0 whitespace-nowrap h-11 px-4 rounded-lg text-sm font-semibold text-muted-foreground hover:text-red-600 data-[state=active]:bg-red-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
            <AlertCircle className="w-4 h-4 me-1.5 inline-block" /> באיחור
            <span className="ms-1.5 rounded-full px-2 py-0.5 text-xs font-bold leading-none bg-muted text-muted-foreground group-data-[state=active]:bg-white/25 group-data-[state=active]:text-white">{overdueCount}</span>
          </TabsTrigger>
          <TabsTrigger value="not_completed" className="group flex-shrink-0 whitespace-nowrap h-11 px-4 rounded-lg text-sm font-semibold text-muted-foreground hover:text-amber-700 data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
            <Clock className="w-4 h-4 me-1.5 inline-block" /> ממתין
            <span className="ms-1.5 rounded-full px-2 py-0.5 text-xs font-bold leading-none bg-muted text-muted-foreground group-data-[state=active]:bg-white/25 group-data-[state=active]:text-white">{notCompletedCount}</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="assignment" className="group flex-shrink-0 whitespace-nowrap h-11 px-4 rounded-lg text-sm font-semibold text-muted-foreground hover:text-violet-700 data-[state=active]:bg-violet-500 data-[state=active]:text-white data-[state=active]:shadow-sm">
              <ClipboardList className="w-4 h-4 me-1.5 inline-block" /> להקצות
              {assignmentTaskCount > 0 && (
                <span className="ms-1.5 rounded-full px-2 py-0.5 text-xs font-bold leading-none bg-muted text-muted-foreground group-data-[state=active]:bg-white/25 group-data-[state=active]:text-white">{assignmentTaskCount}</span>
              )}
            </TabsTrigger>
          )}

          {/* "More" dropdown for the secondary states. Mirrors active styling
              when one of its children is selected so the user always sees
              where they are. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`group flex-shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap h-11 px-4 rounded-lg text-sm font-semibold transition-colors ${
                  ['upcoming', 'undated', 'completed', 'not_done', 'cancelled', 'all'].includes(activeTab)
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List className="w-4 h-4" />
                {(() => {
                  const map = {
                    upcoming: 'עתידי',
                    undated: 'ללא יעד',
                    completed: 'בוצע',
                    not_done: 'לא בוצע',
                    cancelled: 'בוטל',
                    all: 'הכל',
                  };
                  return map[activeTab] || 'עוד';
                })()}
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem onSelect={() => setActiveTab('upcoming')}>
                <ArrowUpRight className="w-3.5 h-3.5 me-1.5" /> עתידי
                <span className="ms-auto text-xs font-bold opacity-70">{upcomingCount}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveTab('undated')}>
                <List className="w-3.5 h-3.5 me-1.5" /> ללא יעד
                <span className="ms-auto text-xs font-bold opacity-70">{undatedCount}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveTab('completed')}>
                <CheckCircle2 className="w-3.5 h-3.5 me-1.5" /> בוצע
                <span className="ms-auto text-xs font-bold opacity-70">{completedCount}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveTab('not_done')}>
                <XCircle className="w-3.5 h-3.5 me-1.5" /> לא בוצע
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveTab('cancelled')}>
                <Ban className="w-3.5 h-3.5 me-1.5" /> בוטל
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveTab('all')}>
                <List className="w-3.5 h-3.5 me-1.5" /> הכל
                <span className="ms-auto text-xs font-bold opacity-70">{totalCount}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TabsList>
      </Tabs>

      {/* ===== FILTER BAR ===== */}
      <div className="flex flex-wrap items-center gap-2 bg-card rounded-xl border border-border px-3 py-2.5 shadow-card">
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-muted-foreground/70 font-medium hidden sm:inline">מיון:</span>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px] h-8 text-xs border-border bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">מומלץ (לפי עדיפות)</SelectItem>
              <SelectItem value="due_date">לפי תאריך יעד</SelectItem>
              <SelectItem value="status">לפי סטטוס</SelectItem>
              <SelectItem value="rep">לפי נציג</SelectItem>
              <SelectItem value="created_date">לפי תאריך יצירה</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="h-6 w-px bg-border flex-shrink-0 hidden sm:block" />
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs text-muted-foreground/70 font-medium hidden sm:inline">תאריך:</span>
          <div className="relative">
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-[140px] h-8 text-xs border-border bg-muted ps-2 pe-6"
              title="סנן לפי תאריך יעד"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="absolute end-1 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground/80 p-0.5 rounded"
                title="נקה תאריך"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="h-6 w-px bg-border flex-shrink-0 hidden sm:block" />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-muted-foreground/70 font-medium hidden sm:inline">סטטוס ליד:</span>
          <Select value={leadStatusFilter} onValueChange={setLeadStatusFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs border-border bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              <SelectItem value="new_lead">ליד חדש</SelectItem>
              <SelectItem value="hot_lead">ליד רותח</SelectItem>
              <SelectItem value="followup_before_quote">פולאפ - לפני הצעה</SelectItem>
              <SelectItem value="followup_after_quote">פולאפ - אחרי הצעה</SelectItem>
              <SelectItem value="coming_to_branch">יגיע לסניף</SelectItem>
              <SelectItem value="no_answer_1">ללא מענה 1</SelectItem>
              <SelectItem value="no_answer_2">ללא מענה 2</SelectItem>
              <SelectItem value="no_answer_3">ללא מענה 3</SelectItem>
              <SelectItem value="no_answer_4">ללא מענה 4</SelectItem>
              <SelectItem value="no_answer_5">ללא מענה 5</SelectItem>
              <SelectItem value="no_answer_whatsapp_sent">ללא מענה - ווטסאפ</SelectItem>
              <SelectItem value="no_answer_calls">אין מענה - חיוגים</SelectItem>
              <SelectItem value="changed_direction">שנה כיוון</SelectItem>
              <SelectItem value="deal_closed">נסגרה עסקה</SelectItem>
              <SelectItem value="not_relevant_duplicate">כפול</SelectItem>
              <SelectItem value="heard_price_not_interested">שמע מחיר - לא מעוניין</SelectItem>
              <SelectItem value="not_interested_hangs_up">לא מעוניין - מנתק</SelectItem>
              <SelectItem value="closed_by_manager_to_mailing">נסגר - דיוור</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="h-6 w-px bg-border flex-shrink-0 hidden sm:block" />
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
          <Input
            placeholder="חפש שם, טלפון, סיכום..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs border-border bg-muted ps-8"
          />
        </div>
      </div>

      {/* ===== HIDDEN-ITEMS HINT =====
          On the assignment tab the label swaps to talk about "stale
          assignment tasks" so the admin doesn't think the regular
          stale-overdue counter is what they're toggling. Same showStale
          state — the user thinks of "stale" as one concept. */}
      {(() => {
        const onAssignmentTab = activeTab === 'assignment';
        const staleCount = onAssignmentTab ? counts.staleAssignmentHidden : hiddenStaleCount;
        const showStaleHint = staleCount > 0;
        const showAssignmentHint = assignmentTaskCount > 0 && !showAssignmentTasks && !onAssignmentTab;
        if (!showStaleHint && !showAssignmentHint) return null;
        const staleLabel = onAssignmentTab ? 'משימות שיוך ישנות' : 'משימות ישנות';
        return (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/80">
            {showStaleHint && (
              <button
                onClick={() => setShowStale((v) => !v)}
                className="rounded-full border border-dashed border-border bg-card px-3 py-1 hover:bg-muted transition-colors"
              >
                {showStale ? 'הסתר' : 'הצג'} {staleCount.toLocaleString()} {staleLabel} מ-{STALE_TASK_THRESHOLD_DAYS} ימים
              </button>
            )}
            {showAssignmentHint && (
              <button
                onClick={() => setShowAssignmentTasks((v) => !v)}
                className="rounded-full border border-dashed border-border bg-card px-3 py-1 hover:bg-muted transition-colors"
              >
                {showAssignmentTasks ? 'הסתר' : 'כלול'} {assignmentTaskCount.toLocaleString()} משימות שיוך
              </button>
            )}
          </div>
        );
      })()}

      {/* ===== TASK LIST ===== */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="bg-card rounded-xl border border-border shadow-card flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground/70">טוען משימות...</p>
            </div>
          </div>
        ) : finalVisibleTasks.length === 0 ? (
          <div className="bg-card rounded-xl border border-border shadow-card flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-muted-foreground/40" />
            </div>
            {assignmentInActiveTabCount > 0 && activeTab !== 'assignment' && !showAssignmentTasks ? (
              <>
                <div className="text-center max-w-md">
                  <p className="text-foreground font-medium text-sm">אין משימות עבודה — רק משימות שיוך</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    יש {assignmentInActiveTabCount.toLocaleString()} משימות שיוך פתוחות שמחכות להקצאה לנציג. הן הוסתרו מתצוגת העבודה היומית.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                  {isAdmin && (
                    <Button
                      onClick={() => setActiveTab('assignment')}
                      size="sm"
                      className="text-xs h-8 gap-1"
                    >
                      <ClipboardList className="h-3.5 w-3.5" />
                      עבור לתור השיוך
                    </Button>
                  )}
                  <Button
                    onClick={() => setShowAssignmentTasks(true)}
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 border-primary/20 text-primary hover:bg-primary/5"
                  >
                    הצג כאן בכל זאת
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-muted-foreground font-medium text-sm">אין משימות להצגה</p>
                  <p className="text-muted-foreground/70 text-xs mt-0.5">שנה את הפילטר או הוסף משימה חדשה</p>
                </div>
                <Button
                  onClick={() => setShowNewTaskDialog(true)}
                  size="sm"
                  variant="outline"
                  className="mt-1 text-xs h-8 border-primary/20 text-primary hover:bg-primary/5 gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  הוסף משימה
                </Button>
              </>
            )}
          </div>
        ) : (
          finalVisibleTasks.map((task, index) => {
            const dueDate = parseSalesTaskDate(task.due_date);
            const normalizedTaskStatus = normalizeTaskStatus(task.task_status);
            const isOverdue = dueDate && dueDate < todayStart && normalizedTaskStatus !== 'completed' && normalizedTaskStatus !== 'cancelled';
            const isToday = dueDate && dueDate >= todayStart && dueDate <= todayEnd && normalizedTaskStatus !== 'completed' && normalizedTaskStatus !== 'cancelled';
            const isDone = normalizedTaskStatus === 'completed';
            const isNextUp =
              index === 0 &&
              sortBy === 'priority' &&
              ['today', 'overdue', 'not_completed'].includes(activeTab) &&
              normalizedTaskStatus === 'not_completed';

            const urgencyBorder = isDone ? 'border-s-green-300'
              : isOverdue ? 'border-s-red-500'
              : isToday ? 'border-s-orange-400'
              : dueDate ? 'border-s-blue-400'
              : 'border-s-border';

            const TaskTypeIcon = {
              call: Phone, whatsapp: MessageCircle, email: Mail, meeting: Users,
              quote_preparation: FileText, followup: RefreshCw, assignment: ClipboardList, other: Paperclip,
            }[task.task_type] || Paperclip;

            const taskTypeLabel = {
              call: 'שיחה', whatsapp: 'וואטסאפ', email: 'מייל', meeting: 'פגישה',
              quote_preparation: 'הצעת מחיר', followup: 'מעקב', assignment: 'שיוך', other: 'אחר',
            }[task.task_type] || 'אחר';

            const taskTypeBadgeColor = {
              call: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
              whatsapp: 'bg-green-50 text-green-700 ring-1 ring-green-200',
              email: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
              meeting: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
              quote_preparation: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
              followup: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
              assignment: 'bg-slate-50 text-slate-700 ring-1 ring-slate-200',
              other: 'bg-muted/50 text-muted-foreground ring-1 ring-border',
            }[task.task_type] || 'bg-muted/50 text-muted-foreground ring-1 ring-border';

            const taskStatusStyle = {
              not_completed: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
              completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
              not_done: 'bg-red-50 text-red-700 ring-1 ring-red-200',
              cancelled: 'bg-muted text-muted-foreground ring-1 ring-border',
            }[normalizedTaskStatus] || 'bg-muted/50 text-muted-foreground ring-1 ring-border';

            const taskStatusLabel = {
              not_completed: 'ממתין', completed: 'בוצע', not_done: 'לא בוצע', cancelled: 'בוטל',
            }[normalizedTaskStatus] || normalizedTaskStatus;

            const dueDateDisplay = dueDate
              ? isToday ? `היום ${safeFormat(task.due_date, 'HH:mm')}`
              : safeFormat(task.due_date, 'dd/MM HH:mm')
              : '';

            const cardBgClass = {
              not_completed: 'bg-orange-50/60 hover:bg-orange-100/60 border-orange-100',
              completed: 'bg-green-50/60 hover:bg-green-100/60 border-green-100',
              not_done: 'bg-red-50/60 hover:bg-red-100/60 border-red-100',
              cancelled: 'bg-muted/50 hover:bg-muted border-border',
            }[normalizedTaskStatus] || 'bg-card hover:bg-muted/50 border-border';

            return (
              <div
                key={task.id}
                onClick={() => handleOpenTaskDetails(task)}
                className={`cursor-pointer p-4 rounded-xl border shadow-sm ${cardBgClass} transition-colors duration-150 hover:ring-2 hover:ring-primary/10 ${isDone ? 'opacity-70' : ''} ${isNextUp ? 'ring-2 ring-primary shadow-md' : ''}`}
              >
                {isNextUp && (
                  <div className="mb-3 -mx-1 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
                      ★ הבאה בתור
                    </span>
                    <span className="text-xs text-muted-foreground">המשימה הראשונה לטיפול עכשיו</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">

                  {/* רבע 1: לקוח ונציג */}
                  <div className="flex flex-col gap-1.5 text-start overflow-hidden w-full">
                    <span className={`font-bold text-foreground truncate block ${isNextUp ? 'text-lg' : 'text-base'}`}>
                      {task.lead?.full_name || task.summary?.match(/הליד (.+?)(?:\s+לנציג|\s+יש)/)?.[1] || task.summary?.match(/הליד (.+?)$/)?.[1] || 'ליד'}
                    </span>
                    <div className="text-sm text-muted-foreground truncate">
                      נציג מטפל: {getRepName(task.rep1) || 'לא משויך'}
                    </div>
                  </div>

                  {/* רבע 2: סוג וסטטוס */}
                  <div className="flex flex-col items-start gap-2">
                    <span className="font-bold text-sm text-foreground">
                      {taskTypeLabel}
                    </span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${taskStatusStyle}`}>
                      {taskStatusLabel}
                    </span>
                  </div>

                  {/* רבע 3: תאריכים */}
                  <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">תאריך יצירה:</span>
                      <span dir="ltr" className="tabular-nums font-medium">
                        {safeFormat(task.created_date || task.manual_created_date || new Date(), 'dd/MM/yyyy HH:mm')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">תאריך יעד:</span>
                      <span dir="ltr" className="tabular-nums font-medium">
                        {dueDate ? safeFormat(dueDate, 'dd/MM/yyyy HH:mm') : 'ללא יעד'}
                      </span>
                    </div>
                  </div>

                  {/* רבע 4: סטטוס ליד + זמן נותר/עבר */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 h-full">
                    {(task.status || task.lead?.status) && (
                      <StatusBadge status={task.status || task.lead?.status} />
                    )}
                    <div className="flex items-center sm:justify-end">
                      {dueDate && normalizedTaskStatus !== 'completed' && normalizedTaskStatus !== 'cancelled' ? (
                        <span className={`font-bold text-sm ${isOverdue ? 'text-red-600' : 'text-blue-800'}`}>
                          {isOverdue ? 'באיחור של ' : 'בעוד '}
                          {formatDistanceToNow(dueDate, { locale: he })}
                        </span>
                      ) : (
                        <span></span>
                      )}
                    </div>
                  </div>

                </div>
                
                {/* Summary Row */}
                {task.summary && (
                  <div className="mt-3 pt-3 border-t border-black/5 text-sm text-foreground/80 leading-relaxed">
                    {task.summary}
                  </div>
                )}
              </div>
            );
          })
        )}

        {hasMoreTasks && (
          <div className="flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border shadow-card">
            <span className="text-xs text-muted-foreground/70">
              מציג {paginatedTasks.length} מתוך {totalFilteredCount} משימות
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTasksPage(prev => prev + 1)}
              className="h-8 text-xs border-primary/20 text-primary hover:bg-primary/5 gap-1.5"
            >
              טען {Math.min(TASKS_PER_PAGE, totalFilteredCount - paginatedTasks.length)} נוספות
            </Button>
          </div>
        )}
      </div>
      </>
      )}

      {/* New Task Dialog */}
      <AddSalesTaskDialog
        isOpen={showNewTaskDialog} 
        onClose={() => setShowNewTaskDialog(false)}
        effectiveUser={effectiveUser}
      />

      {/* Import Tasks Dialog */}
      <ImportSalesTasks isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} />

      {/* Edit Task Dialog */}
      <EditSalesTaskDialog 
        isOpen={showEditTaskDialog} 
        onClose={() => setShowEditTaskDialog(false)} 
        task={editingTask} 
        effectiveUser={effectiveUser}
      />
    </div>
  );
}