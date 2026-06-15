import React, { useMemo, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { cancelOpenTasksForClosedDeal } from '@/lib/dealClose';
import StatusBadge from '@/components/shared/StatusBadge';
import { getRepDisplayName } from '@/lib/repDisplay';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from
"@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";
import {
  ArrowRight,
  Save,
  Loader2,
  MessageCircle,
  FileText,
  Clock,
  User,
  Tag,
  CheckCircle2,
  XCircle,
  Ban,
  AlertCircle,
  MoreVertical,
  Headphones,
  ShoppingBag,
  AlertTriangle,
  Crown,
  Plus,
  Activity,
  History,
  Phone,
  Mail,
  MapPin,
  Home,
  Globe,
  StickyNote,
  MessageSquare,
  CalendarDays,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import SLABadge from '@/components/sla/SLABadge';
import CommunicationHistory from '@/components/lead/CommunicationHistory';
import AddCommunication from '@/components/lead/AddCommunication';
import RepCard from '@/components/lead/RepCard';
import LeadMarketingSection from '@/components/lead/LeadMarketingSection';
import { leadMarketingFieldLabels } from '@/constants/leadMarketingFields';
import { formatDistanceToNow, addHours, addDays, startOfDay, format } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { Badge } from "@/components/ui/badge";
import SalesTaskDialog from '@/components/task/SalesTaskDialog';
import LeadActivityTimeline from '@/components/lead/LeadActivityTimeline';
import LeadWorkbenchQueue from '@/components/lead/LeadWorkbenchQueue';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { createAuditLog } from '@/utils/auditLog';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, TASK_TYPE_LABELS, SOURCE_LABELS } from '@/constants/leadOptions';
import { useHiddenStatuses, getVisibleStatusOptions } from '@/hooks/useHiddenStatuses';
import StatusOptionRow from '@/components/shared/StatusOptionRow';
import { canViewLead } from '@/components/shared/rbac';
import { canEditPrimaryRep, canEditSecondaryRep } from '@/lib/rbac';
import { buildLeadWorkbenchState } from '@/lib/leadWorkbench';

export default function LeadDetails({ leadId: leadIdProp, initialMode: initialModeProp, isModal = false, onClose }) {
  const navigate = useNavigate();
  const { getEffectiveUser } = useImpersonation();
  const urlParams = new URLSearchParams(window.location.search);
  // When rendered as a popup the id/mode arrive as props and the URL is
  // left completely untouched, so the list page underneath keeps its
  // address, scroll and filters. Opened as a full page (deep link,
  // dashboard widget, global search) it falls back to the query string.
  const leadId = leadIdProp ?? urlParams.get('id');
  const initialMode = initialModeProp ?? (urlParams.get('mode') === 'service' ? 'service' : 'sales');

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [showAddCommunication, setShowAddCommunication] = useState(false);
  const [showEditTaskDialog, setShowEditTaskDialog] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  // Gating dialog for "משימה חדשה" on unassigned leads — instead of
  // letting the rep open a task on a lead that has no owner (and then
  // wondering who's supposed to do it), we intercept and require an
  // assignment first. Holds the candidate rep email until confirmed.
  const [assignBeforeTaskRep, setAssignBeforeTaskRep] = useState('');
  const [showAssignBeforeTask, setShowAssignBeforeTask] = useState(false);
  const [isAssigningBeforeTask, setIsAssigningBeforeTask] = useState(false);
  const [noAnswerFlow, setNoAnswerFlow] = useState(null); // { status, label, selectedHours }
  const [followupFlow, setFollowupFlow] = useState(null); // { selectedDay, selectedHour }
  // The old `workMode` state (sales vs service) was removed when we
  // collapsed the two modes into a single unified lead screen. Sales
  // and service info now live side-by-side, the service section is a
  // permanent card in the main column, and the only cross-functional
  // signal is the open-tickets badge in the header. `initialMode` is
  // still accepted as a prop for backwards-compat with any caller
  // that passes it; it's just ignored.
  void initialMode;
  const { hiddenStatuses } = useHiddenStatuses();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleClickToCall = async (phone) => {
    if (!phone) return;
    try {
      toast({ title: "מתחיל שיחה...", description: phone });
      await base44.functions.invoke('clickToCall', { customerPhone: phone, leadId });
      toast({ title: "השיחה התחילה בהצלחה" });
    } catch (err) {
      toast({
        title: "שגיאה בהתחלת שיחה",
        description: err?.response?.data?.error || err.message,
        variant: "destructive",
      });
    }
  };

  // All queries fire in parallel - no dependencies between them
  const { data: user = null } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 300000,
  });

  const effectiveUser = getEffectiveUser(user);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => base44.entities.Lead.filter({ id: leadId }).then(r => r[0] || null),
    enabled: !!leadId,
    staleTime: 5000,
  });

  const canViewCurrentLead = !!lead && canViewLead(effectiveUser, lead);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', leadId],
    queryFn: () => base44.entities.SalesTask.filter({ lead_id: leadId }),
    enabled: !!leadId && canViewCurrentLead,
    staleTime: 120000,
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes', leadId],
    queryFn: () => base44.entities.Quote.filter({ lead_id: leadId }),
    enabled: !!leadId && canViewCurrentLead,
    staleTime: 120000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders-by-lead', leadId],
    queryFn: () => base44.entities.Order.filter({ lead_id: leadId }),
    enabled: !!leadId && canViewCurrentLead,
    staleTime: 120000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 300000,
  });

  const linkedOrderIds = useMemo(
    () => [...new Set(orders.map((order) => order?.id).filter(Boolean))],
    [orders]
  );

  const { data: serviceTickets = [] } = useQuery({
    queryKey: ['lead-service-tickets', leadId, linkedOrderIds.join('|')],
    queryFn: async () => {
      if (linkedOrderIds.length === 0) return [];
      const ticketBatches = await Promise.all(
        linkedOrderIds.map((orderId) => base44.entities.SupportTicket.filter({ order_id: orderId }))
      );
      const deduped = new Map();
      ticketBatches.flat().forEach((ticket) => {
        if (ticket?.id) deduped.set(ticket.id, ticket);
      });
      return [...deduped.values()];
    },
    enabled: !!leadId && canViewCurrentLead && linkedOrderIds.length > 0,
    staleTime: 120000,
  });

  const openServiceTicketsCount = useMemo(
    () => serviceTickets.filter(
      (ticket) => !['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase())
    ).length,
    [serviceTickets]
  );

  // Sync form data when lead loads or updates (for real-time status changes)
  const leadUpdatedDate = lead?.updated_date;
  React.useEffect(() => {
    if (lead && !isEditing) setFormData(lead);
  }, [leadUpdatedDate, isEditing]);

  // The URL ?mode=service sync useEffect was removed alongside the
  // sales/service toggle — the lead screen no longer has modes, so
  // there's nothing to sync. ?mode query params on existing bookmarks
  // are simply ignored (initialMode prop is no-op now).

  // Real-time subscription: auto-refresh lead when it changes (e.g. status updated from task dialog)
  useEffect(() => {
    if (!leadId) return;
    const unsubscribe = base44.entities.Lead.subscribe((event) => {
      if (event.id === leadId) {
        queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      }
    });
    return unsubscribe;
  }, [leadId, queryClient]);

  const updateLeadMutation = useMutation({
    mutationFn: (data) => base44.entities.Lead.update(leadId, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries(['lead', leadId]);
      queryClient.invalidateQueries(['leadActivityLogs', leadId]);
      setIsEditing(false);
      // When the rep flips the lead to "נסגרה עסקה" via the status
      // dropdown, jump straight into the New Order form with the
      // customer pre-filled — same flow as the CompleteTaskDialog
      // 'deal_closed' outcome, just reached from a different surface.
      if (variables?.status === 'deal_closed' && lead?.status !== 'deal_closed') {
        cancelOpenTasksForClosedDeal(leadId).catch(() => {});
        navigate(`${createPageUrl('NewOrder')}?leadId=${leadId}`);
      }
    }
  });

  const convertToCustomerMutation = useMutation({
    mutationFn: async () => {
      // Check if customer already exists
      const existingCustomers = await base44.entities.Customer.filter({ phone: lead.phone });
      if (existingCustomers.length > 0) {
        throw new Error('לקוח כבר קיים במערכת');
      }

      // Create customer
      const customer = await base44.entities.Customer.create({
        full_name: lead.full_name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        city: lead.city,
        lead_id: leadId,
        original_source: lead.source,
        total_orders: 0,
        total_revenue: 0,
        lifetime_value: 0,
        account_manager: lead.rep1 || effectiveUser?.email
      });

      // Update lead status to won
      await base44.entities.Lead.update(leadId, { status: 'won' });

      await createAuditLog({
        leadId,
        actionType: 'converted_to_customer',
        description: `${user?.full_name || 'משתמש'} המיר את הליד ללקוח`,
        user,
      });

      return customer;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries(['lead', leadId]);
      navigate(createPageUrl('CustomerDetails') + `?id=${customer.id}`);
    }
  });

  const isAdmin = effectiveUser?.role === 'admin';
  const canEdit = isAdmin || lead?.rep1 === effectiveUser?.email || lead?.rep2 === effectiveUser?.email || lead?.pending_rep_email === effectiveUser?.email;
  const canEditLeadRep1 = canEditPrimaryRep(effectiveUser);
  const canEditLeadRep2 = canEditSecondaryRep(effectiveUser, lead);
  const historicalTasks = useMemo(
    () => tasks.filter((task) => String(task?.task_status || '').toLowerCase() !== 'not_completed'),
    [tasks]
  );
  const workbenchState = useMemo(() => buildLeadWorkbenchState({
    tasks,
  }), [tasks]);

  const handleSave = async () => {
    const { id, created_date, updated_date, created_by, ...updateData } = formData;

    // Audit log for each changed field
    const fieldLabels = {
      full_name: 'שם',
      phone: 'טלפון',
      email: 'אימייל',
      city: 'עיר',
      address: 'כתובת',
      status: 'סטטוס',
      source: 'מקור',
      rep1: 'נציג ראשי',
      rep2: 'נציג משני',
      notes: 'הערות',
      ...leadMarketingFieldLabels,
    };
    const fieldsToCheck = Object.keys(fieldLabels);

    for (const field of fieldsToCheck) {
      if (formData[field] !== lead[field] && (formData[field] || lead[field])) {
        const isRep = field === 'rep1' || field === 'rep2';
        await createAuditLog({
          leadId,
          actionType: isRep ? 'rep_changed' : field === 'status' ? 'status_changed' : 'field_updated',
          description: `${user.full_name} שינה ${fieldLabels[field]}: "${lead[field] || '(ריק)'}" → "${formData[field] || '(ריק)'}"`,
          user,
          fieldName: field,
          oldValue: lead[field],
          newValue: formData[field],
        });
      }
    }

    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
    updateLeadMutation.mutate(updateData);
  };

  const handleWorkbenchAction = (item, action) => {
    if (!action) return;

    switch (action) {
      case 'open_task': {
        const selectedTask = tasks.find((task) => String(task.id) === String(item?.id));
        if (selectedTask) {
          setEditingTask(selectedTask);
          setShowEditTaskDialog(true);
          return;
        }
        navigate(createPageUrl('SalesTasks'));
        return;
      }
      case 'new_task':
      case 'empty':
        requestAddTask();
        return;
      default:
        return;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>);

  }

  if (!lead) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">הליד לא נמצא</p>
        {isModal ? (
          <Button className="mt-4" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Leads')}>
            <Button className="mt-4">חזור לרשימת הלידים</Button>
          </Link>
        )}
      </div>);

  }

  if (!isAdmin && lead.rep1 !== effectiveUser?.email && lead.rep2 !== effectiveUser?.email && lead.pending_rep_email !== effectiveUser?.email) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg font-medium">אין לך הרשאות לצפות בליד זה כיוון שאינו משויך אליך.</p>
        {isModal ? (
          <Button className="mt-4 bg-primary hover:bg-primary/90" onClick={onClose}>סגור</Button>
        ) : (
          <Link to={createPageUrl('Leads')}>
            <Button className="mt-4 bg-primary hover:bg-primary/90">חזור לרשימת הלידים</Button>
          </Link>
        )}
      </div>
    );
  }

  const salesReps = users.filter((u) => u.role === 'user' || u.role === 'admin');

  const handleQuickAssignRep1 = async (email) => {
    const repName = salesReps.find(r => r.email === email)?.full_name || email;

    try {
      const openAssignmentTasks = tasks.filter(t =>
        t.task_status === 'not_completed' && (!t.rep1 || t.task_type === 'assignment')
      );

      const assignerName = user?.full_name || 'מנהל';

      if (openAssignmentTasks.length > 0) {
        await Promise.all(openAssignmentTasks.map(t =>
          base44.entities.SalesTask.update(t.id, {
            task_status: 'completed',
            rep1: email,
            summary: `${assignerName} שייך את הליד לנציג ${repName}`,
          })
        ));
      } else {
        await base44.entities.SalesTask.create({
          lead_id: leadId,
          rep1: email,
          task_type: 'assignment',
          task_status: 'completed',
          summary: `${assignerName} שייך את הליד לנציג ${repName}`,
          work_start_date: new Date().toISOString(),
        });
      }

      // 3. Create a call task for the new rep (due in 3 hours)
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 3);
      await base44.entities.SalesTask.create({
        lead_id: leadId,
        rep1: email,
        task_type: 'call',
        task_status: 'not_completed',
        summary: `יש להתקשר ללקוח ${lead.full_name || ''}`,
        due_date: dueDate.toISOString(),
        work_start_date: new Date().toISOString(),
        status: lead.status || 'new_lead',
      });

      // 4. Audit log
      await createAuditLog({
        leadId,
        actionType: 'rep_assigned',
        description: `${user.full_name} שייך את הליד לנציג ${repName}`,
        user,
        fieldName: 'rep1',
        oldValue: lead.rep1 || 'לא משויך',
        newValue: email,
      });

      // 5. Update lead
      updateLeadMutation.mutate({ rep1: email });
      queryClient.invalidateQueries(['tasks', leadId]);
      queryClient.invalidateQueries(['leadActivityLogs', leadId]);
    } catch (error) {
      // Assignment error - non-critical
    }
  };

  // Single entry point for "open the add-task dialog". If the lead
  // already has a primary rep, opens the dialog directly. If not,
  // intercepts with the assign-first gate so a task can never be
  // attached to an owner-less lead. Every "משימה חדשה" trigger in
  // this screen goes through here.
  const requestAddTask = () => {
    if (lead?.rep1) {
      setShowAddTaskDialog(true);
    } else {
      setAssignBeforeTaskRep('');
      setShowAssignBeforeTask(true);
    }
  };

  // Confirm handler for the assign-first gate: assigns the chosen rep
  // via the existing full quick-assign flow (which also creates the
  // standard call-back task and audit log), then immediately opens
  // the add-task dialog so the user lands exactly where they tried
  // to go in the first place — no second click required.
  const confirmAssignThenAddTask = async () => {
    if (!assignBeforeTaskRep || isAssigningBeforeTask) return;
    setIsAssigningBeforeTask(true);
    try {
      await handleQuickAssignRep1(assignBeforeTaskRep);
      setShowAssignBeforeTask(false);
      setShowAddTaskDialog(true);
    } finally {
      setIsAssigningBeforeTask(false);
    }
  };

  const handleQuickAssignRep2 = async (email) => {
    const repName = salesReps.find(r => r.email === email)?.full_name || email;

    const openAssignmentTasks = tasks.filter(t =>
      t.task_status === 'not_completed' && (!t.rep1 || t.task_type === 'assignment')
    );

    if (openAssignmentTasks.length > 0) {
      await Promise.all(openAssignmentTasks.map(t =>
        base44.entities.SalesTask.update(t.id, { task_status: 'completed' })
      ));
    } else {
      await base44.entities.SalesTask.create({
        lead_id: leadId,
        rep2: email,
        task_type: 'assignment',
        task_status: 'completed',
        summary: `שיוך נציג משני: ${repName}`,
        work_start_date: new Date().toISOString(),
      });
    }

    await createAuditLog({
      leadId,
      actionType: 'rep_changed',
      description: `${user.full_name} שייך נציג משני: ${repName}`,
      user,
      fieldName: 'rep2',
      oldValue: lead.rep2 || 'לא משויך',
      newValue: email,
    });

    updateLeadMutation.mutate({ rep2: email });
    queryClient.invalidateQueries(['tasks', leadId]);
    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
  };

  return (
    /* In modal mode the LeadDetails IS the dialog body — it takes the
       full dialog height and splits into a frozen top region (name +
       action bar) and a scrollable body, so the header is genuinely
       fixed instead of relying on sticky inside a portal/transform
       context where sticky was unreliable. Full-page mode keeps the
       original space-y-6 vertical flow. */
    <div className={isModal ? 'flex flex-col h-full overflow-hidden' : 'space-y-6'}>
      {/* Header — name, status, SLA, mode toggle. In popup mode it's
          flex-shrink-0 so it never scrolls; pe-12 reserves room for
          the Radix close-X that sits in the dialog's right corner. */}
      <div className={
        `flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4` +
        (isModal
          ? ' flex-shrink-0 px-6 pt-5 pb-3 pe-12 bg-card border-b border-border'
          : '')
      }>
        <div className="flex items-center gap-3">
          {isModal ? (
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={onClose} title="סגור">
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Link to={createPageUrl('Leads')}>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">{lead.full_name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={lead.status} />
              <SLABadge lead={lead} />
            </div>
          </div>
        </div>

        {/* Open-tickets alert: replaces the old "sales / service mode"
            toggle. Now that the lead screen shows sales and service
            together in one scroll (no mode switching), this badge is
            the one cross-functional signal a sales rep needs — "this
            customer has open service issues" — and clicking it jumps
            them straight to the service section. Hidden when there
            are no open tickets so the header stays clean. */}
        {openServiceTicketsCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              document.getElementById('lead-service-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
            title="עבור לאזור פניות השירות"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {openServiceTicketsCount === 1 ? 'קריאת שירות פתוחה' : `${openServiceTicketsCount} קריאות שירות פתוחות`}
          </button>
        ) : null}
      </div>

      <div className="lg:hidden flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => handleClickToCall(lead.phone)}
          disabled={!lead.phone}
          className="flex-1 min-w-[120px] justify-center h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Phone className="h-3.5 w-3.5 me-1.5" />
          חייג
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={requestAddTask}
          className="flex-1 min-w-[120px] justify-center h-9 text-xs"
        >
          <Clock className="h-3.5 w-3.5 me-1.5" />
          משימה חדשה
        </Button>
        <Link to={createPageUrl('NewQuote') + `?lead_id=${leadId}`} className="flex-1 min-w-[120px]">
          <Button
            size="sm"
            className="w-full justify-center h-9 text-xs"
          >
            <FileText className="h-3.5 w-3.5 me-1.5" />
            הצעה חדשה
          </Button>
        </Link>
      </div>

      {/* Action bar — חייג / משימה / הצעה. Always one click away
          while reading the lead. In page mode it sticks below the
          global chrome (top-16). In popup mode it sits as a
          flex-shrink-0 sibling of the header — genuinely fixed at
          the top of the dialog, no sticky involved. The old
          sales/service mode toggle that used to live here was
          removed in favor of a single unified lead screen. */}
      <div className={
        isModal
          ? 'hidden lg:flex flex-shrink-0 items-center justify-end gap-2 border-b border-border bg-background/95 backdrop-blur px-6 py-2'
          : 'hidden lg:flex sticky top-16 z-10 items-center justify-end gap-2 rounded-xl border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-card'
      }>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => handleClickToCall(lead.phone)}
            disabled={!lead.phone}
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Phone className="h-3.5 w-3.5 me-1" />
            חייג
          </Button>
          <Button variant="outline" size="sm" onClick={requestAddTask} className="h-8 text-xs">
            <Clock className="h-3.5 w-3.5 me-1" />
            משימה חדשה
          </Button>
          <Link to={createPageUrl('NewQuote') + `?lead_id=${leadId}`}>
            <Button size="sm" className="h-8 text-xs">
              <FileText className="h-3.5 w-3.5 me-1" />
              הצעה חדשה
            </Button>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" dir="rtl">
              {lead.status !== 'won' ? (
                <DropdownMenuItem
                  onClick={() => convertToCustomerMutation.mutate()}
                  disabled={convertToCustomerMutation.isPending}
                >
                  <Crown className="h-3.5 w-3.5 me-2" />
                  המר ללקוח
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setShowAddCommunication(true)}>
                <MessageCircle className="h-3.5 w-3.5 me-2" />
                הוסף תקשורת
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scrollable body. In modal mode this is the only thing inside
          the dialog that actually scrolls — the header + action bar
          above are fixed flex-shrink-0 siblings, so they NEVER move
          and NEVER get occluded by content scrolling under them. In
          full-page mode this is a passive wrapper that preserves the
          original space-y-6 rhythm. */}
      <div className={isModal ? 'flex-1 overflow-auto px-6 pb-6 pt-4 space-y-6' : 'space-y-6'}>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-4">
          <LeadWorkbenchQueue state={workbenchState} onAction={handleWorkbenchAction} />
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold">פרטי לקוח</CardTitle>
              {canEdit &&
              <Button
                variant={isEditing ? "default" : "outline"}
                size="sm"
                onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                disabled={updateLeadMutation.isPending} className="h-8 text-xs px-3">

                  {updateLeadMutation.isPending ?
                <Loader2 className="h-4 w-4 animate-spin" /> :
                isEditing ?
                <>
                      <Save className="h-4 w-4 me-2" />
                      שמור
                    </> :

                'ערוך'
                }
                </Button>
              }
            </CardHeader>
            <CardContent className="p-5">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">שם מלא</Label>
                      <Input value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">טלפון</Label>
                      <Input value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">אימייל</Label>
                      <Input type="email" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">עיר</Label>
                      <Input value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="h-9" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">כתובת</Label>
                    <AddressAutocomplete
                      value={formData.address || ''}
                      onChange={(value, details) => {
                        setFormData((prev) => ({
                          ...prev,
                          address: value,
                          ...(details?.city ? { city: details.city } : {}),
                        }));
                      }}
                      className="h-9"
                      placeholder="התחל להקליד..."
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">סטטוס</Label>
                      <Select value={formData.status || ''} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LEAD_STATUS_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <StatusOptionRow status={opt.value} label={opt.label} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">מקור</Label>
                      <Select value={formData.source || ''} onValueChange={(value) => setFormData({ ...formData, source: value })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LEAD_SOURCE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">הערות</Label>
                    <Textarea value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
                  </div>
                </div>
              ) : (
                /* Compact, Google-card-style detail list. Replaced the
                   old two-column DetailField grid (label on top, big
                   value below, border-t between every section) — that
                   layout was airy by design but wasted vertical space
                   even when most fields were empty. The new structure:
                   one row per field with a small leading icon, slim
                   label, value on the left, rows with no value HIDDEN
                   entirely so a sparse lead doesn't show six empty
                   "-"s. dir is left at default (RTL) so even phone /
                   email values render aligned to the right edge next
                   to their label — the digits inside stay LTR-readable
                   thanks to browser bidi without forcing the whole
                   cell to switch sides. */
                <dl className="divide-y divide-border/30">
                  {[
                    { label: 'שם מלא',     value: lead.full_name,                                       icon: User },
                    { label: 'טלפון',      value: lead.phone,                                           icon: Phone },
                    { label: 'אימייל',     value: lead.email,                                           icon: Mail },
                    { label: 'עיר',        value: lead.city,                                            icon: MapPin },
                    { label: 'כתובת',      value: lead.address,                                         icon: Home },
                    { label: 'מקור',       value: SOURCE_LABELS[lead.source] || lead.source,            icon: Globe },
                    { label: 'טופס מקור',  value: lead.source_form,                                     icon: FileText },
                    { label: 'נושא הפנייה', value: lead.subject,                                        icon: MessageSquare },
                    { label: 'הערות',      value: lead.notes, whitespace: 'pre-wrap',                   icon: StickyNote },
                  ]
                    .filter((row) => row.value)
                    .map((row) => {
                      const Icon = row.icon;
                      return (
                        <div key={row.label} className="flex items-baseline gap-3 py-3">
                          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground/80 w-28 flex-shrink-0">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                            <span>{row.label}</span>
                          </dt>
                          <dd
                            className={`text-sm text-foreground min-w-0 flex-1 ${row.whitespace === 'pre-wrap' ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                          >
                            {row.value}
                          </dd>
                        </div>
                      );
                    })}

                  {/* Tags inline as their own row — only when present.
                      Keeps the visual rhythm of the rest of the list. */}
                  {Array.isArray(lead.tags) && lead.tags.length > 0 ? (
                    <div className="flex items-baseline gap-3 py-3">
                      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground/80 w-28 flex-shrink-0">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                        <span>תגיות</span>
                      </dt>
                      <dd className="flex flex-wrap gap-1.5 min-w-0 flex-1">
                        {lead.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-md bg-indigo-100 text-indigo-800 text-[11px] font-medium px-1.5 py-0.5"
                          >
                            #{tag}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ) : null}

                  {/* Created / updated timestamps — kept as a single
                      muted footer row so they don't compete with the
                      contact details above. */}
                  {lead.created_date || lead.updated_date ? (
                    <div className="flex items-baseline gap-3 py-3 text-xs text-muted-foreground/70">
                      <dt className="flex items-center gap-1.5 w-28 flex-shrink-0">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                        <span>תאריכים</span>
                      </dt>
                      <dd className="min-w-0 flex-1 flex flex-wrap gap-x-4 gap-y-1">
                        {lead.created_date ? (
                          <span>נוצר: {formatInTimeZone(lead.created_date, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')}</span>
                        ) : null}
                        {lead.updated_date ? (
                          <span>עודכן: {formatInTimeZone(lead.updated_date, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')}</span>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                היסטוריית משימות ({historicalTasks.length})
              </CardTitle>
              <Button variant="outline" size="sm" onClick={requestAddTask}>
                <Plus className="h-4 w-4 me-2" />
                הוסף משימה
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {historicalTasks.length === 0 ? (
                <div className="px-4 py-5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">אין משימות סגורות/היסטוריות כרגע.</span>
                  <Button size="sm" variant="outline" onClick={requestAddTask}>
                    <Plus className="h-3.5 w-3.5 me-1" />
                    משימה חדשה
                  </Button>
                </div>
              ) : (
                <Tabs defaultValue="completed" className="w-full" dir="rtl">
                  <div className="border-b border-border/50 px-2 pt-2">
                    <TabsList className="w-full h-auto p-1 gap-1 bg-muted/80 rounded-xl flex flex-row flex-nowrap overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                      <TabsTrigger value="completed" className="group flex-shrink-0 whitespace-nowrap h-9 px-3 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm transition-colors">
                        <CheckCircle2 className="w-3.5 h-3.5 me-1.5 inline-block" /> בוצע
                        <span className="ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none bg-muted text-muted-foreground group-data-[state=active]:bg-white/25 group-data-[state=active]:text-white">{historicalTasks.filter(t => t.task_status === 'completed').length}</span>
                      </TabsTrigger>
                      <TabsTrigger value="not_done" className="flex-shrink-0 whitespace-nowrap h-9 px-3 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-red-50 hover:text-red-700 data-[state=active]:bg-red-600 data-[state=active]:text-white data-[state=active]:shadow-sm transition-colors">
                        <XCircle className="w-3.5 h-3.5 me-1.5 inline-block" /> לא בוצע
                      </TabsTrigger>
                      <TabsTrigger value="cancelled" className="flex-shrink-0 whitespace-nowrap h-9 px-3 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-foreground/80 data-[state=active]:text-white data-[state=active]:shadow-sm transition-colors">
                        <Ban className="w-3.5 h-3.5 me-1.5 inline-block" /> בוטל
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {['completed', 'not_done', 'cancelled'].map(statusKey => {
                    const filteredTasks = historicalTasks
                      .filter(t => t.task_status === statusKey)
                      .sort((a, b) => {
                        // Sort completed/not_done/cancelled by updated_date descending (most recent first)
                        const dateA = a.updated_date ? new Date(a.updated_date).getTime() : new Date(a.created_date || 0).getTime();
                        const dateB = b.updated_date ? new Date(b.updated_date).getTime() : new Date(b.created_date || 0).getTime();
                        return dateB - dateA;
                      });

                    return (
                      <TabsContent key={statusKey} value={statusKey} className="mt-3 p-2">
                        {filteredTasks.length === 0 ? (
                          <div className="flex flex-col items-center gap-2 py-8">
                            <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                              <Clock className="h-5 w-5 text-muted-foreground/40" />
                            </div>
                            <p className="text-muted-foreground/70 text-sm">אין משימות</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {filteredTasks.map((task) => {
                              const taskTypeLabel = {
                                call: 'שיחה', whatsapp: 'וואטסאפ', email: 'מייל', meeting: 'פגישה',
                                quote_preparation: 'הצעת מחיר', followup: 'מעקב', assignment: 'שיוך', other: 'אחר',
                              }[task.task_type] || 'אחר';

                              const dueDate = task.due_date ? new Date(task.due_date) : null;
                              const isDone = task.task_status === 'completed';
                              
                              const taskStatusStyle = {
                                not_completed: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
                                completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                                not_done: 'bg-red-50 text-red-700 ring-1 ring-red-200',
                                cancelled: 'bg-muted text-muted-foreground ring-1 ring-border',
                              }[task.task_status] || 'bg-muted/50 text-muted-foreground ring-1 ring-border';

                              const taskStatusLabel = {
                                not_completed: 'ממתין', completed: 'בוצע', not_done: 'לא בוצע', cancelled: 'בוטל',
                              }[task.task_status] || task.task_status;

                              const dueDateDisplay = dueDate
                                ? formatInTimeZone(dueDate, 'Asia/Jerusalem', 'dd/MM HH:mm')
                                : '';

                              const cardBgClass = {
                                not_completed: 'bg-orange-50/60 hover:bg-orange-100/60 border-orange-100',
                                completed: 'bg-green-50/60 hover:bg-green-100/60 border-green-100',
                                not_done: 'bg-red-50/60 hover:bg-red-100/60 border-red-100',
                                cancelled: 'bg-muted/50 hover:bg-muted border-border',
                              }[task.task_status] || 'bg-card hover:bg-muted/50 border-border';

                              return (
                                <div
                                  key={task.id}
                                  onClick={() => { setEditingTask(task); setShowEditTaskDialog(true); }}
                                  className={`relative p-4 border rounded-xl shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md ${cardBgClass} ${isDone ? 'opacity-70' : ''}`}
                                >
                                  {/* Delete button removed - tasks can only be deleted from detail view */}

                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center pe-6">
                                    
                                    {/* רבע 1: לקוח ונציג */}
                                    <div className="flex flex-col gap-1.5 text-start overflow-hidden">
                                      <span className="font-bold text-base text-foreground truncate">
                                        {lead?.full_name || 'ליד לא ידוע'}
                                      </span>
                                      <div className="text-sm text-muted-foreground truncate">
                                        נציג מטפל: {task.rep1 ? getRepDisplayName(task.rep1, users) : 'לא משויך'}
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
                                          {formatInTimeZone(task.created_date || task.manual_created_date || new Date().toISOString(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground">תאריך יעד:</span>
                                        <span dir="ltr" className="tabular-nums font-medium">
                                          {dueDateDisplay || 'ללא יעד'}
                                        </span>
                                      </div>
                                    </div>

                                    {/* רבע 4: זמן נותר/עבר */}
                                    <div className="flex flex-col items-end justify-center gap-2 h-full">
                                      <div className="flex-1 flex items-center">
                                        {dueDate && task.task_status !== 'completed' && task.task_status !== 'cancelled' && (
                                          <span className="font-bold text-sm text-blue-800">
                                            בעוד
                                            {formatDistanceToNow(dueDate, { locale: he })}
                                          </span>
                                        )}
                                      </div>
                                      {(statusKey === 'completed' || statusKey === 'not_done') && task.updated_date && (
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 tabular-nums ${
                                          statusKey === 'completed' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-600 ring-1 ring-red-200'
                                        }`}>
                                          {statusKey === 'completed' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                          <span dir="ltr">
                                            {task.updated_date ? formatInTimeZone(task.updated_date, 'Asia/Jerusalem', 'dd/MM HH:mm') : '-'}
                                          </span>
                                        </span>
                                      )}
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
                            })}
                          </div>
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              )}
            </CardContent>
          </Card>

          {/* Communication History — temporarily hidden per product
              decision. The card was almost always empty for new
              leads, which made it dead visual weight. The
              <CommunicationHistory /> component, the AddCommunication
              dialog wiring, and the import above are all kept so
              this is a one-line revert when we're ready to bring it
              back. */}
          {false && (
            <Card className="rounded-xl border-border shadow-card overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground" />
                  היסטוריית תקשורת
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddCommunication(true)}>

                  <Plus className="h-4 w-4 me-2" />
                  הוסף
                </Button>
              </CardHeader>
              <CardContent>
                <CommunicationHistory leadId={leadId} />
              </CardContent>
            </Card>
          )}

          {/* Service section — always visible, no mode toggle.
              Replaces the old "switch to service mode" pattern with a
              permanent card so a sales rep doing day-to-day work
              never misses that their customer has an open ticket, and
              a service rep doing follow-ups never has to switch
              context to see the sales history. The header alert badge
              scrolls smoothly here via this id. */}
          <Card id="lead-service-section" className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                שירות
                {openServiceTicketsCount > 0 ? (
                  <Badge variant="warning">{openServiceTicketsCount} פתוחות</Badge>
                ) : null}
              </CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  {linkedOrderIds.length} {linkedOrderIds.length === 1 ? 'הזמנה מקושרת' : 'הזמנות מקושרות'}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {linkedOrderIds.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  ללקוח אין הזמנות פעילות, ולכן אין נתיב לפתיחת קריאת שירות מכאן.
                  קריאת שירות נפתחת תמיד מתוך הזמנה קיימת.
                </div>
              ) : serviceTickets.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  אין קריאות שירות פתוחות או היסטוריות עבור ההזמנות של הלקוח.
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Open tickets first, then resolved/closed by recency.
                      Open ones get an amber tint so they pop visually
                      when a rep glances at this section. */}
                  {[...serviceTickets]
                    .sort((a, b) => {
                      const aOpen = !['resolved', 'closed'].includes(String(a.status || '').toLowerCase());
                      const bOpen = !['resolved', 'closed'].includes(String(b.status || '').toLowerCase());
                      if (aOpen !== bOpen) return aOpen ? -1 : 1;
                      return new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0);
                    })
                    .map((ticket) => {
                      const isOpen = !['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase());
                      return (
                        <Link
                          key={ticket.id}
                          to={createPageUrl('TicketDetails') + `?id=${ticket.id}`}
                          className={`block border rounded-lg p-3 transition-colors ${isOpen ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-border hover:bg-muted/40'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">
                              #{ticket.ticket_number || ticket.id?.slice(0, 6)}
                            </span>
                            <StatusBadge status={ticket.status} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{ticket.subject || 'פניית שירות'}</p>
                        </Link>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                לוג פעולות
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <LeadActivityTimeline leadId={leadId} />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Lead Status */}
          <Card className="rounded-xl border-blue-200 shadow-card overflow-hidden bg-blue-50/60">
            <CardContent className="p-4 space-y-2">
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">סטטוס ליד</span>
              {canEdit ? (
                <Select
                  value={formData.status || ''}
                  onValueChange={(value) => {
                    const NO_ANSWER_MAP = {
                      no_answer_1: 'ללא מענה 1',
                      no_answer_2: 'ללא מענה 2',
                      no_answer_3: 'ללא מענה 3',
                      no_answer_4: 'ללא מענה 4',
                    };
                    setFormData({ ...formData, status: value });
                    if (!isEditing) {
                      if (NO_ANSWER_MAP[value]) {
                        setNoAnswerFlow({ status: value, label: NO_ANSWER_MAP[value], selectedHours: null });
                        setFollowupFlow(null);
                      } else if (value === 'followup_before_quote' || value === 'followup_after_quote') {
                        setFollowupFlow({ selectedDate: null, selectedHour: null, status: value });
                        setNoAnswerFlow(null);
                      } else {
                        setNoAnswerFlow(null);
                        setFollowupFlow(null);
                        createAuditLog({
                          leadId,
                          actionType: 'status_changed',
                          description: `${user.full_name} שינה סטטוס: "${lead.status}" → "${value}"`,
                          user,
                          fieldName: 'status',
                          oldValue: lead.status,
                          newValue: value,
                        });
                        updateLeadMutation.mutate({ status: value });
                        queryClient.invalidateQueries(['leadActivityLogs', leadId]);
                      }
                    }
                  }}>
                  <SelectTrigger className="bg-white border-blue-200 h-10 text-sm font-semibold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getVisibleStatusOptions(hiddenStatuses, lead.status).map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <StatusOptionRow status={opt.value} label={opt.label} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <StatusBadge status={lead.status} />
              )}
            </CardContent>
          </Card>

          {/* Lead Insights */}
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                תמונת מצב
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">גיל הליד</span>
                <span className="text-sm font-medium text-foreground">
                  {lead.created_date ? formatDistanceToNow(lead.created_date, { locale: he }) : '-'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">עדכון אחרון</span>
                <span className="text-sm font-medium text-foreground">
                  {lead.updated_date ? formatDistanceToNow(lead.updated_date, { addSuffix: true, locale: he }) : '-'}
                </span>
              </div>

              {(() => {
                const now = new Date();
                const overdueTasks = tasks.filter(t => t.due_date && t.task_status !== 'completed' && new Date(t.due_date) <= now);
                const upcomingTasks = tasks
                  .filter(t => t.due_date && t.task_status !== 'completed' && new Date(t.due_date) > now)
                  .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
                const nextTask = upcomingTasks[0];

                return (
                  <>
                    {overdueTasks.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 text-red-500" />
                          משימות באיחור
                        </span>
                        <Badge className="bg-red-100 text-red-700 text-xs">
                          {overdueTasks.length}
                        </Badge>
                      </div>
                    )}
                    {nextTask && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">משימה הבאה</span>
                        <span className="text-xs font-medium text-foreground/80">
                          {TASK_TYPE_LABELS[nextTask.task_type] || nextTask.task_type}
                          {' - '}
                          {formatInTimeZone(new Date(nextTask.due_date), 'Asia/Jerusalem', 'dd/MM HH:mm')}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="border-t border-border/50 pt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">פעילות</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {tasks.length} משימות
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {quotes.length} הצעות
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* The old conditional sidebar service-summary card was
              removed — its content is now a permanent, full-detail
              section in the main column (#lead-service-section). */}


          {/* Assignment */}
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                שיוך נציגים
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {isEditing && (canEditLeadRep1 || canEditLeadRep2) ? (
                <div className="space-y-3">
                  {canEditLeadRep1 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">נציג ראשי</Label>
                      <Select
                        value={formData.rep1 || ''}
                        onValueChange={(value) => setFormData({ ...formData, rep1: value, status: value ? 'assigned' : formData.status })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>ללא שיוך</SelectItem>
                          {salesReps.map((rep) =>
                            <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {canEditLeadRep2 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">נציג משני</Label>
                      <Select
                        value={formData.rep2 || ''}
                        onValueChange={(value) => setFormData({ ...formData, rep2: value })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>ללא</SelectItem>
                          {salesReps.map((rep) =>
                            <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <RepCard
                    label="נציג ראשי"
                    rep={lead.rep1 ? (salesReps.find((r) => r.email === lead.rep1) || { email: lead.rep1, full_name: getRepDisplayName(lead.rep1, salesReps) }) : null}
                    isEmpty={!lead.rep1 && !lead.pending_rep_email}
                    canEdit={canEditLeadRep1}
                    salesReps={salesReps}
                    onAssign={handleQuickAssignRep1}
                    isPending={updateLeadMutation.isPending}
                  />
                  {!lead.rep1 && lead.pending_rep_email && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-700 font-medium mb-1">נציג ממתין לשיוך:</p>
                      <p className="text-sm text-amber-800">{lead.pending_rep_email}</p>
                      {isAdmin && (
                        <Button
                          size="sm"
                          className="mt-2 bg-amber-600 hover:bg-amber-700 h-7 text-xs w-full"
                          onClick={async () => {
                            const repName = salesReps.find(r => r.email === lead.pending_rep_email)?.full_name || lead.pending_rep_email;
                            const openAssignmentTasks = tasks.filter(t =>
                              t.task_status === 'not_completed' && (!t.rep1 || t.task_type === 'assignment')
                            );

                            if (openAssignmentTasks.length > 0) {
                              await Promise.all(openAssignmentTasks.map(t =>
                                base44.entities.SalesTask.update(t.id, { task_status: 'completed' })
                              ));
                            } else {
                              await base44.entities.SalesTask.create({
                                lead_id: leadId,
                                rep1: lead.pending_rep_email,
                                task_type: 'assignment',
                                task_status: 'completed',
                                summary: `שיוך לנציג: ${repName}`,
                                work_start_date: new Date().toISOString(),
                              });
                            }

                            await createAuditLog({
                              leadId,
                              actionType: 'rep_assigned',
                              description: `${user.full_name} שייך את הליד לנציג ${lead.pending_rep_email}`,
                              user,
                              fieldName: 'rep1',
                              oldValue: 'לא משויך',
                              newValue: lead.pending_rep_email,
                            });
                            updateLeadMutation.mutate({
                              rep1: lead.pending_rep_email,
                              pending_rep_email: null
                            });
                            queryClient.invalidateQueries(['tasks', leadId]);
                            queryClient.invalidateQueries(['leadActivityLogs', leadId]);
                          }}
                          disabled={updateLeadMutation.isPending}
                        >
                          שייך נציג זה כראשי
                        </Button>
                      )}
                    </div>
                  )}
                  <RepCard
                    label="נציג משני"
                    rep={lead.rep2 ? salesReps.find((r) => r.email === lead.rep2) : null}
                    isEmpty={!lead.rep2}
                    canEdit={canEditLeadRep2}
                    salesReps={salesReps}
                    onAssign={handleQuickAssignRep2}
                    isPending={updateLeadMutation.isPending}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quotes */}
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                הצעות מחיר ({quotes.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {quotes.length === 0 ? (
                <div className="py-4 flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">אין הצעות מחיר לליד זה.</span>
                  <Link to={createPageUrl('NewQuote') + `?lead_id=${leadId}`}>
                    <Button size="sm" variant="outline">
                      <FileText className="h-3.5 w-3.5 me-1" />
                      צור הצעה
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {quotes.map((quote) =>
                    <Link
                      key={quote.id}
                      to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}
                      className="block p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">#{quote.quote_number}</span>
                        <StatusBadge status={quote.status} />
                      </div>
                      <p className="text-lg font-bold text-primary">
                        ₪{quote.total?.toLocaleString()}
                      </p>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                מידע שיווקי
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {isEditing ? (
                <LeadMarketingSection
                  data={formData}
                  onChange={(field, value) => setFormData({ ...formData, [field]: value })}
                />
              ) : (
                <LeadMarketingSection data={lead} readOnly />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      </div>{/* end of scrollable body wrapper (see comment near opener above) */}

      {/* Add Communication Dialog */}
      <AddCommunication
        leadId={leadId}
        isOpen={showAddCommunication}
        onClose={() => setShowAddCommunication(false)} />

      {/* Add Task Dialog */}
      <SalesTaskDialog
        isOpen={showAddTaskDialog}
        onClose={() => setShowAddTaskDialog(false)}
        preSelectedLead={lead}
        effectiveUser={effectiveUser}
      />

      {/* Edit Task Dialog */}
      <SalesTaskDialog
        isOpen={showEditTaskDialog}
        onClose={() => { setShowEditTaskDialog(false); setEditingTask(null); }}
        task={editingTask ? { ...editingTask, lead } : null}
        effectiveUser={effectiveUser}
      />

      {/* Assign-before-task gate: blocks "משימה חדשה" on a lead that
          has no primary rep. Forces the user to pick an owner first
          (via the existing handleQuickAssignRep1 flow), then jumps
          straight into the task dialog so the original intent
          isn't lost. */}
      <Dialog open={showAssignBeforeTask} onOpenChange={(open) => { if (!open) setShowAssignBeforeTask(false); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">נדרש שיוך לפני פתיחת משימה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>לא ניתן לפתוח משימה לליד שלא משויך. בחר נציג ראשי לשיוך, והמשימה תיפתח מיד אחרי השיוך.</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">נציג ראשי</Label>
              <Select value={assignBeforeTaskRep} onValueChange={setAssignBeforeTaskRep}>
                <SelectTrigger className="h-10"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                <SelectContent>
                  {salesReps.map((rep) => (
                    <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowAssignBeforeTask(false)} disabled={isAssigningBeforeTask}>ביטול</Button>
              <Button onClick={confirmAssignThenAddTask} disabled={!assignBeforeTaskRep || isAssigningBeforeTask}>
                {isAssigningBeforeTask ? 'משייך…' : 'שייך ופתח משימה'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* No-answer callback scheduling dialog */}
      <Dialog open={!!noAnswerFlow} onOpenChange={(open) => {
        if (!open) {
          setNoAnswerFlow(null);
          setFormData(prev => ({ ...prev, status: lead.status }));
        }
      }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-center">
              תזמון חזרה ללקוח
            </DialogTitle>
          </DialogHeader>
          {noAnswerFlow && (
            <div className="space-y-5 pt-2">
              <div className="text-center p-3 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-sm font-semibold text-amber-800">
                  הסטטוס ישתנה ל: <span className="text-amber-900">{noAnswerFlow.label}</span>
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground text-center mb-3">חזור ללקוח בעוד:</p>
                <div className="grid grid-cols-4 gap-2">
                  {[2, 3, 4, 5].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setNoAnswerFlow({ ...noAnswerFlow, selectedHours: h })}
                      className={`py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                        noAnswerFlow.selectedHours === h
                          ? 'border-amber-500 bg-amber-100 text-amber-800 shadow-sm'
                          : 'border-border bg-white hover:border-amber-300 hover:bg-amber-50 text-muted-foreground'
                      }`}
                    >
                      {h} שעות
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={!noAnswerFlow.selectedHours || updateLeadMutation.isPending}
                  onClick={async () => {
                    if (!noAnswerFlow.selectedHours) return;

                    // 1. Update lead status
                    createAuditLog({
                      leadId,
                      actionType: 'status_changed',
                      description: `${user.full_name} שינה סטטוס: "${lead.status}" → "${noAnswerFlow.status}"`,
                      user,
                      fieldName: 'status',
                      oldValue: lead.status,
                      newValue: noAnswerFlow.status,
                    });
                    const noAnswerNow = new Date().toISOString();
                    await base44.entities.Lead.update(leadId, { status: noAnswerFlow.status });

                    // 2. Mark current open tasks as completed with timestamp
                    const openTasks = tasks.filter(t => t.task_status === 'not_completed');
                    if (openTasks.length > 0) {
                      await Promise.all(openTasks.map(t =>
                        base44.entities.SalesTask.update(t.id, { task_status: 'completed' })
                      ));
                    }

                    // 3. Create new call task
                    const dueDate = addHours(new Date(), noAnswerFlow.selectedHours);
                    await base44.entities.SalesTask.create({
                      lead_id: leadId,
                      rep1: lead.rep1 || user?.email,
                      rep2: lead.rep2 || '',
                      task_type: 'call',
                      task_status: 'not_completed',
                      status: noAnswerFlow.status,
                      due_date: dueDate.toISOString(),
                      work_start_date: noAnswerNow,
                      created_date: noAnswerNow,
                      summary: `חזור ללקוח ${lead.full_name || ''} - ${noAnswerFlow.label}`,
                    });

                    // 4. Refresh
                    queryClient.invalidateQueries(['lead', leadId]);
                    queryClient.invalidateQueries(['tasks', leadId]);
                    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
                    queryClient.invalidateQueries(['salesTasks']);
                    queryClient.invalidateQueries(['taskCounters']);
                    setNoAnswerFlow(null);
                  }}
                >
                  אישור
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setNoAnswerFlow(null);
                    setFormData(prev => ({ ...prev, status: lead.status }));
                  }}
                >
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Followup before quote scheduling dialog */}
      <Dialog open={!!followupFlow} onOpenChange={(open) => {
        if (!open) {
          setFollowupFlow(null);
          setFormData(prev => ({ ...prev, status: lead.status }));
        }
      }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-center">
              תזמון פולואפ - {followupFlow?.status === 'followup_after_quote' ? 'אחרי הצעה' : 'לפני הצעה'}
            </DialogTitle>
          </DialogHeader>
          {followupFlow && (
            <div className="space-y-5 pt-2">
              <div className="text-center p-3 bg-blue-50 rounded-xl border border-blue-200">
                <p className="text-sm font-semibold text-blue-800">
                  מתי לחזור ללקוח?
                </p>
              </div>

              {/* Day selection - next 5 working days, no Saturday */}
              <div>
                <p className="text-sm text-muted-foreground text-center mb-3">בחר יום:</p>
                <div className="grid grid-cols-5 gap-2">
                  {(() => {
                    const days = [];
                    let d = startOfDay(new Date());
                    while (days.length < 5) {
                      if (d.getDay() !== 6) days.push(new Date(d));
                      d = addDays(d, 1);
                    }
                    return days;
                  })().map((day) => {
                    const dayKey = day.toISOString();
                    const dayName = format(day, 'EEEE', { locale: he });
                    const dateLabel = format(day, 'd/M');
                    const isSelected = followupFlow.selectedDate === dayKey;
                    return (
                      <button
                        key={dayKey}
                        type="button"
                        onClick={() => setFollowupFlow({ ...followupFlow, selectedDate: dayKey })}
                        className={`flex flex-col items-center py-3 px-1 rounded-xl border-2 text-xs font-bold transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-100 text-blue-800 shadow-sm'
                            : 'border-border bg-white hover:border-blue-300 hover:bg-blue-50 text-muted-foreground'
                        }`}
                      >
                        <span>{dayName}</span>
                        <span className="text-[10px] font-normal mt-0.5 opacity-70">{dateLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hour selection */}
              {followupFlow.selectedDate && (
                <div>
                  <p className="text-sm text-muted-foreground text-center mb-3">בחר שעה:</p>
                  <div className="grid grid-cols-5 gap-2">
                    {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((hour) => {
                      const isSelected = followupFlow.selectedHour === hour;
                      return (
                        <button
                          key={hour}
                          type="button"
                          onClick={() => setFollowupFlow({ ...followupFlow, selectedHour: hour })}
                          className={`py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                            isSelected
                              ? 'border-blue-500 bg-blue-100 text-blue-800 shadow-sm'
                              : 'border-border bg-white hover:border-blue-300 hover:bg-blue-50 text-muted-foreground'
                          }`}
                        >
                          {String(hour).padStart(2, '0')}:00
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={!followupFlow.selectedDate || followupFlow.selectedHour == null || updateLeadMutation.isPending}
                  onClick={async () => {
                    const dueDate = new Date(followupFlow.selectedDate);
                    dueDate.setHours(followupFlow.selectedHour, 0, 0, 0);
                    const now = new Date().toISOString();
                    const fStatus = followupFlow.status;
                    const statusLabel = fStatus === 'followup_after_quote' ? 'אחרי הצעת מחיר' : 'לפני הצעת מחיר';
                    const statusHebrew = fStatus === 'followup_after_quote' ? 'פולאפ - אחרי הצעת מחיר' : 'פולאפ - לפני הצעה';

                    // 1. Update lead status
                    createAuditLog({
                      leadId,
                      actionType: 'status_changed',
                      description: `${user.full_name} שינה סטטוס: "${lead.status}" → "${statusHebrew}"`,
                      user,
                      fieldName: 'status',
                      oldValue: lead.status,
                      newValue: fStatus,
                    });
                    await base44.entities.Lead.update(leadId, { status: fStatus });

                    // 2. Mark current open tasks as completed with timestamp
                    const openTasks = tasks.filter(t => t.task_status === 'not_completed');
                    if (openTasks.length > 0) {
                      await Promise.all(openTasks.map(t =>
                        base44.entities.SalesTask.update(t.id, { task_status: 'completed' })
                      ));
                    }

                    // 3. Create followup call task
                    await base44.entities.SalesTask.create({
                      lead_id: leadId,
                      rep1: lead.rep1 || user?.email,
                      rep2: lead.rep2 || '',
                      task_type: 'call',
                      task_status: 'not_completed',
                      status: fStatus,
                      due_date: dueDate.toISOString(),
                      work_start_date: now,
                      created_date: now,
                      summary: `פולואפ - חזור ללקוח ${lead.full_name || ''} ${statusLabel}`,
                    });

                    // 4. Refresh
                    queryClient.invalidateQueries(['lead', leadId]);
                    queryClient.invalidateQueries(['tasks', leadId]);
                    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
                    queryClient.invalidateQueries(['salesTasks']);
                    queryClient.invalidateQueries(['taskCounters']);
                    setFollowupFlow(null);
                  }}
                >
                  אישור
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFollowupFlow(null);
                    setFormData(prev => ({ ...prev, status: lead.status }));
                  }}
                >
                  ביטול
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>);

}