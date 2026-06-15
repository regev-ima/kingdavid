import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Calendar, Phone, MessageCircle, FileText, Plus, FileSpreadsheet, Search, X, CheckCircle2, XCircle, Ban, List, AlertCircle, ArrowUpRight, Mail, Users, UserPlus, RefreshCw, ClipboardList, Paperclip, LayoutGrid, ChevronDown, Globe, LifeBuoy } from "lucide-react";
import StatCube from "@/components/shared/StatCube";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format, isValid, startOfDay, endOfDay } from '@/lib/safe-date-fns';
import { formatInTimeZone, parseDbTimestamp } from '@/lib/safe-date-fns-tz';

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
import SalesTaskDialog from '@/components/task/SalesTaskDialog';
import TaskDayView from '@/components/task/TaskDayView';
import TaskWeekView from '@/components/task/TaskWeekView';
import StatusBadge from '@/components/shared/StatusBadge';
import DataTable from '@/components/shared/DataTable';
import UserAvatar from '@/components/shared/UserAvatar';
import QuickActions from '@/components/shared/QuickActions';
import CompleteTaskDialog from '@/components/sales/CompleteTaskDialog';
import useEffectiveCurrentUser from '@/components/shared/useEffectiveCurrentUser';
import { canAccessSalesWorkspace, filterSalesTasksForUser, isAdmin as isAdminUser } from '@/components/shared/rbac';
import { compareSalesTasks, getTaskCounterMismatches, matchesSalesTaskTab, normalizeTaskStatus, parseSalesTaskDate, sortSalesTasks } from '@/components/shared/salesTaskWorkbench';
import { compareTasksByPriority, isAssignmentTask, isStaleOverdueTask, STALE_TASK_THRESHOLD_DAYS } from '@/lib/salesTaskWorkbench';
import { getRepDisplayName } from '@/lib/repDisplay';
import { SOURCE_LABELS, SLA_THRESHOLDS, CLOSED_STATUSES } from '@/constants/leadOptions';
import { getLeadSlaAnchor, isReturningLead, isLeadHandled } from '@/utils/leadStatus';

// Sales-return categories, per the rep workflow brief. Each category is
// driven by the related LEAD's status, not the task's own status — the
// rep doesn't manage leads, they work a queue of return callbacks
// derived from where each lead sits in the funnel.
const LEAD_STATUSES_BY_CATEGORY = {
  cat_new_lead: ['new_lead'],
  cat_no_answer: ['no_answer_1', 'no_answer_2', 'no_answer_3', 'no_answer_4', 'no_answer_5', 'no_answer_whatsapp_sent', 'no_answer_calls'],
  cat_before_quote: ['followup_before_quote'],
  cat_after_quote: ['followup_after_quote'],
  cat_meeting: ['coming_to_branch'],
};
const CATEGORY_BY_LEAD_STATUS = (() => {
  const map = {};
  for (const [cat, statuses] of Object.entries(LEAD_STATUSES_BY_CATEGORY)) {
    for (const s of statuses) map[s] = cat;
  }
  return map;
})();

// "Due now" window — a task whose due_date is within ±60min of the
// current clock is highlighted as actionable-now (the brief's "מהבהב").
const DUE_NOW_WINDOW_MS = 60 * 60 * 1000;

// A task scheduled for a specific time is "due now" once the clock lands
// within that ±60-min window. The today queue floats these to the very top
// so the rep sees a 16:00 callback the moment 16:00 arrives.
const isTaskDueNow = (task, now) => {
  if (normalizeTaskStatus(task.task_status) !== 'not_completed') return false;
  const due = parseSalesTaskDate(task.due_date);
  if (!due) return false;
  return Math.abs(due.getTime() - now.getTime()) <= DUE_NOW_WINDOW_MS;
};

// The three header lead-cubes. Both the cube COUNTS and the table FILTER run
// `matchesLeadCube` over the SAME open-task set, so a cube's number always
// equals the rows you see when you click it. The buckets overlap (a fresh
// lead is both "new today" and "unhandled"), so this is a per-cube test
// rather than a partition. Everything keys off fields already on the task —
// the denormalised lead-status mirror and the task's own created_date — so the
// page never has to pre-load lead rows just to count/filter these.
const LEAD_CUBES = ['leads_new_today', 'leads_unhandled', 'leads_in_handling'];
// Stable empty map: task scoping/sorting reads the task's own status mirror,
// so we no longer hydrate a full leads-by-id map (see leadsById below).
const EMPTY_LEADS_BY_ID = {};
const matchesLeadCube = (task, cube, todayStart, todayEnd) => {
  const status = task.status;
  if (cube === 'leads_new_today') {
    // A brand-new lead gets its call task at assignment, so an open new_lead
    // task created today == a new lead that came in today — no lead row needed.
    const created = parseSalesTaskDate(task.created_date);
    return status === 'new_lead' && !!created && created >= todayStart && created <= todayEnd;
  }
  if (cube === 'leads_unhandled') return status === 'new_lead';
  if (cube === 'leads_in_handling') {
    return !!status && status !== 'new_lead' && !CLOSED_STATUSES.includes(status);
  }
  return false;
};

export default function SalesTasks() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab');
  const [activeTab, setActiveTab] = useState(['today', 'overdue', 'upcoming', 'undated', 'not_completed', 'assignment', 'completed', 'completed_today', 'not_done', 'cancelled', 'all',
    'leads_new_today', 'leads_unhandled', 'leads_in_handling',
    'cat_new_lead', 'cat_no_answer', 'cat_before_quote', 'cat_after_quote', 'cat_meeting'].includes(initialTab) ? initialTab : 'today');
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
  const [completingTask, setCompletingTask] = useState(null);
  const [leadStatusFilter, setLeadStatusFilter] = useState('all');

  // Live clock: re-render every 30s so the today queue re-sorts and the
  // due-now highlight advances on their own. A task scheduled for 16:00
  // floats to the top the moment 16:00 arrives — no page refresh needed.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
  const TASKS_PER_PAGE = 100;
  // Sentinel at the foot of the list — when it scrolls into view we append the
  // next page in place (see effect below), so the page never jumps to the top.
  const loadMoreRef = useRef(null);
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
      // How many open tasks the stale filter (>30d overdue) is hiding from
      // the list right now. All stale tasks are overdue (due < cutoff <
      // today), so subtracting this from total/open/overdue makes those
      // cube numbers equal exactly what the de-noised list renders. When
      // showStale is on, nothing is hidden so it's 0.
      const staleOpenHidden = showStale
        ? 0
        : await head((q) => q.eq('task_status', 'not_completed').lt('due_date', staleCutoffIso));
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
      return {
        total: total - staleOpenHidden,
        open: open - staleOpenHidden,
        completed,
        today: todayCnt,
        overdue: overdue - staleOpenHidden,
        upcoming,
        undated,
        completedToday,
        assignmentOpen,
        staleAssignmentHidden,
      };
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
    // Keep today's queue live without a manual refresh — newly scheduled or
    // reassigned tasks surface on their own within a minute.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
      } else if (activeTab === 'completed_today') {
        // "הושלמו היום" cube: completed AND touched within today's window —
        // must mirror the count query's completedToday, not the generic
        // "all completed ever" the plain `completed` tab shows.
        q = q.eq('task_status', 'completed').gte('updated_date', todayStartIso).lte('updated_date', todayEndIso);
      } else if (['completed', 'not_done', 'cancelled'].includes(activeTab)) {
        q = q.eq('task_status', activeTab);
      } else if (activeTab.startsWith('cat_') || activeTab.startsWith('leads_')) {
        // Category + header lead-cube tabs are partitions of the open queue
        // driven by the related lead's state. Server-side we just narrow to
        // open tasks; the lead-level check (status / first_action_at /
        // created_date) happens client-side using `leadsById` so we don't
        // have to .in() over a list of thousands of lead ids.
        q = q.eq('task_status', 'not_completed');
      }
      // 'all' falls through with no filter.

      // Sort: closed tabs by most-recently-touched. Open tabs by due_date —
      // ascending for forward-looking buckets (today/upcoming/not_completed),
      // but descending for overdue so the *most recent* misses come back
      // first. With 6k+ migration leftovers, ascending pulled only ancient
      // garbage and crowded out anything actionable.
      const recentlyTouched = ['completed', 'completed_today', 'not_done', 'cancelled'].includes(activeTab);
      if (recentlyTouched) {
        q = q.order('updated_date', { ascending: false, nullsFirst: false });
      } else if (activeTab === 'overdue' || activeTab.startsWith('cat_')) {
        // Overdue + funnel categories: newest-due first, so within the
        // 1000-row fetch cap we keep the freshest, most-actionable tasks
        // rather than ancient migration leftovers. For categories this also
        // keeps the list in sync with the (uncapped) category counts.
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

  // Lead-cube source rows: lead_id + the denormalised lead-status mirror for
  // every OPEN task the rep owns (uncapped scan; distinct-by-lead happens in
  // leadCubeCounts below). We derive the header cube counts from THIS — the
  // same task set the table renders — rather than from the leads table, so a
  // cube's number always equals the rows you see when you click it: a lead
  // with no open task lands in neither the count nor the list. Scoped to the
  // rep via applyUserScope, exactly like the list query.
  const { data: openTaskRows = [] } = useQuery({
    queryKey: ['salesTasks-open-cube-rows', isAdmin ? 'admin' : userEmail || 'anon', includeAssignmentInCounts],
    enabled: canAccessSales,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await applyUserScope(
        base44.supabase.from('sales_tasks').select('lead_id, status, created_date').eq('task_status', 'not_completed').not('lead_id', 'is', null),
        { includeAssignment: includeAssignmentInCounts },
      ).limit(10_000);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch users for rep name display
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
    enabled: canAccessSales,
  });

  const getRepName = (email) => getRepDisplayName(email, allUsers);

  // Derived from the live tick (above) so every now-based memo — sort order,
  // due-now highlight, today's day boundaries — recomputes on the timer
  // rather than only on user interaction.
  const now = useMemo(() => new Date(nowTick), [nowTick]);
  const todayStart = useMemo(() => startOfDay(now), [now]);
  const todayEnd = useMemo(() => endOfDay(now), [now]);
  // We no longer pre-load every lead in the system just to scope, sort and
  // count tasks — that was the page's slowest query by far. The task already
  // carries a denormalised lead-status mirror (and its own created_date),
  // which covers the cubes, the priority sort and ownership; visible rows
  // fetch their own lead below. This stays an (empty, stable) map so the rare
  // fallback lookups degrade gracefully without extra deps churn.
  const leadsById = EMPTY_LEADS_BY_ID;
  // Non-admin reps never see assignment tasks anywhere on this page —
  // those belong to the manager workflow. Stripping them at the
  // ownedTasks layer makes counts, toggles, and empty-state CTAs all
  // collapse to 0/hidden automatically for non-admins.
  const ownedTasks = useMemo(() => {
    const base = filterSalesTasksForUser(effectiveUser, allSalesTasks, leadsById);
    const filtered = isAdminUser(effectiveUser) ? base : base.filter((t) => !isAssignmentTask(t));
    // Category tabs partition the open queue by the related lead's
    // status. We do the lookup here (rather than in the server query)
    // because the leadsById map is already loaded for ownership scoping
    // and saves us another round trip.
    if (activeTab.startsWith('cat_')) {
      return filtered.filter((t) => {
        // Prefer the task's denormalised status mirror so the list and
        // the category-card counts above always agree, regardless of
        // whether the related lead has finished paginating into
        // leadsById yet.
        const status = t.status || (t.lead_id ? leadsById[t.lead_id]?.status : null);
        return CATEGORY_BY_LEAD_STATUS[status] === activeTab;
      });
    }
    // The three header lead-cubes filter the task queue by the related lead's
    // state, using the exact same predicate as the cube counts so the number
    // on a cube equals the rows shown here.
    if (LEAD_CUBES.includes(activeTab)) {
      return filtered.filter((t) => matchesLeadCube(t, activeTab, todayStart, todayEnd));
    }
    return filtered;
  }, [effectiveUser, allSalesTasks, leadsById, activeTab, todayStart, todayEnd]);

  // Distinct leads per header cube, computed from the rep's open-task rows
  // with the SAME predicate the table filter uses (matchesLeadCube) — so each
  // cube number equals the rows you see when you click it. A lead with three
  // open tasks counts once; a lead with no open task counts in neither.
  const leadCubeCounts = useMemo(() => {
    const sets = { leads_new_today: new Set(), leads_unhandled: new Set(), leads_in_handling: new Set() };
    for (const row of openTaskRows) {
      const lid = row?.lead_id;
      if (!lid) continue;
      for (const cube of LEAD_CUBES) {
        if (matchesLeadCube(row, cube, todayStart, todayEnd)) sets[cube].add(lid);
      }
    }
    return {
      newToday: sets.leads_new_today.size,
      unhandled: sets.leads_unhandled.size,
      inHandling: sets.leads_in_handling.size,
    };
  }, [openTaskRows, todayStart, todayEnd]);

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
    // Stale (>30d overdue) tasks are migration noise on the time buckets, so
    // they're hidden there by default. But the lead-driven queues (cat_* and
    // the header lead-cubes leads_*) are an explicit "work these leads now"
    // request — a lead's task must show up there regardless of age, or the
    // cube says 3 while the list shows 0. So skip stale-hiding for those tabs.
    const isLeadDrivenTab = activeTab.startsWith('cat_') || activeTab.startsWith('leads_');
    if (!showStale && !isLeadDrivenTab) tasks = tasks.filter((t) => !isStaleOverdueTask(t, now));
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

    // Scheduled-time tasks float to the top of the today queue the moment
    // they come due (within the ±60-min due-now window). The sort is stable,
    // so it only lifts the due-now rows and preserves the order below them;
    // the live `now` tick re-runs this, so a 16:00 callback rises on its own.
    if (activeTab === 'today') {
      tasks = [...tasks].sort(
        (a, b) => (isTaskDueNow(a, now) ? 0 : 1) - (isTaskDueNow(b, now) ? 0 : 1),
      );
    }

    const total = tasks.length;
    const paginated = tasks.slice(0, (tasksPage + 1) * TASKS_PER_PAGE);
    return { totalFilteredCount: total, paginatedTasks: paginated };
  }, [scopedTasks, activeTab, dateFilter, search, sortBy, tasksPage, now, leadsById]);

  // 3. Fetch leads ONLY for the paginated (visible) tasks
  const paginatedTaskLeadIds = useMemo(() => 
    [...new Set(paginatedTasks.map(t => t.lead_id).filter(Boolean))],
    [paginatedTasks]
  );

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-paginated-tasks', paginatedTaskLeadIds.join(',')],
    // The key grows each time we append a page, so without this the already
    // visible rows would flash their lead data away while the larger set
    // refetches. Keep the previous leads on screen until the new set lands.
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      if (paginatedTaskLeadIds.length === 0) return [];
      // One batched `id IN (...)` query per ~200 ids instead of a separate
      // round trip per lead. For a 100-row page that's a single request rather
      // than 100 — the difference between a snappy table and a visible stall.
      const out = [];
      const chunk = 200;
      for (let i = 0; i < paginatedTaskLeadIds.length; i += chunk) {
        const ids = paginatedTaskLeadIds.slice(i, i + chunk);
        const { data, error } = await base44.supabase.from('leads').select('*').in('id', ids);
        if (error) throw error;
        out.push(...(data || []));
      }
      return out;
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

  // Infinite scroll: reveal the next page of rows the moment the sentinel at
  // the foot of the list comes into view (with a 400px head-start so it feels
  // instant). Because we only grow the already-rendered slice — same list,
  // more rows appended below — the scroll position is untouched and the page
  // never jumps back to the top. Re-running on tasksPage re-checks the
  // intersection after each append, so a tall viewport keeps filling until the
  // sentinel is pushed off-screen or every row is loaded.
  useEffect(() => {
    if (!hasMoreTasks) return undefined;
    const el = loadMoreRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setTasksPage((prev) => prev + 1);
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreTasks, tasksPage]);

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
  const completedTodayCount = counts.completedToday;
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

  const formatPhone = (phone) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  const TASK_TYPE_META = {
    call: { Icon: Phone, label: 'שיחה', color: 'text-blue-600' },
    whatsapp: { Icon: MessageCircle, label: 'וואטסאפ', color: 'text-green-600' },
    email: { Icon: Mail, label: 'מייל', color: 'text-purple-600' },
    meeting: { Icon: Users, label: 'פגישה', color: 'text-amber-600' },
    quote_preparation: { Icon: FileText, label: 'הצעת מחיר', color: 'text-indigo-600' },
    followup: { Icon: RefreshCw, label: 'מעקב', color: 'text-orange-600' },
    assignment: { Icon: ClipboardList, label: 'שיוך', color: 'text-violet-600' },
    service: { Icon: LifeBuoy, label: 'פניית שירות', color: 'text-rose-600' },
    other: { Icon: Paperclip, label: 'אחר', color: 'text-muted-foreground' },
  };

  const taskTableColumns = useMemo(() => [
    {
      header: 'לקוח',
      accessor: 'full_name',
      width: '240px',
      render: (row) => {
        const lead = row.lead;
        const name = lead?.full_name
          || row.summary?.match(/הליד (.+?)(?:\s+לנציג|\s+יש)/)?.[1]
          || row.summary?.match(/הליד (.+?)$/)?.[1]
          || 'ליד';
        const returning = lead && isReturningLead(lead);
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{name}</p>
              {returning && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0">
                  🔁 פניה חוזרת
                </span>
              )}
            </div>
            {lead?.phone && (
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-sm text-muted-foreground whitespace-nowrap" dir="ltr">{formatPhone(lead.phone)}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCall(lead.phone); }}
                  className="h-6 w-6 rounded-full bg-green-100 hover:bg-green-200 flex items-center justify-center transition-colors flex-shrink-0"
                  title="התקשר"
                >
                  <Phone className="h-3.5 w-3.5 text-green-700" />
                </button>
              </div>
            )}
            {lead?.unique_id && <p className="text-xs text-muted-foreground/70 mt-0.5">ID: {lead.unique_id}</p>}
          </div>
        );
      },
    },
    {
      header: 'סטטוס',
      accessor: 'status',
      width: '130px',
      render: (row) => {
        const status = row.status || row.lead?.status;
        const lead = row.lead;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {status && <StatusBadge status={status} />}
            {(lead?.source === 'website' || (Array.isArray(lead?.tags) && lead.tags.includes('אתר'))) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-semibold px-1.5 py-0.5">
                <Globe className="h-2.5 w-2.5" />
                אתר
              </span>
            )}
          </div>
        );
      },
    },
    {
      header: 'שם מודעה',
      accessor: 'facebook_ad_name',
      width: '160px',
      render: (row) => {
        const adName = row.lead?.facebook_ad_name;
        if (!adName) return <span className="text-muted-foreground/40 text-sm">-</span>;
        return <span className="text-sm text-foreground/80 line-clamp-2">{adName}</span>;
      },
    },
    {
      header: 'SLA',
      accessor: 'sla',
      width: '128px',
      render: (row) => {
        if (!row.lead) return <span className="text-xs text-muted-foreground/70">-</span>;
        if (isLeadHandled(row.lead)) return <span className="text-xs text-muted-foreground/70">טופל</span>;
        const anchor = getLeadSlaAnchor(row.lead);
        if (!anchor) return <span className="text-xs text-muted-foreground/70">-</span>;
        const diffMinutes = Math.floor((Date.now() - anchor) / 60000);
        let color = 'text-green-600';
        if (diffMinutes > SLA_THRESHOLDS.AMBER_MAX_MINUTES) color = 'text-red-600';
        else if (diffMinutes > SLA_THRESHOLDS.GREEN_MAX_MINUTES) color = 'text-amber-600';
        if (diffMinutes < 60) {
          return <span className={`text-sm font-medium ${color}`}>{diffMinutes === 1 ? 'דקה אחת' : `${diffMinutes} דקות`}</span>;
        }
        if (diffMinutes < 1440) {
          const hours = Math.floor(diffMinutes / 60);
          const mins = diffMinutes % 60;
          const hoursText = hours === 1 ? 'שעה אחת' : `${hours} שעות`;
          if (mins === 0) return <span className={`text-sm font-medium ${color}`}>{hoursText}</span>;
          const minsText = mins === 1 ? 'דקה' : `${mins} דקות`;
          return <span className={`text-sm font-medium ${color}`}>{hoursText} ו-{minsText}</span>;
        }
        const days = Math.floor(diffMinutes / 1440);
        const hours = Math.floor((diffMinutes % 1440) / 60);
        const daysText = days === 1 ? 'יום אחד' : `${days} ימים`;
        if (hours === 0) return <span className={`text-sm font-medium ${color}`}>{daysText}</span>;
        const hoursText = hours === 1 ? 'שעה' : `${hours} שעות`;
        return <span className={`text-sm font-medium ${color}`}>{daysText} ו-{hoursText}</span>;
      },
    },
    {
      header: 'מקור',
      accessor: 'source',
      width: '110px',
      render: (row) => {
        const source = row.lead?.source;
        const utmSource = row.lead?.utm_source;
        if (!source && !utmSource) return <span className="text-muted-foreground/70 text-xs">-</span>;
        return (
          <div className="text-xs leading-relaxed">
            <span className="font-medium">{SOURCE_LABELS[source] || source || '-'}</span>
            {utmSource && <p className="text-muted-foreground">{utmSource}</p>}
          </div>
        );
      },
    },
    {
      header: 'נציג',
      accessor: 'rep1',
      width: '180px',
      render: (row) => {
        if (!row.rep1 && row.pending_rep_email) {
          const pendingRep = allUsers.find((u) => u.email === row.pending_rep_email);
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
        const rep = allUsers.find((u) => u.email === row.rep1);
        const displayUser = rep || { email: row.rep1, full_name: getRepName(row.rep1) };
        return (
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar user={displayUser} size="sm" />
            <span className="text-sm truncate">{displayUser.full_name}</span>
          </div>
        );
      },
    },
    {
      header: 'משימה',
      accessor: 'task',
      width: '240px',
      render: (row) => {
        const meta = TASK_TYPE_META[row.task_type] || TASK_TYPE_META.other;
        const due = parseSalesTaskDate(row.due_date);
        const normalizedStatus = normalizeTaskStatus(row.task_status);
        const todayStartLocal = new Date(); todayStartLocal.setHours(0, 0, 0, 0);
        const todayEndLocal = new Date(todayStartLocal.getTime() + 86400000);
        const overdueDays = due && due < todayStartLocal
          ? Math.floor((todayStartLocal - due) / 86400000)
          : 0;
        const isTodayDue = due && due >= todayStartLocal && due < todayEndLocal;
        let timeLabel = 'ללא יעד';
        if (due) {
          if (overdueDays > 0) timeLabel = `בפיגור ${overdueDays} ${overdueDays === 1 ? 'יום' : 'ימים'}`;
          else if (isTodayDue) timeLabel = `היום ${safeFormat(row.due_date, 'HH:mm')}`;
          else timeLabel = safeFormat(row.due_date, 'dd/MM HH:mm');
        }
        const statusLabel = {
          not_completed: 'ממתין', completed: 'בוצע', not_done: 'לא בוצע', cancelled: 'בוטל',
        }[normalizedStatus] || normalizedStatus;
        const statusStyle = {
          not_completed: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
          completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
          not_done: 'bg-red-50 text-red-700 ring-1 ring-red-200',
          cancelled: 'bg-muted text-muted-foreground ring-1 ring-border',
        }[normalizedStatus] || 'bg-muted/50 text-muted-foreground ring-1 ring-border';
        const canQuickComplete = normalizedStatus === 'not_completed';
        return (
          <div onClick={(e) => e.stopPropagation()} className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm flex-wrap">
              <meta.Icon className={`h-3.5 w-3.5 ${meta.color}`} />
              <span className="font-medium">{meta.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusStyle}`}>{statusLabel}</span>
            </div>
            <div className={`text-xs font-medium whitespace-nowrap ${
              overdueDays > 0 ? 'text-red-600' : isTodayDue ? 'text-amber-600' : 'text-muted-foreground'
            }`}>
              {timeLabel}
            </div>
            {row.summary && (
              <p className="text-xs text-muted-foreground/80 line-clamp-2">{row.summary}</p>
            )}
            {canQuickComplete && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  setCompletingTask({ ...row, rep1: row.rep1 || row.lead?.rep1, rep2: row.rep2 || row.lead?.rep2 });
                }}
              >
                סיים משימה
              </Button>
            )}
          </div>
        );
      },
    },
    {
      header: 'תאריך',
      accessor: 'dates',
      width: '140px',
      render: (row) => {
        const dueRaw = row.due_date;
        const createdRaw = row.created_date || row.manual_created_date;
        const renderDateLine = (raw) => {
          if (!raw) return null;
          const d = parseDbTimestamp(raw) || new Date(raw);
          if (!d || isNaN(d.getTime())) return null;
          try {
            return (
              <>
                <span>{formatInTimeZone(d, 'Asia/Jerusalem', 'dd/MM/yyyy')}</span>
                <span className="text-muted-foreground/80"> · </span>
                <span>{formatInTimeZone(d, 'Asia/Jerusalem', 'HH:mm')}</span>
              </>
            );
          } catch {
            return safeFormat(raw, 'dd/MM/yyyy HH:mm');
          }
        };
        const dueLine = renderDateLine(dueRaw);
        const createdLine = renderDateLine(createdRaw);
        return (
          <div className="text-xs whitespace-nowrap space-y-0.5">
            <div>
              <span className="text-muted-foreground">יעד: </span>
              {dueLine ? <span className="font-medium text-foreground/80">{dueLine}</span> : <span className="text-muted-foreground/60">—</span>}
            </div>
            <div>
              <span className="text-muted-foreground">נוצר: </span>
              {createdLine ? <span className="text-muted-foreground/80">{createdLine}</span> : <span className="text-muted-foreground/60">—</span>}
            </div>
          </div>
        );
      },
    },
    {
      header: 'פעולות',
      accessor: 'actions',
      align: 'center',
      width: '72px',
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
          {row.lead ? (
            <QuickActions
              type="lead"
              data={row.lead}
              hideContactButtons={true}
              onView={() => handleOpenTaskDetails(row)}
            />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); handleOpenTaskDetails(row); }}
            >
              פתח
            </Button>
          )}
        </div>
      ),
    },
  ], [allUsers]);

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
            asChild
            variant="outline"
            size="sm"
            className="h-9 border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground gap-1.5"
          >
            <Link to={createPageUrl('LeadLookup')}>
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">איתור ליד</span>
            </Link>
          </Button>
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
      {/* ===== TOP KPI STRIP =====
          Per the customer brief: exactly four tiles summarising the rep's
          day — today's task queue plus three lead snapshots (fresh intake,
          waiting-for-first-contact, and actively in handling). Each tile is
          clickable and filters the task table below it — tiles ARE the
          navigation, not decoration. Default tone is muted and a tile lights
          up to its accent colour when active, so the rep can see at a glance
          which filter is on. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { id: 'today',             label: 'משימות להיום',          value: todayCount,                tone: 'amber',  icon: Calendar,    sub: 'כל המשימות להיום' },
          { id: 'leads_new_today',   label: 'לידים חדשים',           value: leadCubeCounts.newToday,   tone: 'sky',    icon: UserPlus,    sub: 'שויכו אליי היום' },
          { id: 'leads_unhandled',   label: 'לידים חדשים ללא טיפול', value: leadCubeCounts.unhandled,  tone: 'rose',   icon: AlertCircle, sub: 'טרם טופלו' },
          { id: 'leads_in_handling', label: 'בטיפול',                value: leadCubeCounts.inHandling, tone: 'violet', icon: RefreshCw,   sub: 'פתוחים בטיפול' },
        ].map((tile) => {
          const target = tile.id;
          const isActive = activeTab === target;
          return (
            <StatCube
              key={tile.id}
              label={tile.label}
              value={Number(tile.value || 0).toLocaleString()}
              sub={tile.sub}
              icon={tile.icon}
              tone={tile.tone}
              active={isActive}
              onClick={() => setActiveTab(isActive ? 'all' : target)}
              title={isActive ? 'בטל סינון' : `הצג ${tile.label}`}
            />
          );
        })}
      </div>

      {/* ===== SECONDARY FILTERS =====
          The header tiles cover the rep's daily drivers (today + the three
          lead snapshots). Everything else — overdue, completed-today, and
          the rarely-touched states (עתידי / ללא יעד / לא בוצע / בוטל / הכל)
          plus the admin-only assignment queue — sits in this small dropdown
          so it stays reachable without competing with the primary tiles. */}
      {(() => {
        const SECONDARY = [
          { id: 'overdue',        label: 'משימות באיחור', count: overdueCount,        Icon: AlertCircle },
          { id: 'completed_today', label: 'הושלמו היום',   count: completedTodayCount, Icon: CheckCircle2 },
          { id: 'upcoming',  label: 'עתידי',    count: upcomingCount,  Icon: ArrowUpRight },
          { id: 'undated',   label: 'ללא יעד',  count: undatedCount,   Icon: List },
          { id: 'not_done',  label: 'לא בוצע',  count: null,           Icon: XCircle },
          { id: 'cancelled', label: 'בוטל',     count: null,           Icon: Ban },
          { id: 'all',       label: 'הכל',      count: totalCount,     Icon: List },
          ...(isAdmin ? [{ id: 'assignment', label: 'להקצות', count: assignmentTaskCount, Icon: ClipboardList }] : []),
        ];
        const currentSecondary = SECONDARY.find((s) => s.id === activeTab);
        return (
          <div className="flex items-center justify-end gap-2">
            {currentSecondary ? (
              <button
                type="button"
                onClick={() => setActiveTab('today')}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15 transition-colors"
                title="חזור לתצוגת היום"
              >
                <currentSecondary.Icon className="h-3 w-3" />
                {currentSecondary.label}
                <X className="h-3 w-3 opacity-60" />
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <List className="h-3.5 w-3.5" />
                  אפשרויות נוספות
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                {SECONDARY.map((s) => (
                  <DropdownMenuItem key={s.id} onSelect={() => setActiveTab(s.id)}>
                    <s.Icon className="w-3.5 h-3.5 me-1.5" /> {s.label}
                    {s.count != null ? (
                      <span className="ms-auto text-xs font-bold opacity-70">{s.count}</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })()}

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

      {/* ===== TASK LIST =====
          Leads-style table layout — every column from the לידים screen
          (לקוח / סטטוס / שם מודעה / SLA / מקור / נציג / תאריך) plus a
          dedicated "משימה" column with the task type, status, due time,
          summary, and a quick "סיים משימה" shortcut. Reuses DataTable so
          row numbering, hover, click-to-edit, and loading skeletons all
          match the rest of the app. */}
      <div className="space-y-3">
        {!isLoading && finalVisibleTasks.length === 0 ? (
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
          <DataTable
            columns={taskTableColumns}
            data={finalVisibleTasks}
            isLoading={isLoading}
            emptyMessage="לא נמצאו משימות"
            onRowClick={handleOpenTaskDetails}
            tableClassName="table-fixed min-w-[1280px]"
            // "Due now" — task is open, has a due_date, and that time
            // falls in a ±60 min window of the current clock. Wrap the
            // row in a soft amber pulse so the rep eyeballs which call
            // is up *right now* without scanning timestamps.
            rowClassName={(row) => {
              if (row.task_status !== 'not_completed' || !row.due_date) return '';
              const due = parseDbTimestamp(row.due_date)?.getTime();
              if (!due) return '';
              const diff = Math.abs(due - Date.now());
              return diff <= DUE_NOW_WINDOW_MS ? 'animate-pulse bg-amber-50 hover:bg-amber-100/70' : '';
            }}
          />
        )}

        {hasMoreTasks && (
          // Auto-load sentinel — scrolling near it appends the next 100 rows.
          // The button is a manual fallback (keyboard / observer unavailable).
          <div
            ref={loadMoreRef}
            className="flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border shadow-card"
          >
            <span className="text-xs text-muted-foreground/70">
              מציג {paginatedTasks.length} מתוך {totalFilteredCount} משימות · טוען עוד…
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
      <SalesTaskDialog
        isOpen={showNewTaskDialog}
        onClose={() => setShowNewTaskDialog(false)}
        effectiveUser={effectiveUser}
      />

      {/* Import Tasks Dialog */}
      <ImportSalesTasks isOpen={showImportDialog} onClose={() => setShowImportDialog(false)} />

      {/* Edit Task Dialog */}
      <SalesTaskDialog
        isOpen={showEditTaskDialog}
        onClose={() => setShowEditTaskDialog(false)}
        task={editingTask}
        effectiveUser={effectiveUser}
      />

      {/* Complete-task dialog opened by the row's "סיים משימה" button */}
      <CompleteTaskDialog
        isOpen={!!completingTask}
        task={completingTask}
        onClose={() => setCompletingTask(null)}
      />
    </div>
  );
}