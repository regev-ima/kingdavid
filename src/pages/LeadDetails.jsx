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
  Pencil,
  Loader2,
  MessageCircle,
  FileText,
  Clock,
  Tag,
  MoreVertical,
  Headphones,
  ShoppingBag,
  AlertTriangle,
  Crown,
  Phone,
  Mail,
  MapPin,
  Home,
  Globe,
  Megaphone,
  StickyNote,
  MessageSquare,
  CalendarDays,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import SLABadge from '@/components/sla/SLABadge';
import AddCommunication from '@/components/lead/AddCommunication';
import RepCard from '@/components/lead/RepCard';
import LeadWhatsAppChatButton from '@/components/whatsapp/LeadWhatsAppChatButton';
import LeadMarketingSection from '@/components/lead/LeadMarketingSection';
import { leadMarketingFieldLabels } from '@/constants/leadMarketingFields';
import { differenceInDays } from '@/lib/safe-date-fns';
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';
import { Badge } from "@/components/ui/badge";
import SalesTaskDialog from '@/components/task/SalesTaskDialog';
import NewQuoteDialog from '@/components/quote/NewQuoteDialog';
import LeadUnifiedTimeline from '@/components/lead/LeadUnifiedTimeline';
import LeadWorkbenchQueue from '@/components/lead/LeadWorkbenchQueue';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { createAuditLog } from '@/utils/auditLog';
import NewOrder from '@/pages/NewOrder';
import { LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS, formatSourceLabel } from '@/constants/leadOptions';
import StatusOptionRow from '@/components/shared/StatusOptionRow';
import { canViewLead } from '@/components/shared/rbac';
import OtherEnquiriesCard from '@/components/lead/OtherEnquiriesCard';
import RepeatEnquiryBadge from '@/components/lead/RepeatEnquiryBadge';
import CompleteTaskDialog from '@/components/sales/CompleteTaskDialog';
import { useRepeatEnquiries } from '@/lib/repeatEnquiries';
import { isSameRep, reconcileRepSlots, repsExcludingPrimary } from '@/lib/repSlots';
import { canEditPrimaryRep, canEditSecondaryRep, canAccessSalesWorkspace } from '@/lib/rbac';
import { buildLeadWorkbenchState } from '@/lib/leadWorkbench';

// Hebrew counter with proper singular / dual / plural forms
// (e.g. 1 → "יום", 2 → "יומיים", 3 → "3 ימים").
function hebrewCount(n, one, two, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${many}`;
}

// Join Hebrew list parts with commas and a final "ו" conjunction:
// ["3 חודשים","2 שבועות","5 ימים"] → "3 חודשים, 2 שבועות ו-5 ימים".
function joinHebrewParts(parts) {
  if (parts.length === 0) return 'פחות מיום';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const conj = /^\d/.test(last) ? 'ו-' : 'ו'; // "ו-5 ימים" vs "ויומיים"
  return `${parts.slice(0, -1).join(', ')} ${conj}${last}`;
}

// Lead age as a single cascading breakdown that adds back up to the total
// day count — e.g. a 109-day-old lead reads "3 חודשים, 2 שבועות ו-5 ימים",
// NOT three independent totals. Uses round 30-day months / 7-day weeks so
// the parts always sum to the days; zero-valued units are dropped.
function formatLeadAge(createdDate) {
  const created = createdDate instanceof Date ? createdDate : new Date(createdDate);
  if (isNaN(created.getTime())) return '-';

  let remaining = Math.max(0, differenceInDays(new Date(), created));
  const months = Math.floor(remaining / 30); remaining -= months * 30;
  const weeks = Math.floor(remaining / 7); remaining -= weeks * 7;
  const days = remaining;

  const parts = [];
  if (months > 0) parts.push(hebrewCount(months, 'חודש', 'חודשיים', 'חודשים'));
  if (weeks > 0) parts.push(hebrewCount(weeks, 'שבוע', 'שבועיים', 'שבועות'));
  if (days > 0) parts.push(hebrewCount(days, 'יום', 'יומיים', 'ימים'));
  return joinHebrewParts(parts);
}

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
  // Create an order inline (as a dialog over the lead) instead of navigating
  // away — lets a rep close a walk-in sale without leaving the lead screen.
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  // Create a quote inline (dialog over the lead). We own it locally rather than
  // via useCreationModal() because the lead overlay renders ABOVE the
  // CreationModal provider, so that context is a no-op here — which is exactly
  // why "הצעה חדשה" did nothing. Mirrors the order dialog above.
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  // Gating dialog for "משימה חדשה" on unassigned leads — instead of
  // letting the rep open a task on a lead that has no owner (and then
  // wondering who's supposed to do it), we intercept and require an
  // assignment first. Holds the candidate rep email until confirmed.
  const [assignBeforeTaskRep, setAssignBeforeTaskRep] = useState('');
  const [showAssignBeforeTask, setShowAssignBeforeTask] = useState(false);
  const [isAssigningBeforeTask, setIsAssigningBeforeTask] = useState(false);
  // Task being closed from the "סיים" shortcut on the next-task strip.
  const [completingTask, setCompletingTask] = useState(null);
  // The old `workMode` state (sales vs service) was removed when we
  // collapsed the two modes into a single unified lead screen. Sales
  // and service info now live side-by-side, the service section is a
  // permanent card in the main column, and the only cross-functional
  // signal is the open-tickets badge in the header. `initialMode` is
  // still accepted as a prop for backwards-compat with any caller
  // that passes it; it's just ignored.
  void initialMode;
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

  // "פנייה נוספת" — is this row a repeat enquiry from someone who already
  // came in before? OtherEnquiriesCard lists the siblings further down the
  // page; the header just needs the one-glance marker.
  const leadForRepeatLookup = useMemo(() => (lead ? [lead] : []), [lead]);
  const repeatEnquiryOrdinal = useRepeatEnquiries(leadForRepeatLookup).get(lead?.id);

  // Where the lead came from, resolved once for the header. A rep asking
  // "מאיפה הוא הגיע?" wants two things: the channel (מקור) and the specific
  // ad that produced the enquiry — and they want both before they dial, not
  // after clicking into the שיווק tab. Falls back down the chain because not
  // every integration fills facebook_ad_name: campaign name, UTM campaign,
  // ad set, and finally the source form.
  const sourceLabel = lead ? formatSourceLabel(lead.source) : '';
  const adLabel = lead
    ? (lead.facebook_ad_name
      || lead.facebook_campaign_name
      || lead.utm_campaign
      || lead.facebook_adset_name
      || lead.source_form
      || '')
    : '';
  const arrivedAtLabel = lead?.created_date
    ? formatInTimeZone(lead.created_date, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')
    : '';

  // Does the customer-details card have anything to say? Name, phone, source
  // and the ad live in the header, so on a fresh lead the answer is usually
  // no — and then the card doesn't render at all rather than showing a column
  // of blanks. `source_form` counts only when the header isn't already using
  // it as the ad label.
  const hasCustomerDetails = !!lead && [
    lead.phone_2,
    lead.email,
    lead.city,
    lead.address,
    lead.source_form === adLabel ? '' : lead.source_form,
    lead.subject,
    lead.notes,
  ].some((value) => String(value || '').trim() !== '')
    || (Array.isArray(lead?.tags) && lead.tags.length > 0);

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
    },
    onError: (err) => toast({ title: 'עדכון הליד נכשל', description: err?.message || 'שגיאה לא צפויה', variant: 'destructive' }),
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
        // Carried over with the rest of the contact details — the second number
        // is worth as much on the customer card as it was on the lead.
        phone_2: lead.phone_2,
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
      toast({ title: 'הליד הומר ללקוח' });
      queryClient.invalidateQueries(['lead', leadId]);
      navigate(createPageUrl('CustomerDetails') + `?id=${customer.id}`);
    },
    onError: (err) => toast({ title: 'ההמרה ללקוח נכשלה', description: err?.message || 'שגיאה לא צפויה', variant: 'destructive' }),
  });

  const isAdmin = effectiveUser?.role === 'admin';
  const canEdit = isAdmin || lead?.rep1 === effectiveUser?.email || lead?.rep2 === effectiveUser?.email || lead?.pending_rep_email === effectiveUser?.email;
  const canEditLeadRep1 = canEditPrimaryRep(effectiveUser);
  const canEditLeadRep2 = canEditSecondaryRep(effectiveUser, lead);
  const workbenchState = useMemo(() => buildLeadWorkbenchState({
    tasks,
  }), [tasks]);

  const handleSave = async () => {
    const { id, created_date, updated_date, created_by, ...editedFields } = formData;

    // The two rep slots belong to two different people. The pickers already
    // enforce it, so this catches the ways in that don't go through them — a
    // stale form, a value carried over from before the rule existed.
    const { patch: updateData, clearedSecondary } = reconcileRepSlots(lead, editedFields);

    // Audit log for each changed field
    const fieldLabels = {
      full_name: 'שם',
      phone: 'טלפון',
      phone_2: 'טלפון נוסף',
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
      // Read the value we're actually about to save, not the raw form — so a
      // rep2 the reconcile just cleared is logged as cleared.
      const nextValue = field in updateData ? updateData[field] : lead[field];
      if (nextValue !== lead[field] && (nextValue || lead[field])) {
        const isRep = field === 'rep1' || field === 'rep2';
        await createAuditLog({
          leadId,
          actionType: isRep ? 'rep_changed' : field === 'status' ? 'status_changed' : 'field_updated',
          description: `${user.full_name} שינה ${fieldLabels[field]}: "${lead[field] || '(ריק)'}" → "${nextValue || '(ריק)'}"`,
          user,
          fieldName: field,
          oldValue: lead[field],
          newValue: nextValue,
        });
      }
    }

    if (clearedSecondary) {
      toast({
        title: 'הנציג המשני נוקה',
        description: 'אותו נציג לא יכול להיות גם ראשי וגם משני — אפשר לשייך נציג משני אחר.',
      });
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
      case 'complete_task': {
        const selectedTask = tasks.find((task) => String(task.id) === String(item?.id));
        if (!selectedTask) return;
        // Same "מה קרה?" flow the tasks screen uses, so closing from here
        // still records an outcome and can schedule the follow-up.
        setCompletingTask({
          ...selectedTask,
          rep1: selectedTask.rep1 || lead?.rep1,
          rep2: selectedTask.rep2 || lead?.rep2,
        });
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

  // Lead lookup, intentionally cross-rep: any sales rep may open any lead so a
  // walk-in customer can be served by whoever is free. Ownership never moves
  // here — rep1 is admin-only (canEditPrimaryRep) and the rep2/edit controls
  // need `canEdit` (owner/admin), so a non-owner can view + work the lead but
  // can't claim it. A banner below makes the "view/serve, not yours" state
  // explicit. Only users outside the sales workspace are turned away.
  if (!canAccessSalesWorkspace(effectiveUser)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg font-medium">אין לך הרשאות לצפות בליד זה.</p>
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

      // 3. No "יש להתקשר ללקוח" task. Assigning a lead doesn't schedule
      //    anything — a task opens by itself only for the statuses that ARE a
      //    scheduled commitment (see AUTO_TASK_STATUSES). The rep just got the
      //    lead; they know to call it.

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

      // 5. Update lead. Assigning the lead to whoever was its secondary rep
      //    frees the secondary slot — they own it now.
      const { patch, clearedSecondary } = reconcileRepSlots(lead, { rep1: email });
      if (clearedSecondary) {
        await createAuditLog({
          leadId,
          actionType: 'rep_changed',
          description: `הנציג המשני נוקה — ${repName} הפך/ה לנציג הראשי`,
          user,
          fieldName: 'rep2',
          oldValue: lead.rep2,
          newValue: '',
        });
      }
      updateLeadMutation.mutate(patch);
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

  // The lead status is changed only through a task (that's where the smart
  // no-answer / follow-up scheduling lives), so clicking the status card opens
  // the lead's most recent task — there the rep updates the status and records
  // what happened. If the lead has no task yet, start a new one.
  const openLastTask = () => {
    const sorted = [...tasks].sort(
      (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0),
    );
    // Prefer the latest still-open task (that's where the status actually
    // gets changed); otherwise the most recent task; with none, start one.
    const target = sorted.find(
      (t) => String(t?.task_status || '').toLowerCase() === 'not_completed',
    ) || sorted[0];
    if (target) {
      setEditingTask(target);
      setShowEditTaskDialog(true);
    } else {
      requestAddTask();
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

  // Clearing a slot. A rep picked by mistake used to be permanent from this
  // card — there was no "none" to choose — so an admin was stuck with a wrong
  // assignment. Both slots are clearable; the permission gates are unchanged
  // (primary is admin-only, secondary follows canEditSecondaryRep).
  const handleRemoveRep = async (field) => {
    const label = field === 'rep1' ? 'נציג ראשי' : 'נציג משני';
    const previous = lead[field];
    if (!previous) return;

    await createAuditLog({
      leadId,
      actionType: 'rep_changed',
      description: `${user?.full_name || 'משתמש'} הסיר ${label}: ${getRepDisplayName(previous, salesReps)}`,
      user,
      fieldName: field,
      oldValue: previous,
      newValue: '',
    });

    updateLeadMutation.mutate({ [field]: '' });
    queryClient.invalidateQueries(['leadActivityLogs', leadId]);
  };

  const handleQuickAssignRep2 = async (email) => {
    const repName = salesReps.find(r => r.email === email)?.full_name || email;

    // The picker doesn't offer the primary rep, but this handler is also the
    // one the RepCard shortcut calls — so refuse the duplicate here too.
    if (isSameRep(email, lead.rep1)) {
      toast({
        title: 'אי אפשר לשייך את אותו נציג פעמיים',
        description: `${repName} כבר הנציג הראשי של הליד. נציג משני נועד לנציג אחר.`,
        variant: 'destructive',
      });
      return;
    }

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
    <div className={isModal ? 'flex flex-col min-h-0 overflow-hidden' : 'space-y-6'}>
      {/* Status accent bar — purely decorative thin strip at the very
          top of the rendered tree. */}
      <div className="h-1.5 w-full bg-blue-500 shrink-0" />
      {/* Header — name, status, SLA, mode toggle. In popup mode it's
          flex-shrink-0 so it never scrolls; pe-12 reserves room for
          the Radix close-X that sits in the dialog's right corner. */}
      <div className={
        `flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4` +
        (isModal
          // pe-16 (not pe-12): the dialog's own close-X is absolutely
          // positioned at left-4 and is ~40px wide, so it occupies the first
          // 56px of the inline-end edge. The freshness block now sits at that
          // edge and needs to clear it.
          ? ' flex-shrink-0 px-6 pt-5 pb-3 pe-16 bg-card border-b border-border'
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
            {/* Name and every chip on ONE row. Status, SLA and the repeat
                marker used to sit on three different lines with a "סטטוס:"
                prefix in front of one of them — three places to look for
                three one-word facts. They belong together, next to the name
                they describe. */}
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">{lead.full_name}</h1>
              <StatusBadge status={lead.status} />
              <SLABadge lead={lead} />
              <RepeatEnquiryBadge ordinal={repeatEnquiryOrdinal} />
            </div>
            {/* Provenance line — phone, WHERE the lead came from (channel +
                the specific ad), and when it arrived. This is the header's
                job and the header's alone: the same fields used to be
                repeated inside "פרטי לקוח", which is what made the screen
                read as the same information twice. */}
            {(() => {
              const facts = [
                lead.phone ? { key: 'phone', node: <span dir="ltr">{lead.phone}</span> } : null,
                sourceLabel ? {
                  key: 'source',
                  node: (
                    <span className="inline-flex items-center gap-1" title={`מקור: ${sourceLabel}`}>
                      <Globe className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                      {sourceLabel}
                    </span>
                  ),
                } : null,
                adLabel ? {
                  key: 'ad',
                  node: (
                    <span className="inline-flex items-center gap-1 min-w-0 max-w-[240px] sm:max-w-[360px]" title={`מודעה: ${adLabel}`}>
                      <Megaphone className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                      <span className="truncate">{adLabel}</span>
                    </span>
                  ),
                } : null,
                arrivedAtLabel ? { key: 'arrived', node: <span>נכנס {arrivedAtLabel}</span> } : null,
              ].filter(Boolean);
              if (facts.length === 0) return null;
              return (
                <div className="flex items-center gap-x-2 gap-y-0.5 mt-0.5 text-sm text-muted-foreground flex-wrap">
                  {facts.map((fact, index) => (
                    <React.Fragment key={fact.key}>
                      {index > 0 ? <span className="text-muted-foreground/40" aria-hidden="true">·</span> : null}
                      {fact.node}
                    </React.Fragment>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Left edge of the header (RTL): freshness + the open-tickets alert.
            "עדכון אחרון" and "גיל הליד" used to sit at the foot of the details
            list, which meant scrolling past everything to answer "is this lead
            still warm?". Up here they're readable the moment the lead opens,
            and they stay out of the name's way. */}
        <div className="flex items-center gap-3 flex-wrap lg:justify-end lg:text-end">
          {(lead.updated_date || lead.created_date) ? (
            <div className="text-[11px] leading-tight text-muted-foreground/80">
              {lead.updated_date ? (
                <div className="flex items-center gap-1.5 lg:justify-end">
                  <CalendarDays className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                  <span>עדכון אחרון</span>
                  <span className="tabular-nums text-foreground/70">
                    {formatInTimeZone(lead.updated_date, 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')}
                  </span>
                </div>
              ) : null}
              {lead.created_date ? (
                <div className="lg:text-end mt-0.5">
                  גיל הליד: <span className="text-foreground/70">{formatLeadAge(lead.created_date)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

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
        <LeadWhatsAppChatButton phone={lead.phone} name={lead.full_name} className="flex-1 min-w-[120px] justify-center h-9" />
        <Button
          variant="outline"
          size="sm"
          onClick={requestAddTask}
          className="flex-1 min-w-[120px] justify-center h-9 text-xs"
        >
          <Clock className="h-3.5 w-3.5 me-1.5" />
          משימה חדשה
        </Button>
        <Button
          size="sm"
          onClick={() => setShowQuoteDialog(true)}
          className="flex-1 min-w-[120px] justify-center h-9 text-xs"
        >
          <FileText className="h-3.5 w-3.5 me-1.5" />
          הצעה חדשה
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowOrderDialog(true)}
          className="flex-1 min-w-[120px] justify-center h-9 text-xs"
        >
          <ShoppingBag className="h-3.5 w-3.5 me-1.5" />
          הזמנה חדשה
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddCommunication(true)}
          className="flex-1 min-w-[120px] justify-center h-9 text-xs"
        >
          <MessageCircle className="h-3.5 w-3.5 me-1.5" />
          הוסף תקשורת
        </Button>
        {canEdit ? (
          <Button
            size="sm"
            variant={isEditing ? 'default' : 'outline'}
            onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
            disabled={updateLeadMutation.isPending}
            className="flex-1 min-w-[120px] justify-center h-9 text-xs"
          >
            {updateLeadMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isEditing ? (
              <>
                <Save className="h-3.5 w-3.5 me-1.5" />
                שמור
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 me-1.5" />
                ערוך
              </>
            )}
          </Button>
        ) : null}
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
          <LeadWhatsAppChatButton phone={lead.phone} name={lead.full_name} />
          <Button variant="outline" size="sm" onClick={requestAddTask} className="h-8 text-xs">
            <Clock className="h-3.5 w-3.5 me-1" />
            משימה חדשה
          </Button>
          <Button size="sm" onClick={() => setShowQuoteDialog(true)} className="h-8 text-xs">
            <FileText className="h-3.5 w-3.5 me-1" />
            הצעה חדשה
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowOrderDialog(true)} className="h-8 text-xs">
            <ShoppingBag className="h-3.5 w-3.5 me-1" />
            הזמנה חדשה
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAddCommunication(true)} className="h-8 text-xs">
            <MessageCircle className="h-3.5 w-3.5 me-1" />
            הוסף תקשורת
          </Button>
          {/* Editing lives here now that the details card isn't a tab and
              doesn't always render — from the action bar it's reachable
              whichever tab is open, and on a lead with nothing filled in yet. */}
          {canEdit ? (
            <Button
              size="sm"
              variant={isEditing ? 'default' : 'outline'}
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
              disabled={updateLeadMutation.isPending}
              className="h-8 text-xs"
            >
              {updateLeadMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isEditing ? (
                <>
                  <Save className="h-3.5 w-3.5 me-1" />
                  שמור
                </>
              ) : (
                <>
                  <Pencil className="h-3.5 w-3.5 me-1" />
                  ערוך
                </>
              )}
            </Button>
          ) : null}
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scrollable body — ONE column now. In modal mode this is the only
          thing inside the dialog that actually scrolls: the header + action
          bar above are fixed flex-shrink-0 siblings, so they NEVER move and
          NEVER get occluded by content scrolling under them. In full-page
          mode it's a passive wrapper. The two-pane split it replaced put the
          activity feed in a permanent 380px rail; the feed now closes the
          page instead (see the bottom of this block). */}
      <div className={isModal
        ? 'flex-auto min-h-0 overflow-y-auto p-4 lg:p-6 space-y-4'
        : 'space-y-4 min-w-0'}>

      {/* Cross-rep view/serve banner — shown when this rep isn't the owner
          (and isn't admin). Makes clear the lead belongs to someone else and
          that working it here won't transfer ownership. */}
      {!canEdit && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            {lead.rep1 ? (
              <>ליד זה משויך ל<span className="font-semibold">{getRepDisplayName(lead.rep1, users)}</span> — מצב טיפול. אפשר לראות פרטים והיסטוריה ולטפל בלקוח; הבעלות על הליד לא משתנה.</>
            ) : (
              <>ליד לא משויך — אפשר לראות פרטים והיסטוריה ולטפל בלקוח.</>
            )}
          </span>
        </div>
      )}

        {/* ESSENTIALS bar — status + both rep slots on ONE row.
            This used to be three stacked cards, ~104px of height for three
            values a rep reads in a glance and changes rarely. Same three
            controls, same affordances, ~44px: the labels sit inline and the
            slots share one bordered strip (1px gaps drawn by the container's
            background) instead of three shadowed cards. Collapses to one
            slot per row below sm, where there's no width to share. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-xl border border-border bg-border overflow-hidden shadow-card">
          {/* Lead Status */}
          <div className="bg-card min-w-0">
            {canEdit ? (
              // Status changes go through a task, so this opens the lead's
              // most recent task instead of editing the status directly.
              <button
                type="button"
                onClick={openLastTask}
                title="הסטטוס משתנה דרך משימה — לחץ לפתיחת המשימה האחרונה"
                className="w-full h-11 px-2.5 flex items-center gap-2 min-w-0 hover:bg-muted/60 transition-colors text-start"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">סטטוס</span>
                <span className="min-w-0 flex-1 truncate"><StatusBadge status={lead.status} /></span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70 flex-shrink-0">
                  <Clock className="h-3.5 w-3.5" />
                  עדכן במשימה
                </span>
              </button>
            ) : (
              <div className="h-11 px-2.5 flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">סטטוס</span>
                <StatusBadge status={lead.status} />
              </div>
            )}
          </div>

          {/* Primary rep */}
          <div className="bg-card min-w-0">
            <div className={isEditing && canEditLeadRep1 ? 'p-2.5' : ''}>
              {isEditing && canEditLeadRep1 ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">נציג ראשי</Label>
                  <Select
                    value={formData.rep1 || ''}
                    /* Promoting whoever sits in the secondary slot empties it —
                       one person never holds both (see lib/repSlots). */
                    onValueChange={(value) => setFormData({
                      ...formData,
                      rep1: value,
                      ...(isSameRep(value, formData.rep2) ? { rep2: '' } : {}),
                      status: value ? 'assigned' : formData.status,
                    })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>ללא שיוך</SelectItem>
                      {salesReps.map((rep) =>
                        <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <RepCard
                    compact
                    label="נציג ראשי"
                    rep={lead.rep1 ? (salesReps.find((r) => r.email === lead.rep1) || { email: lead.rep1, full_name: getRepDisplayName(lead.rep1, salesReps) }) : null}
                    isEmpty={!lead.rep1 && !lead.pending_rep_email}
                    canEdit={canEditLeadRep1}
                    salesReps={salesReps}
                    onAssign={handleQuickAssignRep1}
                    onRemove={lead.rep1 ? () => handleRemoveRep('rep1') : undefined}
                    isPending={updateLeadMutation.isPending}
                  />
                </>
              )}
            </div>
          </div>

          {/* Secondary rep */}
          <div className="bg-card min-w-0">
            <div className={isEditing && canEditLeadRep2 ? 'p-2.5' : ''}>
              {isEditing && canEditLeadRep2 ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">נציג משני</Label>
                  <Select
                    value={formData.rep2 || ''}
                    onValueChange={(value) => setFormData({ ...formData, rep2: value })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="בחר נציג" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>ללא</SelectItem>
                      {repsExcludingPrimary(salesReps, formData.rep1 || lead.rep1).map((rep) =>
                        <SelectItem key={rep.id} value={rep.email}>{rep.full_name}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <RepCard
                  compact
                  label="נציג משני"
                  // Same fallback the primary card has: a rep2 whose email
                  // isn't in `salesReps` — a rep who left, or one whose role
                  // isn't sales — used to resolve to null, which dropped the
                  // card into its empty state. The slot looked unassigned
                  // while the lead very much had a rep2, so there was nothing
                  // to remove and no way to clear it.
                  rep={lead.rep2
                    ? (salesReps.find((r) => r.email === lead.rep2) || { email: lead.rep2, full_name: getRepDisplayName(lead.rep2, salesReps) })
                    : null}
                  isEmpty={!lead.rep2}
                  canEdit={canEditLeadRep2}
                  salesReps={salesReps}
                  excludeEmails={[lead.rep1]}
                  onAssign={handleQuickAssignRep2}
                  onRemove={lead.rep2 ? () => handleRemoveRep('rep2') : undefined}
                  isPending={updateLeadMutation.isPending}
                />
              )}
            </div>
          </div>
        </div>

        {/* Pending rep — the integration named someone but the lead is still
            unassigned. Lifted out of the primary slot so the essentials bar
            keeps its single-row height; it's a call to action, and it belongs
            on its own line where it can say what it wants. */}
        {!lead.rep1 && lead.pending_rep_email && !isEditing && (
          <div className="flex items-center gap-2 flex-wrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="text-xs font-medium text-amber-700 flex-shrink-0">נציג ממתין לשיוך:</span>
            <span className="text-sm text-amber-900 min-w-0 truncate flex-1">
              {salesReps.find((r) => r.email === lead.pending_rep_email)?.full_name || lead.pending_rep_email}
            </span>
            {isAdmin && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 h-7 text-xs flex-shrink-0"
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
                            updateLeadMutation.mutate(
                              reconcileRepSlots(lead, {
                                rep1: lead.pending_rep_email,
                                pending_rep_email: null,
                              }).patch,
                            );
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

        {/* TASKS — leading, always visible. */}
        {/* Upcoming sales task — sits between the customer details and
            the task history: the rep reads who the lead is, then what
            they need to do next, then what's already been done. */}
        <LeadWorkbenchQueue state={workbenchState} onAction={handleWorkbenchAction} />

        {/* Other enquiries from the same person. Deliberately ABOVE the tabs
            and not inside "פרטי לקוח מלאים": a rep must know they are calling
            someone who already contacted us before they pick up the phone, not
            after clicking through to a tab. Renders nothing when this is the
            person's only enquiry, so a first-time lead stays uncluttered. */}
        <OtherEnquiriesCard lead={lead} />

        {/* Customer details — rendered only when there is something to show
            (or while editing). The header carries the identity; this card is
            for the fields it cannot fit, and on a fresh lead that set is
            empty, so nothing renders at all. */}
        {(isEditing || hasCustomerDetails) && (
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            {/* No edit button here — "ערוך" moved to the action bar, where
                it's reachable even when this card isn't on screen. */}
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/50 py-3">
              <CardTitle className="text-sm font-semibold">פרטי לקוח</CardTitle>
              <span className="text-[11px] text-muted-foreground/70">
                שם, טלפון ומקור מופיעים בכותרת
              </span>
            </CardHeader>
            <CardContent className="p-5">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">שם ושם משפחה</Label>
                      <Input value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">טלפון</Label>
                      <Input value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">טלפון נוסף</Label>
                      <Input value={formData.phone_2 || ''} onChange={(e) => setFormData({ ...formData, phone_2: e.target.value })} className="h-9" dir="ltr" />
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
                /* Name, phone, source, ad and arrival time are NOT here —
                   the header above owns them and shows them on every tab.
                   Repeating them was the single biggest reason this screen
                   read as the same information twice. What stays is what the
                   header can't fit. */
                <dl className="divide-y divide-border/30">
                  {[
                    { label: 'טלפון נוסף', value: lead.phone_2,                                         icon: Phone },
                    { label: 'אימייל',     value: lead.email,                                           icon: Mail },
                    { label: 'עיר',        value: lead.city,                                            icon: MapPin },
                    { label: 'כתובת',      value: lead.address,                                         icon: Home },
                    // Skipped when the header is already showing this exact
                    // string as the ad — the fallback chain there ends on
                    // source_form, and printing it twice is the duplication
                    // this pass is removing.
                    { label: 'טופס מקור',  value: lead.source_form === adLabel ? '' : lead.source_form, icon: FileText },
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

                  {/* No timestamps row — "עדכון אחרון" and "גיל הליד" moved
                      to the top-left of the header, and "נכנס …" is on the
                      header's provenance line. */}
                </dl>
              )}

            </CardContent>
          </Card>
        )}

        {/* Detail tabs — customer details, marketing, quotes, service.
            "הצעות / שירות" used to be one tab holding two unrelated lists;
            they're separate tabs now, each with its own count. The old
            "תמונת מצב" tab is gone: every number on it is either in the
            header (arrival, SLA), in the essentials bar (status, reps), on
            the next-task strip, or in the activity feed at the bottom. */}
        {/* The customer's own details are NOT a tab any more. The header
            already carries the identity, so what was left was a mostly-empty
            card sitting on the screen's default tab — the first thing you saw
            on a fresh lead was a list of blanks. It renders below the tabs
            instead, and only when at least one field has a value; editing is
            reached from "ערוך" in the action bar, which works from any tab. */}
        <Tabs defaultValue="marketing" dir="rtl" className="w-full">
          <TabsList className="bg-muted rounded-lg p-1 gap-1 h-auto flex flex-wrap justify-start">
            <TabsTrigger value="marketing" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-md px-3.5 py-1.5 text-sm">שיווק ומקור</TabsTrigger>
            <TabsTrigger value="quotes" className="group data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-md px-3.5 py-1.5 text-sm">
              הצעות מחיר
              <span className="ms-1.5 inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none bg-muted-foreground/15 text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                {quotes.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="service" className="group data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-md px-3.5 py-1.5 text-sm">
              שירות
              <span className={`ms-1.5 inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none ${
                openServiceTicketsCount > 0
                  ? 'bg-amber-500 text-white'
                  : 'bg-muted-foreground/15 text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground'
              }`}>
                {serviceTickets.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="marketing" className="mt-4 space-y-4">
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
          </TabsContent>

          <TabsContent value="quotes" className="mt-4 space-y-4">
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
                  <Button size="sm" variant="outline" onClick={() => setShowQuoteDialog(true)}>
                    <FileText className="h-3.5 w-3.5 me-1" />
                    צור הצעה
                  </Button>
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

          </TabsContent>

          {/* Service — its own tab now. It shares nothing with quotes except
              the customer, and pairing them meant a rep looking for one had
              to scroll past the other. The header alert badge scrolls to
              this section via the id below. */}
          <TabsContent value="service" className="mt-4 space-y-4">
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
          </TabsContent>

        </Tabs>

      {/* ACTIVITY — last, full width. It used to be a 380px rail pinned
          beside the lead, which took a third of the screen permanently for
          a feed you read after you've decided what to do. At the bottom it
          gets the full width (entries stop wrapping after four words) and
          the work — status, reps, next task, details — comes first. Capped
          so a long-lived lead's feed doesn't push the page to a mile; the
          feed scrolls inside its own box. */}
      <LeadUnifiedTimeline
        className="max-h-[560px]"
        leadId={leadId}
        tasks={tasks}
        users={users}
        onOpenTask={(task) => { setEditingTask(task); setShowEditTaskDialog(true); }}
      />

      </div>{/* end of body wrapper */}

      {/* Close a task straight from the next-task strip */}
      <CompleteTaskDialog
        isOpen={!!completingTask}
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={() => {
          setCompletingTask(null);
          queryClient.invalidateQueries({ queryKey: ['tasks', leadId] });
          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['leadActivityLogs', leadId] });
        }}
      />

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

      {/* Inline order creation — opens over the lead, no navigation away.
          On success we just close + refresh the lead's linked orders, so the
          rep stays on the lead they were working. */}
      <Dialog open={showOrderDialog} onOpenChange={setShowOrderDialog}>
        <DialogContent
          className="max-w-4xl max-h-[90vh] overflow-y-auto"
          dir="rtl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">הזמנה חדשה - {lead?.full_name || ''}</DialogTitle>
          </DialogHeader>
          <NewOrder
            asDialog
            dialogLeadId={leadId}
            onDialogClose={(order) => {
              setShowOrderDialog(false);
              // order is truthy only on a successful create (null = cancel),
              // so we refresh the lead's linked orders and confirm only then.
              if (order?.id) {
                queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
                queryClient.invalidateQueries({ queryKey: ['leads'] });
                queryClient.invalidateQueries({ queryKey: ['orders'] });
                toast({ title: 'ההזמנה נוצרה' });
              }
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Inline quote creation — prefilled from this lead's customer details.
          Local dialog (not useCreationModal) so it works inside the lead
          overlay, which sits above the CreationModal provider. */}
      <NewQuoteDialog
        open={showQuoteDialog}
        onOpenChange={setShowQuoteDialog}
        leadId={leadId}
        title={`הצעת מחיר חדשה - ${lead?.full_name || ''}`}
        onCreated={(quote) => {
          queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
          if (quote?.id) toast({ title: 'הצעת המחיר נוצרה' });
        }}
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


    </div>);

}